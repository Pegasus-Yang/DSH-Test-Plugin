/** 在项目忽略目录中启动本地 Harness 的独立 Web 配置。 */
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { parse, stringify } from "yaml";
const { host } = JSON.parse(await readFile(".local/host.json", "utf8"));
const project = process.cwd(),
  home = resolve(process.env.DSH_TEST_HOME ?? ".local/dsh-home");
await mkdir(home, { recursive: true });
const sourceHome = process.env.DSH_CREDENTIAL_HOME ?? join(homedir(), ".dsh");
const credentials = parse(
  await readFile(join(sourceHome, ".credentials.yaml"), "utf8"),
);
await writeFile(
  join(home, ".credentials.yaml"),
  stringify({
    version: credentials.version,
    records: {},
    refs: credentials.refs,
  }),
  { mode: 0o600 },
);
await chmod(join(home, ".credentials.yaml"), 0o600);
const profile = parse(
  await readFile(join(sourceHome, "profiles/web/cordis.patch.yml"), "utf8"),
);
const modelConfig = profile.filter((p) =>
  ["llm-pi-ai", "agent-default-model"].includes(p.id),
);
const overlay = [
  ...modelConfig,
  { id: "tools", config: { mode: "native" } },
  { id: "agent-loop", config: { maxParallelToolCalls: 1 } },
  { id: "directory-picker", disabled: true },
  {
    insert: [
      {
        id: "directory-picker-browse",
        name: "@deepseek-ai/dsh-host-directory-picker-browse",
      },
      {
        id: "ui-directory-picker-browse",
        name: "@deepseek-ai/dsh-client-ui-directory-picker-browse",
      },
      {
        id: "mcp-test-playwright",
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          serverName: "playwright",
          transport: "stdio",
          command: process.execPath,
          args: [
            resolve(
              process.env.DSH_MCP_TRACE
                ? "scripts/mcp-proxy.mjs"
                : "node_modules/@playwright/mcp/cli.js",
            ),
            "--headless",
            "--browser",
            "chromium",
            "--isolated",
            "--output-dir",
            resolve(".local/playwright"),
          ],
          toolCallTimeoutMs: 60000,
          failOnStartupError: true,
        },
      },
      {
        id: "harness-test",
        name: resolve("dist/index.js"),
        config: {
          outputRoot: resolve(process.env.DSH_TEST_OUTPUT ?? "artifacts/runs"),
          workspace: project,
        },
      },
    ],
  },
];
if (process.env.DSH_TEST_INSTALLED) {
  const group = overlay.find((x) => x.insert);
  const plugin = group.insert.find((x) => x.id === "harness-test");
  group.insert = group.insert.filter((x) => x.id !== "harness-test");
  overlay.push({ id: "harness-test", config: plugin.config });
}
if (process.env.DSH_TEST_PROBE)
  overlay.push({
    insert: [
      {
        id: "test-probe",
        name: resolve("scripts/host-probe.mjs"),
        config: {
          output: resolve("artifacts/validation/m0/probe.json"),
          workspace: project,
        },
      },
    ],
  });
await writeFile(".local/host-overlay.yml", stringify(overlay), { mode: 0o600 });
const log = createWriteStream(".local/host.log", { flags: "a", mode: 0o600 });
const child = spawn(
  process.execPath,
  [
    join(host, "apps/cli/lib/bin.js"),
    "web",
    "--patch",
    resolve(".local/host-overlay.yml"),
    "--no-open",
    "--port",
    process.env.DSH_TEST_PORT ?? "13379",
  ],
  {
    cwd: host,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: "1",
      DSH_TOOLS_MODE: "native",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let buffer = "",
  ready = false;
for (const stream of [child.stdout, child.stderr])
  stream.on("data", async (data) => {
    log.write(data);
    buffer = (buffer + data.toString()).slice(-100000);
    const found = buffer.match(/dsh web: (http:\/\/[^\s]+)/);
    if (found && !ready) {
      ready = true;
      await writeFile(
        process.env.DSH_TEST_STATE ?? ".local/host-state.json",
        JSON.stringify({ pid: child.pid, url: found[1], host, home }, null, 2),
        { mode: 0o600 },
      );
      console.log(
        "Harness Web 已就绪：http://127.0.0.1:" +
          (process.env.DSH_TEST_PORT ?? "13379") +
          "（认证地址仅保存于 .local）",
      );
    }
  });
child.on("exit", (code) => {
  console.log(`Harness 已退出：${code}`);
  process.exitCode = code ?? 1;
  log.end();
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
