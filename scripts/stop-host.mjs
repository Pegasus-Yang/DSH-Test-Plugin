/** 仅停止本任务记录的隔离宿主及其仍存活的子进程，并保存处置事实。 */
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const state = JSON.parse(
  await readFile(
    process.env.DSH_TEST_STATE ?? ".local/host-state.json",
    "utf8",
  ),
);
const rows = execFileSync("ps", ["-axo", "pid=,ppid=,comm="], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .map((s) => {
    const m = s.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] };
  });
const owned = new Set([state.pid]);
let size;
do {
  size = owned.size;
  for (const r of rows) if (owned.has(r.ppid)) owned.add(r.pid);
} while (size !== owned.size);
try {
  process.kill(state.pid, "SIGTERM");
} catch {}
const alive = (p) => {
  try {
    process.kill(p, 0);
    return true;
  } catch {
    return false;
  }
};
for (let n = 0; n < 50 && [...owned].some(alive); n++)
  await new Promise((r) => setTimeout(r, 100));
for (const pid of [...owned].reverse())
  if (alive(pid))
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
await new Promise((r) => setTimeout(r, 500));
const survivors = [...owned].filter(alive);
const proof = {
  operator: "Pegasus-Yang / Codex本任务",
  external_stopped: survivors.length === 0,
  environment_reset: survivors.length === 0,
  details:
    "停止本任务隔离宿主及记录的进程树；隔离MCP使用临时浏览器上下文，停止后重建。",
  evidence: {
    captured_processes: rows.filter((r) => owned.has(r.pid)),
    survivors,
    completed_at: new Date().toISOString(),
  },
};
await writeFile(
  process.env.DSH_TEST_PROOF ?? ".local/reset-proof.json",
  JSON.stringify(proof, null, 2),
);
console.log({ stopped: owned.size, survivors });
if (survivors.length) process.exitCode = 1;
