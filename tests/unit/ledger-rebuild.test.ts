import { afterEach, expect, it } from "vitest";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder, rebuild } from "../../src/recorder.js";
import { expand, parsePlan, type SuiteRun } from "../../src/contracts.js";
import { sample } from "../fixtures/plan.js";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ledger-rebuild-"));
  roots.push(root);
  const plan = parsePlan(sample());
  const run: SuiteRun = {
    schema_version: "1",
    suite_run_id: "run-one",
    name: "检查点",
    created_at: "now",
    lifecycle: "FINISHED",
    plan,
    instances: expand(plan),
    evidence: [],
    incomplete: false,
    resource_quarantined: false,
    manifest: {},
  };
  for (const instance of run.instances) instance.lifecycle = "FINISHED";
  const recorder = new Recorder(root, run.suite_run_id);
  const events = () =>
    readFileSync(join(recorder.directory, "events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  return { run, recorder, events };
}
it("快照不内嵌账本，只保留两份已提交检查点且完整状态可重建", async () => {
  const t = fixture();
  t.run.manifest.large = "x".repeat(100000);
  for (let n = 0; n < 10; n++) {
    t.run.manifest.n = n;
    t.recorder.snapshot(t.run);
  }
  const events = t.events();
  expect(
    events.every(
      (e) => e.type === "state_checkpoint" && e.schema_version === "2",
    ),
  ).toBe(true);
  expect(JSON.stringify(events).length).toBeLessThan(5000);
  const files = readdirSync(join(t.recorder.directory, "checkpoints"));
  expect(files).toHaveLength(2);
  for (const file of files)
    expect(
      statSync(join(t.recorder.directory, "checkpoints", file)).mode & 0o777,
    ).toBe(0o600);
  expect(await rebuild(t.recorder.directory)).toEqual(t.run);
});
it("新版本仍可流式读取内嵌旧快照", async () => {
  const t = fixture();
  writeFileSync(
    join(t.recorder.directory, "events.jsonl"),
    JSON.stringify({
      schema_version: "1",
      seq: 0,
      type: "state_saved",
      binding: { suite_run_id: t.run.suite_run_id },
      payload: t.run,
    }) + "\n",
  );
  expect(await rebuild(t.recorder.directory)).toEqual(t.run);
});
it.each(["missing", "hash", "previous"])(
  "应保留的快照 %s 异常不能静默回退",
  async (mode) => {
    const t = fixture();
    t.recorder.snapshot(t.run);
    t.recorder.snapshot(t.run);
    const ref = t.events()[mode === "previous" ? 0 : 1].payload.relative_path;
    const path = join(t.recorder.directory, ref);
    if (mode === "missing") unlinkSync(path);
    else appendFileSync(path, " ");
    await expect(rebuild(t.recorder.directory)).rejects.toThrow(
      "已提交快照缺失或损坏",
    );
  },
);
it("快照已提交但最新缓存更新失败仍可恢复，写失败继续禁止派发", async () => {
  const t = fixture();
  t.recorder.snapshot(t.run);
  rmSync(join(t.recorder.directory, "results.json"));
  mkdirSync(join(t.recorder.directory, "results.json"));
  t.run.manifest.changed = true;
  expect(() => t.recorder.snapshot(t.run)).toThrow();
  expect(t.recorder.failed).toBeTruthy();
  expect((await rebuild(t.recorder.directory)).manifest.changed).toBe(true);
  expect(() => t.recorder.event("must_not_dispatch", {})).toThrow();
});
it("未提交的孤立快照不成为重建起点", async () => {
  const t = fixture();
  t.recorder.snapshot(t.run);
  const ref = t.events()[0].payload.relative_path;
  writeFileSync(
    join(t.recorder.directory, "checkpoints/state-999.json"),
    JSON.stringify({ ...t.run, name: "孤立" }),
  );
  expect((await rebuild(t.recorder.directory)).name).toBe(t.run.name);
  expect(readFileSync(join(t.recorder.directory, ref), "utf8")).toContain(
    "检查点",
  );
});
it("覆盖快照之后的未封存状态事件必须标中断，不能称为完整结果", async () => {
  const t = fixture();
  t.recorder.snapshot(t.run);
  t.recorder.event("step_started", { step: { step_id: "later" } });
  expect(await rebuild(t.recorder.directory)).toMatchObject({
    incomplete: true,
    lifecycle: "INTERRUPTED",
  });
});
it("读取可以取消并关闭大文件流", async () => {
  const t = fixture();
  t.recorder.snapshot(t.run);
  const controller = new AbortController();
  controller.abort();
  await expect(
    rebuild(t.recorder.directory, controller.signal),
  ).rejects.toThrow();
});
it("跨块的UTF8旧快照和损坏末尾保留，中间损坏或未知版本拒绝", async () => {
  const t = fixture();
  t.run.name = "界".repeat(65536);
  const file = join(t.recorder.directory, "events.jsonl");
  writeFileSync(
    file,
    JSON.stringify({
      schema_version: "1",
      seq: 0,
      type: "state_saved",
      payload: t.run,
    }) + "\n{bad",
  );
  expect((await rebuild(t.recorder.directory)).name).toBe(t.run.name);
  appendFileSync(file, '\n{"seq":1,"type":"unused"}\n');
  await expect(rebuild(t.recorder.directory)).rejects.toThrow("中间损坏");
  writeFileSync(file, '{"schema_version":"9","seq":0,"type":"unused"}\n');
  await expect(rebuild(t.recorder.directory)).rejects.toThrow("账本版本");
});
