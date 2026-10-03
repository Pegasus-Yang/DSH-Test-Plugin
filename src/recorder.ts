/** 单进程串行账本、原子快照及证据归档；写失败立即交给测试作用域终止。 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  field,
  type Binding,
  type Evidence,
  type Json,
  type SuiteRun,
} from "./contracts.js";
export interface RecordedEvent {
  type: string;
  binding: Binding | { suite_run_id: string };
  payload: Json;
}
export function redact(value: unknown): Json {
  if (value === undefined) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string")
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [已脱敏]")
      .replace(/([?&](?:token|api_key|password)=)[^\s&#]+/gi, "$1[已脱敏]");
  if (Array.isArray(value)) return value.map(redact);
  if (
    typeof value === "object" &&
    field(value, "type") === "image" &&
    typeof field(value, "data") === "string"
  )
    return {
      type: "image",
      mimeType: String(field(value, "mimeType") ?? ""),
      data: "[二进制图像另存证据附件]",
    };
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /^(?:password|passwd|authorization|cookie|set-cookie|token|api[_-]?key|secret)$/i.test(
          key,
        )
          ? "[已脱敏]"
          : redact(v),
      ]),
    );
  return String(value);
}
export function safePath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("附件必须使用相对路径");
  const full = resolve(root, path),
    rel = relative(root, full);
  if (!rel || rel === ".." || rel.startsWith(".." + sep))
    throw new Error("路径逃逸");
  let parent = dirname(full);
  while (!existsSync(parent)) parent = dirname(parent);
  const actual = realpathSync(parent),
    trusted = realpathSync(root),
    r = relative(trusted, actual);
  if (r === ".." || r.startsWith(".." + sep))
    throw new Error("符号链接路径逃逸");
  return full;
}
export function atomicJson(path: string, value: unknown): void {
  atomicWrite(path, JSON.stringify(redact(value), null, 2) + "\n");
}
export function atomicWrite(path: string, contents: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + "." + randomUUID() + ".tmp";
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
export class Recorder {
  private secrets = new Set<string>();
  protect(input: unknown): void {
    if (!input || typeof input !== "object") return;
    for (const [key, value] of Object.entries(input)) {
      if (
        /^(?:password|passwd|authorization|cookie|token|api[_-]?key|secret)$/i.test(
          key,
        ) &&
        typeof value === "string" &&
        value
      )
        this.secrets.add(value);
      else this.protect(value);
    }
  }
  sanitize(value: unknown): Json {
    const visit = (v: Json): Json =>
      typeof v === "string"
        ? [...this.secrets].reduce(
            (text, secret) => text.replaceAll(secret, "[已脱敏]"),
            v,
          )
        : Array.isArray(v)
          ? v.map(visit)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, visit(x)]),
              )
            : v;
    return visit(redact(value));
  }
  readonly directory: string;
  private seq = 0;
  failed?: Error;
  private seen = new Set<string>();
  constructor(
    root: string,
    readonly runId: string,
    private readonly onEvent?: (event: RecordedEvent) => void,
  ) {
    mkdirSync(root, { recursive: true });
    this.directory = join(realpathSync(root), runId);
    mkdirSync(this.directory);
    mkdirSync(join(this.directory, "evidence"));
  }
  event(type: string, payload: unknown, binding?: Binding, key?: string): void {
    if (this.failed) throw this.failed;
    if (key && this.seen.has(key)) return;
    try {
      const event = {
        schema_version: "1",
        seq: this.seq,
        event_id: randomUUID(),
        timestamp: new Date().toISOString(),
        type,
        binding: binding ?? { suite_run_id: this.runId },
        payload: this.sanitize(payload),
      };
      const fd = openSync(join(this.directory, "events.jsonl"), "a", 0o600);
      try {
        appendFileSync(fd, JSON.stringify(event) + "\n");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.seq++;
      if (key) this.seen.add(key);
      // 展示失败不能污染已落盘的测试事实或阻断资源清理。
      try {
        this.onEvent?.(event);
      } catch (error) {
        console.warn(
          "测试进度展示失败：",
          String(this.sanitize(String(error))),
        );
      }
    } catch (error) {
      this.failed = error instanceof Error ? error : new Error(String(error));
      throw this.failed;
    }
  }
  snapshot(run: SuiteRun): void {
    this.event("state_saved", run);
    atomicJson(join(this.directory, "results.json"), this.sanitize(run));
  }
  json(name: string, value: unknown): void {
    try {
      atomicJson(safePath(this.directory, name), this.sanitize(value));
    } catch (e) {
      this.failed = e instanceof Error ? e : new Error(String(e));
      throw this.failed;
    }
  }
  evidence(
    name: string,
    content: string | Buffer,
    mediaType: string,
    redacted = true,
  ): Evidence {
    const relativePath = "evidence/" + name,
      path = safePath(this.directory, relativePath);
    if (typeof content === "string") {
      if (mediaType === "application/json")
        content = JSON.stringify(this.sanitize(JSON.parse(content)), null, 2);
      else content = String(this.sanitize(content));
    }
    atomicWrite(path, content);
    return {
      evidence_id: randomUUID(),
      relative_path: relativePath,
      media_type: mediaType,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      redacted,
    };
  }
}
/** 从保存的最后状态重建；尾部损坏可标中断，中间损坏拒绝。 */
export function rebuild(directory: string): SuiteRun {
  const eventFile = join(directory, "events.jsonl");
  const lines = readFileSync(eventFile, "utf8").split("\n");
  let state: SuiteRun | undefined;
  let incomplete = false;
  const pending = new Map<string, { case_run_id: string }>();
  const applied = new Set<string>();
  const revisions = new Set<number>();
  let seq = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] && i === lines.length - 1) continue;
    let e;
    try {
      e = JSON.parse(lines[i]!);
    } catch {
      if (i >= lines.length - 2) {
        incomplete = true;
        break;
      }
      throw new Error("JSONL中间损坏，拒绝重建");
    }
    if (e.seq !== seq++) throw new Error("事件序列不连续");
    if (e.type === "state_saved") state = e.payload;
    if (e.type === "plan_revised") revisions.add(e.payload.revision);
    if (e.type === "revision_applied")
      applied.add(e.payload.case_run_id + ":" + e.payload.revision);
    if (e.type === "tool_bound") pending.set(e.payload.call_id, e.binding);
    if (e.type === "tool_finished" || e.type === "late_tool_result")
      pending.delete(e.payload.call_id);
  }
  if (!state) throw new Error("没有可重建的状态快照");
  for (const instance of state.instances)
    for (const revision of instance.applied_revisions)
      if (
        revision !== 0 &&
        (!revisions.has(revision) ||
          !applied.has(instance.case_run_id + ":" + revision))
      ) {
        incomplete = true;
        instance.incomplete = true;
        instance.integrity_error = true;
        instance.status = "ERROR";
        instance.issues.push("修订应用记录缺失");
      }
  if (state.lifecycle !== "FINISHED" || incomplete) {
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
  return state;
}
