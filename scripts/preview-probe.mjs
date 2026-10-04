/** 通过真实 MCP 和 Browscreen 验证公开 CDP 交付，不调用模型或外部网站。 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const directory = resolve(
  process.env.DSH_PREVIEW_PROBE_EVIDENCE ??
    "artifacts/validation/progress-preview/v0",
);
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, "owner.json"),
  JSON.stringify({ run_id: "probe", case_run_id: "probe-case" }),
);
await writeFile(
  join(directory, "mcp-config.json"),
  JSON.stringify({
    browser: {
      initPage: [resolve("dist/cdp-publisher.cjs")],
      launchOptions: {
        args: ["--enable-automation", "--remote-debugging-port=0"],
      },
    },
  }),
);
const { host } = JSON.parse(await readFile(".local/host.json", "utf8"));
const sdk = (await readdir(join(host, "node_modules/.pnpm"))).find((name) =>
  name.startsWith("@modelcontextprotocol+sdk@"),
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
const client = new Client({ name: "preview-probe", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    resolve(
      process.env.DSH_PREVIEW_PROBE_MCP_CLI ??
        "node_modules/@playwright/mcp/cli.js",
    ),
    "--headless",
    "--browser",
    "chromium",
    "--isolated",
    "--output-dir",
    directory,
    "--config",
    join(directory, "mcp-config.json"),
  ],
  env: {
    ...process.env,
    DSH_TEST_PREVIEW_DIR: directory,
    DEBUG: "pw:mcp,pw:mcp:*",
  },
  stderr: "pipe",
});
const fixture = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(
    "<!doctype html><title>实时预览接入验证</title><style>body{background:#fce8e6;font:30px sans-serif;padding:80px}button{font:24px sans-serif;padding:12px}</style><h1>PREVIEW BEFORE</h1><button onclick=\"document.body.style.background='#d9eafd';document.querySelector('h1').textContent='PREVIEW AFTER'\">改变页面</button>",
  );
});
await new Promise((done) => fixture.listen(0, "127.0.0.1", done));
const port = fixture.address().port;
let sidecar;
let logs = "";
let mcpLogs = "";
try {
  await client.connect(transport);
  transport.stderr?.on("data", (data) => {
    mcpLogs = (mcpLogs + data).slice(-16000);
  });
  const result = await client.callTool(
    {
      name: "browser_navigate",
      arguments: { url: `http://127.0.0.1:${port}` },
    },
    undefined,
    { timeout: 30000 },
  );
  assert(!result.isError, JSON.stringify(result));
  let metadata;
  for (let count = 0; count < 40; count++) {
    try {
      metadata = JSON.parse(
        await readFile(join(directory, "cdp.json"), "utf8"),
      );
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  if (!metadata) {
    const diagnosis = await client.callTool({
      name:
        process.env.DSH_PREVIEW_PROBE_MCP_VERSION === "0.0.80"
          ? "browser_run_code_unsafe"
          : "browser_run_code",
      arguments: {
        code: "async (page) => { const session = await page.context().newCDPSession(page); try { const command = await session.send('Browser.getBrowserCommandLine'); return {debugging:command.arguments.filter(argument => argument.includes('remote-debugging'))}; } catch(error) { return {cdp_error:error.message}; } finally { await session.detach(); } }",
      },
    });
    console.log("CDP 诊断：", JSON.stringify(diagnosis));
  }
  assert(metadata, "未交付 CDP：" + mcpLogs);
  assert.equal(metadata.run_id, "probe");
  assert(metadata.endpoint.includes("/devtools/page/"));
  const listener = createServer();
  await new Promise((done) => listener.listen(0, "127.0.0.1", done));
  const previewPort = listener.address().port;
  await new Promise((done) => listener.close(done));
  sidecar = spawn(
    "uv",
    [
      "run",
      "--no-sync",
      "--project",
      resolve(process.env.DSH_BROWSCREEN_PROJECT ?? "../Browscreen"),
      "browscreen",
      "--work-dir",
      directory,
      "--host",
      "127.0.0.1",
      "--port",
      String(previewPort),
    ],
    {
      env: { ...process.env, UV_CACHE_DIR: join(directory, "uv-cache") },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [sidecar.stdout, sidecar.stderr])
    stream.on("data", (data) => {
      logs = (logs + data).slice(-12000);
    });
  const frame = async () => {
    for (let count = 0; count < 80; count++) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${previewPort}/api/screenshot`,
          { signal: AbortSignal.timeout(1000) },
        );
        if (response.ok)
          return {
            bytes: Buffer.from(await response.arrayBuffer()),
            id: response.headers.get("X-Frame-Id"),
            at: response.headers.get("X-Capture-Started-At"),
          };
      } catch {}
      if (sidecar.exitCode !== null)
        throw new Error("Browscreen 退出：" + logs);
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error("未取得 Browscreen 首帧：" + logs);
  };
  const before = await frame();
  await writeFile(join(directory, "before.png"), before.bytes);
  assert(before.id && before.at);
  assert.equal(before.bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const changed = await client.callTool(
    {
      name: "browser_evaluate",
      arguments: {
        function:
          "() => { document.querySelector('button').click(); return document.querySelector('h1').textContent; }",
      },
    },
    undefined,
    { timeout: 15000 },
  );
  assert(!changed.isError);
  await new Promise((done) => setTimeout(done, 700));
  const after = await frame();
  await writeFile(join(directory, "after.png"), after.bytes);
  assert(Number(after.id) > Number(before.id));
  assert(!before.bytes.equals(after.bytes), "业务页面变化没有进入实时帧");
  await client.callTool({ name: "browser_close", arguments: {} }, undefined, {
    timeout: 15000,
  });
  const verification = {
    mcp: process.env.DSH_PREVIEW_PROBE_MCP_VERSION ?? "0.0.68",
    headless: true,
    page_cdp: true,
    before_frame: before.id,
    after_frame: after.id,
    image_changed: true,
    browser_close: "passed",
  };
  await writeFile(
    join(directory, "verification.json"),
    JSON.stringify(verification, null, 2),
  );
  console.log(JSON.stringify(verification));
} finally {
  await client.close().catch(() => {});
  if (sidecar) {
    sidecar.kill("SIGTERM");
    await new Promise((done) =>
      sidecar.exitCode !== null ? done() : sidecar.once("exit", done),
    );
  }
  await new Promise((done) => fixture.close(done));
  await writeFile(join(directory, "browscreen.log"), logs);
  await writeFile(join(directory, "mcp.log"), mcpLogs);
}
