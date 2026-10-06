/** 流式校验新旧账本；只重建已保存事实，不访问测试目标。 */
import { createReadStream, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import type { SuiteRun, Binding, ActualOperation } from "./contracts.js";
import { safePath } from "./recorder.js";
import { sealOperations } from "./actual-operations.js";

interface Event {
  seq: number;
  schema_version?: string;
  timestamp?: string;
  type: string;
  binding: Binding;
  payload: any;
}
interface Scan {
  incomplete: boolean;
}
/** 每次只保留当前行；损坏的末尾可封存，中间损坏拒绝。 */
export async function* ledgerEvents(
  directory: string,
  signal?: AbortSignal,
  scan: Scan = { incomplete: false },
): AsyncGenerator<Event> {
  const stream = createReadStream(join(directory, "events.jsonl"), {
    encoding: "utf8",
    highWaterMark: 65536,
    signal,
  });
  let remaining = "",
    seq = 0,
    damaged = false;
  const parse = (line: string): Event | undefined => {
    if (damaged && line.trim()) throw new Error("JSONL中间损坏，拒绝重建");
    let event: Event;
    try {
      event = JSON.parse(line);
    } catch {
      damaged = true;
      scan.incomplete = true;
      return;
    }
    if (!event || typeof event !== "object" || event.seq !== seq++)
      throw new Error("事件序列不连续");
    if (event.schema_version && !["1", "2"].includes(event.schema_version))
      throw new Error("不支持的事件账本版本");
    return event;
  };
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      const text = remaining + chunk;
      let start = 0,
        end: number;
      while ((end = text.indexOf("\n", start)) >= 0) {
        const event = parse(text.slice(start, end));
        if (event) yield event;
        start = end + 1;
      }
      remaining = text.slice(start);
    }
    if (remaining) {
      const event = parse(remaining);
      if (event) yield event;
    }
  } finally {
    stream.destroy();
  }
}

async function checkpoint(
  directory: string,
  event: Event,
  signal?: AbortSignal,
): Promise<SuiteRun> {
  const ref = event.payload;
  if (
    typeof ref?.relative_path !== "string" ||
    !/^checkpoints\/state-\d+\.json$/.test(ref.relative_path) ||
    ref.relative_path !== `checkpoints/state-${event.seq}.json` ||
    ref.through_seq !== event.seq - 1 ||
    !Number.isSafeInteger(ref.bytes) ||
    ref.bytes < 0 ||
    typeof ref.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(ref.sha256)
  )
    throw new Error("快照提交记录无效");
  try {
    const path = realpathSync(safePath(directory, ref.relative_path));
    const rel = relative(realpathSync(directory), path);
    if (rel === ".." || rel.startsWith(".." + sep)) throw new Error("路径逃逸");
    const bytes = await readFile(path, { signal });
    if (
      bytes.length !== ref.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== ref.sha256
    )
      throw new Error("大小或哈希不一致");
    const run = JSON.parse(bytes.toString("utf8")) as SuiteRun;
    if (run.suite_run_id !== event.binding.suite_run_id)
      throw new Error("运行身份不一致");
    return run;
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error("已提交快照缺失或损坏：" + String(error));
  }
}

export async function rebuild(
  directory: string,
  signal?: AbortSignal,
): Promise<SuiteRun> {
  const scan = { incomplete: false };
  let state: SuiteRun | undefined,
    stateSeq = -1;
  const snapshots: Event[] = [];
  const pending = new Map<string, Binding>();
  const applied = new Set<string>(),
    revisions = new Set<number>();
  for await (const event of ledgerEvents(directory, signal, scan)) {
    if (event.type === "state_saved") {
      state = event.payload;
      stateSeq = event.seq;
      snapshots.length = 0;
    }
    if (event.type === "state_checkpoint") {
      snapshots.push(event);
      if (snapshots.length > 2) snapshots.shift();
      state = undefined;
      stateSeq = event.seq;
    }
    if (event.type === "plan_revised") revisions.add(event.payload.revision);
    if (event.type === "revision_applied")
      applied.add(event.payload.case_run_id + ":" + event.payload.revision);
    if (event.type === "tool_bound")
      pending.set(event.payload.call_id, event.binding);
    if (event.type === "tool_finished" || event.type === "late_tool_result")
      pending.delete(event.payload.call_id);
  }
  for (const event of snapshots)
    state = await checkpoint(directory, event, signal);
  if (!state) throw new Error("没有可重建的状态快照");
  for await (const event of ledgerEvents(directory, signal)) {
    if (event.seq <= stateSeq) continue;
    const instance = state.instances.find(
      (i) => i.case_run_id === event.binding?.case_run_id,
    );
    const step = instance?.steps.find(
      (s) =>
        s.step_id === event.binding?.step_id &&
        s.phase === event.binding?.phase,
    );
    if (
      [
        "operation_registered",
        "operation_dispatched",
        "operation_finished",
      ].includes(event.type) &&
      step
    ) {
      const op = event.payload as ActualOperation;
      const records = (step.actual_operations ??= []);
      const index = records.findIndex(
        (r) => r.operation_id === op.operation_id,
      );
      if (index < 0) records.push(op);
      else if (
        !["UNKNOWN", "NOT_DISPATCHED", "SUCCEEDED", "ERROR"].includes(
          records[index]!.state,
        )
      )
        records[index] = op;
    } else if (["tool_bound", "tool_finished"].includes(event.type) && step) {
      const index = step.calls.findIndex(
        (c) => c.call_id === event.payload.call_id,
      );
      if (index < 0) step.calls.push(event.payload);
      else if (!step.calls[index]!.finished_at)
        step.calls[index] = event.payload;
    } else if (event.type === "step_finished" && step) {
      if (["RUNNING", "PENDING"].includes(step.status))
        Object.assign(step, event.payload);
      scan.incomplete = true;
    } else if (
      [
        "step_started",
        "step_finished",
        "step_defined",
        "check_bound",
        "assertion_evaluated",
        "capture_configured",
        "recording_started",
        "recording_finished",
        "stop_requested",
        "plan_revised",
        "revision_applied",
      ].includes(event.type)
    ) {
      scan.incomplete = true;
    }
  }
  for (const instance of state.instances)
    for (const revision of instance.applied_revisions)
      if (
        revision !== 0 &&
        (!revisions.has(revision) ||
          !applied.has(instance.case_run_id + ":" + revision))
      ) {
        scan.incomplete = true;
        instance.incomplete = true;
        instance.integrity_error = true;
        instance.status = "ERROR";
        instance.issues.push("修订应用记录缺失");
      }
  if (state.lifecycle !== "FINISHED" || scan.incomplete) {
    state.incomplete = true;
    state.lifecycle = "INTERRUPTED";
    for (const instance of state.instances)
      if (instance.lifecycle !== "FINISHED") {
        instance.status = "ERROR";
        instance.lifecycle = "INTERRUPTED";
        instance.incomplete = true;
        instance.issues.push("进程中断，仅重建已保存事实");
      }
  }
  for (const [callId, binding] of pending) {
    const instance = state.instances.find(
      (i) => i.case_run_id === binding.case_run_id,
    );
    if (instance) {
      instance.unsettled_call_ids = [
        ...new Set([...instance.unsettled_call_ids, callId]),
      ];
      instance.resource_quarantined = true;
      instance.incomplete = true;
      instance.status = "ERROR";
    }
    state.resource_quarantined = true;
    state.incomplete = true;
  }
  sealOperations(state, "只读重建：进程中断或在途操作未获得最终结果");
  return state;
}
