/** 开发诊断：只记录MCP消息身份与大小，不记录消息正文。 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
const root = new URL("..", import.meta.url).pathname;
const child = spawn(
  process.execPath,
  [
    resolve(root, "node_modules/@playwright/mcp/cli.js"),
    ...process.argv.slice(2),
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
const log = (direction, line) => {
  try {
    const x = JSON.parse(line);
    appendFileSync(
      resolve(root, ".local/mcp-transport.jsonl"),
      JSON.stringify({
        time: new Date().toISOString(),
        direction,
        id: x.id,
        method: x.method,
        name: x.params?.name,
        bytes: line.length,
        error: x.error,
      }) + "\n",
    );
  } catch {}
};
let incoming = "",
  outgoing = "";
process.stdin.on("data", (b) => {
  incoming += b.toString();
  for (let i; (i = incoming.indexOf("\n")) >= 0; ) {
    log("request", incoming.slice(0, i));
    incoming = incoming.slice(i + 1);
  }
  child.stdin.write(b);
});
child.stdout.on("data", (b) => {
  outgoing += b.toString();
  for (let i; (i = outgoing.indexOf("\n")) >= 0; ) {
    log("response", outgoing.slice(0, i));
    outgoing = outgoing.slice(i + 1);
  }
  process.stdout.write(b);
});
child.stderr.on("data", (b) => process.stderr.write(b));
process.stdin.on("end", () => child.stdin.end());
child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGTERM", () => child.kill("SIGTERM"));
