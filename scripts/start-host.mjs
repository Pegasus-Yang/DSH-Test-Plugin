/** 在项目忽略目录中启动本地 Harness 的独立 Web 配置。 */
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { createWriteStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
const { host } = JSON.parse(await readFile(".local/host.json", "utf8"));
const project = process.cwd(),
  home = resolve(process.env.DSH_TEST_HOME ?? ".local/dsh-home");
const statePath = resolve(
  process.env.DSH_TEST_STATE ?? ".local/host-state.json",
);
const runtimePrefix = statePath
  .replace(/-state\.json$/, "")
  .replace(/\.json$/, "");
const overlayPath = runtimePrefix + "-overlay.yml";
const logPath = runtimePrefix + ".log";
await mkdir(home, { recursive: true });
const browscreenProject = resolve(
  process.env.DSH_BROWSCREEN_PROJECT ?? "../Browscreen",
);
const preview =
  process.env.DSH_TEST_PREVIEW !== "0" &&
  existsSync(join(browscreenProject, "pyproject.toml"))
    ? {
        workDir: resolve(
          `.local/preview-${process.env.DSH_TEST_PORT ?? "13379"}`,
        ),
        browscreenUrl: `http://127.0.0.1:${Number(process.env.DSH_TEST_PORT ?? "13379") + 1}`,
        browscreenProject,
      }
    : undefined;
if (preview) {
  await mkdir(preview.workDir, { recursive: true });
  await writeFile(
    join(preview.workDir, "mcp-config.json"),
    JSON.stringify({
      browser: {
        initPage: [resolve("dist/cdp-publisher.cjs")],
        launchOptions: { args: ["--enable-automation"] },
      },
    }),
    { mode: 0o600 },
  );
}
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
            ...(preview
              ? ["--config", join(preview.workDir, "mcp-config.json")]
              : []),
            "--output-dir",
            resolve(".local/playwright"),
          ],
          ...(preview
            ? { env: { DSH_TEST_PREVIEW_DIR: preview.workDir } }
            : {}),
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
          ...(preview ? { preview } : {}),
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
// 设置页接入验收需要可编辑的 MCP profile，不能由命令行 overlay 固定其参数。
if (process.env.DSH_TEST_SETTINGS) {
  const group = overlay.find((entry) => entry.insert);
  const mcp = group.insert.find((entry) => entry.id === "mcp-test-playwright");
  const plugin =
    group.insert.find((entry) => entry.id === "harness-test") ??
    overlay.find((entry) => entry.id === "harness-test");
  if (plugin.name?.startsWith("/"))
    plugin.name = pathToFileURL(plugin.name).href;
  group.insert = group.insert.filter(
    (entry) => entry !== mcp && entry !== plugin,
  );
  const pluginOverlay = overlay.indexOf(plugin);
  if (pluginOverlay >= 0) overlay.splice(pluginOverlay, 1);
  const directory = join(home, "profiles/web");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "cordis.patch.yml");
  const patches = existsSync(path) ? parse(await readFile(path, "utf8")) : [];
  for (const entry of [mcp, plugin]) {
    if (
      !patches
        .flatMap((row) => row.insert ?? [row])
        .some((row) => row.id === entry.id)
    )
      patches.push(entry.name ? { insert: [entry] } : entry);
  }
  await writeFile(path, stringify(patches), { mode: 0o600 });
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
await writeFile(overlayPath, stringify(overlay), { mode: 0o600 });
const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
const child = spawn(
  process.execPath,
  [
    join(host, "apps/cli/lib/bin.js"),
    "web",
    "--patch",
    overlayPath,
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
        statePath,
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
