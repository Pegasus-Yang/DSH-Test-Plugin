/** 调用本机Harness公开命令Remote，用于可复现的命令验收。 */
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const { url } = JSON.parse(
  await readFile(
    process.env.DSH_TEST_STATE ?? ".local/host-state.json",
    "utf8",
  ),
);
if (!process.argv[2])
  throw new Error('请传入测试命令，例如 /test "任务描述"。');
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto(url);
await page.waitForTimeout(800);
const rpc = async (method, args) =>
  page.evaluate(
    async ({ method, args }) => {
      const response = await fetch("/api/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: crypto.randomUUID(),
          method,
          payload: { args },
        }),
      });
      return response.json();
    },
    { method, args },
  );
try {
  const created = await rpc("session/create", {
    request: { cwd: process.cwd() },
  });
  const result = await rpc("commands/execute", {
    agentId: created.result.value.sessionId,
    line: process.argv[2],
    submittedAttachments: [],
  });
  await mkdir("artifacts/validation/commands", { recursive: true });
  await writeFile(
    "artifacts/validation/commands/" + Date.now() + ".json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
