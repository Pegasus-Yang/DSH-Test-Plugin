/** 独立验证 Selenium MCP 能真实导航、点击、观察、截图和释放浏览器。 */
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createCounterFixture } from "./counter.mjs";

assert(process.argv[2], "请提供本轮独立输出目录");
const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const fixture = await createCounterFixture({
  traceFile: join(output, "clicks.jsonl"),
});
const client = new Client(
  { name: "selenium-fixture-smoke", version: "1.0.0" },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("./server.mjs", import.meta.url))],
  env: {
    ...process.env,
    SELENIUM_MCP_MODE: "native",
    SELENIUM_MCP_ORIGIN: fixture.origin,
    SELENIUM_MCP_OUTPUT: join(output, "service"),
    SE_CACHE_PATH: join(dirname(output), "selenium-cache"),
    SE_AVOID_STATS: "true",
  },
  stderr: "pipe",
});
let stderr = "";
transport.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const call = async (name, args = {}) => {
  const result = await client.callTool(
    { name, arguments: args },
    { timeout: 180000 },
  );
  assert(!result.isError, JSON.stringify(result));
  return result;
};
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  assert.equal(tools.length, 7);
  await call("browser_navigate", {
    url: fixture.origin + "/counter?scenario=standalone",
  });
  const before = (await call("browser_read", { selector: "#counter" }))
    .structuredContent.text;
  await call("browser_click", { selector: "#increment" });
  const after = (await call("browser_read", { selector: "#counter" }))
    .structuredContent.text;
  assert.equal(before, "0");
  assert.equal(after, "1");
  const shot = await call("browser_take_screenshot");
  const image = shot.content.find((b) => b.type === "image");
  assert(
    image &&
      Buffer.from(image.data, "base64")
        .subarray(0, 8)
        .equals(Buffer.from("89504e470d0a1a0a", "hex")),
  );
  assert.equal(
    (
      await call("browser_evaluate", {
        script: "return Number(document.querySelector('#counter').textContent)",
      })
    ).structuredContent.value,
    1,
  );
  for (let i = 0; fixture.clicks.length === 0 && i < 20; i++) await delay(100);
  if (fixture.clicks.length === 0) {
    const diagnostics = await call("browser_evaluate", {
      script:
        "return {url:location.href,errors:document.documentElement.dataset,handler:document.querySelector('#increment').getAttribute('onclick')}",
    });
    await writeFile(
      join(output, "browser-diagnostics.json"),
      JSON.stringify(diagnostics.structuredContent, null, 2),
    );
  }
  const close = await call("browser_close");
  assert.equal(close.structuredContent.released, true);
  assert.equal(fixture.clicks.length, 1);
  const audit = (await readFile(join(output, "service/selenium.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const opened = audit.find((e) => e.event === "session_opened");
  assert(opened?.session_id);
  assert(
    audit.some(
      (e) => e.event === "session_closed" && e.session_id === opened.session_id,
    ),
  );
  const result = {
    status: "PASS",
    node: process.version,
    engine: "selenium-webdriver",
    selenium: "4.51.0",
    browser: opened.browser,
    browser_version: opened.browser_version,
    session_id: opened.session_id,
    tools,
    before,
    after,
    actual_click_requests: fixture.clicks.length,
    released: true,
  };
  await writeFile(
    join(output, "standalone.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await client.close();
  await fixture.close();
  await writeFile(join(output, "server.stderr.log"), stderr);
}
