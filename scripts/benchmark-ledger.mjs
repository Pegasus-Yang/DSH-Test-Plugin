/** 将已结束的旧运行转为新保存方式，比较存储与只读重建；不执行业务。 */
import fs from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { Recorder, ledgerEvents, rebuild } from "../dist/recorder.js";
const source = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("请提供已结束运行的目录");
const run = JSON.parse(fs.readFileSync(join(source, "results.json"), "utf8"));
if (run.lifecycle !== "FINISHED") throw new Error("只能比较已结束的运行");
const output = fs.mkdtempSync(join(tmpdir(), "dsh-ledger-benchmark-"));
const recorder = new Recorder(output, run.suite_run_id);
let events = 0;
const started = performance.now();
for await (const event of ledgerEvents(source)) {
  if (event.type === "state_saved") recorder.snapshot(event.payload);
  else if (event.type === "state_checkpoint")
    throw new Error("本脚本用于旧版内嵌状态账本，请提供旧运行");
  else recorder.event(event.type, event.payload, event.binding);
  events++;
}
const replayMs = performance.now() - started;
const rebuildStarted = performance.now();
if (!isDeepStrictEqual(await rebuild(recorder.directory), run))
  throw new Error("重建数据与原运行不一致；比较结果保留供检查");
const files = fs.readdirSync(join(recorder.directory, "checkpoints"));
const checkpointBytes = files.reduce(
  (sum, name) =>
    sum + fs.statSync(join(recorder.directory, "checkpoints", name)).size,
  0,
);
const oldBytes = fs.statSync(join(source, "events.jsonl")).size;
const newBytes = fs.statSync(join(recorder.directory, "events.jsonl")).size;
const result = {
  directory: recorder.directory,
  events,
  oldLedgerBytes: oldBytes,
  newLedgerBytes: newBytes,
  reductionPercent: (1 - newBytes / oldBytes) * 100,
  checkpointFiles: files.length,
  checkpointBytes,
  totalStateBytes:
    newBytes +
    checkpointBytes +
    fs.statSync(join(recorder.directory, "results.json")).size,
  replayMs,
  rebuildMs: performance.now() - rebuildStarted,
  peakRssMiB: process.resourceUsage().maxRSS / 1024,
  equal: true,
};
fs.writeFileSync(
  join(output, "benchmark.json"),
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result));
