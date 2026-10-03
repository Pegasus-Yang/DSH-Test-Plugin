/** 隔离复现MCP浏览器关闭，不使用用户浏览器。 */
import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const { host } = JSON.parse(await readFile(".local/host.json", "utf8"));
const sdk = (await readdir(join(host, "node_modules/.pnpm"))).find((n) =>
  n.startsWith("@modelcontextprotocol+sdk@"),
);
const require = createRequire(
  join(host, "node_modules/.pnpm", sdk, "node_modules/_probe.cjs"),
);
const { Client } = await import(
  require.resolve("@modelcontextprotocol/sdk/client/index.js")
);
const { StdioClientTransport } = await import(
  require.resolve("@modelcontextprotocol/sdk/client/stdio.js")
);
const client = new Client({ name: "close-probe", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    resolve("node_modules/@playwright/mcp/cli.js"),
    "--headless",
    "--browser",
    "chromium",
    "--isolated",
  ],
  stderr: "pipe",
});
await client.connect(transport);
for (const [name, args] of [
  ["browser_navigate", { url: "https://ceshiren.com/t/topic/34778" }],
  ["browser_press_key", { key: "End" }],
  ["browser_take_screenshot", { type: "png", fullPage: false }],
  ["browser_close", {}],
]) {
  console.log("start", name, new Date().toISOString());
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 15000,
    });
    console.log("done", name, r.isError ?? false, new Date().toISOString());
  } catch (e) {
    console.log(String(e));
  }
}
await client.close();
