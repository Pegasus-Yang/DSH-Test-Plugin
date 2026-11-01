import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
/** 独立真实宿主验收：更名 Playwright、RunBridge 和多来源媒体；不进入发行包。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parse, stringify } from "yaml";
import { chromium } from "playwright";
import { enter, rpc } from "../../../scripts/compat/browser.mjs";
import { createCounterFixture } from "./counter.mjs";
import { rebuild } from "../../../dist/recorder.js";
const project = fileURLToPath(new URL("../../../", import.meta.url));
const [outputArg, mode = "mixed", entryFormat = "markdown"] =
  process.argv.slice(2);
assert(["json", "markdown"].includes(entryFormat));
assert(
  outputArg &&
    ["playwright-auto", "playwright-video", "runbridge", "mixed"].includes(
      mode,
    ),
);
assert(
  process.env.SELENIUM_PROBE_DSH_ROOT &&
    process.env.SELENIUM_PROBE_MODEL_PATCH &&
    process.env.SELENIUM_PROBE_ARCHIVE,
);
const output = resolve(outputArg),
  host = resolve(process.env.SELENIUM_PROBE_DSH_ROOT),
  cli = host + "/node_modules/@deepseek-ai/dsh/lib/bin.js";
await mkdir(output, { recursive: false });
const archive = resolve(process.env.SELENIUM_PROBE_ARCHIVE),
  sha = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
if (process.env.DSH_CANDIDATE_SHA256)
  assert.equal(sha, process.env.DSH_CANDIDATE_SHA256);
const rb = ["runbridge", "mixed"].includes(mode)
  ? JSON.parse(await readFile(process.env.RUNBRIDGE_PROBE_STATE, "utf8"))
  : undefined;
const home = output + "/home",
  profile = home + "/profiles/web",
  workspace = output + "/workspace",
  runs = output + "/runs";
await mkdir(workspace);
const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_TELEMETRY_DISABLED: "1",
  npm_config_cache: output + "/npm-cache",
  PATH:
    process.execPath.slice(0, process.execPath.lastIndexOf("/")) +
    ":" +
    process.env.PATH,
};
async function command(args, file) {
  const p = spawn(process.execPath, [cli, ...args], {
    cwd: host,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const s of [p.stdout, p.stderr]) s.on("data", (b) => (log += b));
  const code = await new Promise((done, reject) => {
    p.once("exit", done);
    p.once("error", reject);
  });
  await writeFile(output + "/" + file, log, { mode: 0o600 });
  assert.equal(code, 0, file);
}
await command(
  ["plugin", "--profile", "web", "add", archive, "--ignore-scripts"],
  "install.log",
);
assert(!existsSync(profile + "/compatibility.json"));
assert(
  createRequire(
    realpathSync(profile + "/node_modules/dsh-test-plugin/package.json"),
  )
    .resolve("@deepseek-ai/dsh-llm")
    .startsWith(
      realpathSync(host + "/node_modules/@deepseek-ai/dsh-llm") + "/",
    ),
  "插件 SDK 未从当前宿主解析",
);
if (process.env.SELENIUM_PROBE_CREDENTIALS)
  await writeFile(
    home + "/.credentials.yaml",
    await readFile(process.env.SELENIUM_PROBE_CREDENTIALS),
    { mode: 0o600 },
  );
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const mediaPort = socket.address().port;
await new Promise((done) => socket.close(done));
const model = parse(
  await readFile(process.env.SELENIUM_PROBE_MODEL_PATCH, "utf8"),
).filter((p) => ["llm-pi-ai", "agent-default-model"].includes(p.id));
assert.equal(model.length, 2);
const fixture = await createCounterFixture({
  traceFile: output + "/clicks.jsonl",
});
const browserConnection = {
  backend: "auto",
  runbridgeEnabled: !!rb,
  ...(rb
    ? {
        connectionSource: "hub",
        hubFile: rb.hub_file,
        nodeId: rb.node_id,
        nodeLeaseSeconds: 1800,
        resourceId: "chromium",
        leaseSeconds: 1800,
        previewEnabled: true,
      }
    : {}),
};
await writeFile(
  profile + "/cordis.patch.yml",
  stringify([
    { id: "hmr", disabled: true },
    { id: "directory-picker", disabled: true },
    { id: "tools", config: { mode: "native" } },
    { id: "agent-loop", config: { maxParallelToolCalls: 1 } },
    {
      id: "harness-test",
      config: {
        workspace,
        outputRoot: runs,
        stepTimeoutMs: 600000,
        cleanupTimeoutMs: 180000,
        cancelGraceMs: 500,
        browserConnection,
        browserPreview: {
          schemaVersion: 2,
          enabled: true,
          recordingEnabled: mode === "playwright-video",
          browscreenExecutable:
            process.env.DSH_BROWSCREEN_EXECUTABLE ?? "browscreen",
          port: mediaPort,
          mcpId: mode === "playwright-auto" ? "" : "renamed-web",
        },
      },
    },
    ...model,
    {
      insert: [
        {
          id: "renamed-web",
          name: "@deepseek-ai/dsh-mcp-client",
          config: {
            serverName: "localweb",
            transport: "stdio",
            command: process.execPath,
            args: [
              project + "/node_modules/@playwright/mcp/cli.js",
              "--headless",
              "--browser",
              "chromium",
              "--isolated",
              "--caps",
              "testing",
              "--output-dir",
              output + "/playwright",
            ],
            toolCallTimeoutMs: 60000,
            failOnStartupError: true,
          },
        },
        ...(mode === "mixed"
          ? [
              {
                id: "selenium-source",
                name: "@deepseek-ai/dsh-mcp-client",
                config: {
                  serverName: "selenium",
                  transport: "stdio",
                  command: process.execPath,
                  args: [project + "/tests/fixtures/selenium-mcp/server.mjs"],
                  env: {
                    SELENIUM_MCP_MODE: "native",
                    SELENIUM_MCP_ORIGIN: fixture.origin,
                    SELENIUM_MCP_OUTPUT: output + "/selenium",
                  },
                  toolCallTimeoutMs: 60000,
                  failOnStartupError: true,
                },
              },
            ]
          : []),
        {
          id: "media-probe-state",
          name: project + "/tests/fixtures/selenium-mcp/host-diagnostic.mjs",
        },
      ],
    },
  ]),
  { mode: 0o600 },
);
const sources =
  mode === "mixed"
    ? ["localweb", "runbridge", "selenium"]
    : [mode === "runbridge" ? "runbridge" : "localweb"];
const task =
  "# 多来源计数器验收\n\n浏览器由原工具服务或显式连接组件管理，关闭浏览器不属于业务检查。每条用例只点击一次，固定预期均为数值1，不根据实际结果修改。计数必须采集为number类型；工具返回文本时在调用前声明数值提取规则，不把字符串当成数值，不改写已有观察。\n\n" +
  sources
    .map(
      (source) =>
        `- 必须使用 mcp__${source}__ 下的原生工具打开 ${fixture.origin}/counter?scenario=${source}，点击“增加 1”按钮一次，读取 id 为 counter 的当前数值并检查等于1。使用该来源的截图工具记录原页面。`,
    )
    .join("\n") +
  "\n";
await writeFile(workspace + "/media.md", task);
if (entryFormat === "json") {
  const cases = sources.map((source) => ({
    case_id: "media_" + source,
    name: source + "计数器",
    datasets: [
      {
        data_id: "default",
        inputs: { url: fixture.origin + "/counter?scenario=" + source },
        expected: { counter: 1 },
      },
    ],
    preconditions: [],
    cleanup: [],
    steps: [
      {
        step_id: "operate",
        kind: "action",
        description: "使用指定来源打开计数页、点击一次并读取数值",
        required: true,
        depends_on: [],
        action: {
          goal:
            "必须使用mcp__" +
            source +
            "__工具打开 " +
            fixture.origin +
            "/counter?scenario=" +
            source +
            "，观察当前页面并点击增加1按钮一次，然后用test_capture({})执行冻结的真实数值采集。保持已有连接，不运行shell、不安装工具、不修改固定预期。",
          capability: source === "runbridge" ? "browser" : "tool",
          allowed_targets: [fixture.origin],
          inputs: {},
          outputs: { counter: { type: "number" } },
          completion_requirements: ["counter"],
          capture: {
            counter:
              source === "runbridge"
                ? { kind: "dom", mode: "number", selector: "#counter" }
                : {
                    kind: "tool",
                    tool_name:
                      source === "localweb"
                        ? "mcp__localweb__browser_evaluate"
                        : "mcp__selenium__browser_read",
                    arguments:
                      source === "localweb"
                        ? {
                            function:
                              "() => {const el=document.querySelector('#counter');if(!el)throw new Error('缺少计数元素');return Number(el.textContent);}",
                          }
                        : { selector: "#counter" },
                    extract:
                      source === "localweb"
                        ? { from: "playwright-result", type: "number" }
                        : {
                            from: "structured",
                            pointer: "/text",
                            type: "number",
                          },
                  },
          },
        },
      },
      {
        step_id: "check",
        kind: "assertion",
        description: "计数应为数值1",
        required: true,
        depends_on: ["operate"],
        assertion: {
          observation_ref: "operate.counter",
          operator: "eq",
          expected_ref: "data.expected.counter",
          rule_ref: "counter-rule",
        },
      },
    ],
  }));
  await writeFile(
    workspace + "/media-plan.json",
    JSON.stringify(
      {
        schema_version: "2",
        suite_id: "media-fixture",
        name: "媒体专项固定数值采集",
        source_refs: [
          {
            id: "counter-rule",
            kind: "user",
            uri: "fixture:counter",
            version: "1",
            locator: "固定种子",
            excerpt: "点击增加1一次后计数应为数值1",
          },
        ],
        cases,
      },
      null,
      2,
    ),
  );
}
let child,
  browser,
  url,
  hostLog = "";
async function until(fn, label, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await delay(400);
  }
  throw new Error(label);
}
try {
  child = spawn(process.execPath, [cli, "web", "--no-open", "--port", "0"], {
    cwd: host,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const s of [child.stdout, child.stderr])
    s.on("data", (b) => {
      hostLog += b;
      url ??= hostLog.match(/dsh web: (http:\/\/[^\s]+)/)?.[1];
    });
  await until(() => url, "DSH未就绪");
  await writeFile(
    output + "/state.private.json",
    JSON.stringify({ url, pid: child.pid }),
    { mode: 0o600 },
  );
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await enter(page, { url });
  const audit = () =>
    page.evaluate(async () => (await fetch("/selenium-probe")).json());
  const w = await rpc(page, "workspace/create", {
      request: { path: workspace },
    }),
    { sessionId } = await rpc(page, "session/create", {
      request: { workspaceId: w.workspace.workspaceId },
    });
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        "dsh.sessions.current",
        JSON.stringify({ sessionId: id }),
      ),
    sessionId,
  );
  await page.reload();
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.waitFor();
  await composer.fill(
    "/test-run " + (entryFormat === "json" ? "media-plan.json" : "media.md"),
  );
  await composer.press("Enter");
  console.log(JSON.stringify({ mode, stage: "running" }));
  let run, directory;
  const frames = new Map();
  const previewModes = new Set();
  await until(
    async () => {
      for (const name of await readdir(runs).catch(() => [])) {
        if (!name.startsWith("run-")) continue;
        const d = runs + "/" + name,
          r = await readFile(d + "/results.json", "utf8")
            .then(JSON.parse)
            .catch(() => null);
        if (r?.manifest.origin_session_id === sessionId) {
          run = r;
          directory = d;
        }
      }
      if (run && run.lifecycle !== "FINISHED") {
        const response = await page.request.get(
          new URL(
            "/test-progress/" +
              sessionId +
              "/" +
              run.suite_run_id +
              "/screenshot",
            url,
          ).href,
        );
        if (response.ok()) {
          previewModes.add(response.headers()["x-preview-mode"]);
          const source = run.manifest.active_tool_source ?? "waiting";
          const values = frames.get(source) ?? new Set();
          values.add(
            response.headers()["x-frame-id"] +
              "/" +
              response.headers()["x-capture-started-at"],
          );
          frames.set(source, values);
          if (values.size === 2)
            await page.screenshot({
              path:
                output +
                "/preview-" +
                source.replace(/[^\w-]/g, "_") +
                "-1440x900.png",
            });
        }
      }
      const allow = page.getByRole("button", { name: "允许一次", exact: true });
      if (await allow.isVisible()) await allow.click();
      return run?.lifecycle === "FINISHED";
    },
    "运行未完成",
    1800000,
  );
  const idle = await until(async () => {
    const a = await audit(),
      s = a.sessions.find((s) => s.id === sessionId);
    return (
      s?.closed &&
      s.agent_status === "idle" &&
      s.when_idle &&
      s.pending_tools === 0 &&
      a
    );
  }, "Agent未空闲");
  await writeFile(output + "/idle.json", JSON.stringify(idle, null, 2));
  assert.deepEqual(
    run.instances.map((i) => i.status),
    sources.map(() => "PASS"),
  );
  assert(!run.resource_quarantined);
  assert.equal(fixture.clicks.length, sources.length);
  for (const source of sources)
    assert.equal(fixture.clicks.filter((c) => c.scenario === source).length, 1);
  const events = (await readFile(directory + "/events.jsonl", "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse),
    calls = run.instances.flatMap((i) => i.steps).flatMap((s) => s.calls);
  for (const source of sources)
    assert(
      calls.some((call) => call.name.startsWith("mcp__" + source + "__")),
      "缺少真实来源 " + source,
    );
  for (const source of sources)
    assert(
      calls.some((call) => call.name === `mcp__${source}__browser_click`),
      "缺少指定来源的实际点击: " + source,
    );
  if (rb) {
    assert.equal(run.node_lease.state, "RELEASED");
    assert.equal(run.node_lease.cleanup, "COMPLETE");
    assert.equal(run.node_lease.node_id, rb.node_id);
    assert.equal(
      calls.filter((c) => c.name === "mcp__runbridge__browser_start").length,
      1,
    );
    assert.equal(
      calls.filter((c) => c.name === "mcp__runbridge__browser_stop").length,
      1,
    );
  }
  assert(
    !calls.some((c) => c.name === "mcp__localweb__browser_close"),
    "普通共享 Playwright 不应自动关闭",
  );
  const observed = Object.fromEntries(
    [...frames].map(([source, values]) => [source, values.size]),
  );
  assert(
    Object.values(observed).some((count) => count >= 1),
    "未取得原页面有效画面",
  );
  if (previewModes.has("poll"))
    assert(
      events.some(
        (event) =>
          event.type === "media_frame" &&
          event.payload.mode === "poll" &&
          event.payload.frame >= 2,
      ),
      "定时状态必须有重复采集依据",
    );
  if (mode === "playwright-auto") {
    assert(events.some((e) => e.type === "media_frame"));
    assert((observed["renamed-web"] ?? 0) >= 1);
  }
  if (mode === "playwright-video") {
    assert(run.recordings?.length > 0);
    assert(
      run.recordings.every(
        (recording) =>
          recording.status === "COMPLETE" &&
          recording.case_run_id === run.instances[0].case_run_id,
      ),
    );
  }
  assert(
    existsSync(directory + "/report.html") &&
      existsSync(directory + "/manual-cases.md"),
  );
  const replay = await rebuild(directory);
  assert.deepEqual(
    replay.instances.map((i) => i.status),
    run.instances.map((i) => i.status),
  );
  const report = await context.newPage();
  await report.goto(
    new URL("/test-reports/" + run.suite_run_id + "/report.html", url).href,
  );
  for (const [width, height] of [
    [1440, 900],
    [1920, 1080],
  ]) {
    await report.setViewportSize({ width, height });
    await report.screenshot({
      path: output + `/report-${width}x${height}.png`,
    });
  }
  let videoPlayback = false;
  if (mode === "playwright-video") {
    await report.getByRole("tab", { name: "操作录像", exact: true }).click();
    const video = report.locator("video").first();
    await until(
      () => video.evaluate((v) => v.readyState >= 1 && v.duration > 0),
      "视频未加载",
      30000,
    );
    await video.evaluate((v) => {
      v.muted = true;
      return v.play();
    });
    await until(
      () => video.evaluate((v) => v.currentTime > 0),
      "视频未播放",
      15000,
    );
    await video.evaluate((v) => v.pause());
    const downloaded = report.waitForEvent("download");
    await report.getByRole("link", { name: "下载视频", exact: true }).click();
    await (await downloaded).saveAs(output + "/downloaded.mp4");
    const evidence = run.evidence.find((e) => e.media_type === "video/mp4");
    assert.equal(
      createHash("sha256")
        .update(await readFile(output + "/downloaded.mp4"))
        .digest("hex"),
      evidence.sha256,
    );
    videoPlayback = true;
  }
  assert.deepEqual(errors, []);
  await writeFile(
    output + "/summary.json",
    JSON.stringify(
      {
        status: "PASS",
        mode,
        plugin_version: run.manifest.plugin_version,
        host_version: JSON.parse(
          await readFile(
            host + "/node_modules/@deepseek-ai/dsh/package.json",
            "utf8",
          ),
        ).version,
        candidate_sha256: sha,
        statuses: run.instances.map((i) => i.status),
        sources,
        preview_frames: observed,
        preview_modes: [...previewModes],
        video_playback_download: videoPlayback,
        sdk_loaded_from_host: true,
        node_returned: rb ? run.node_lease.state : undefined,
        media_events: events.filter((e) => e.type.startsWith("media_")).length,
        clicks: fixture.clicks.length,
        run_id: run.suite_run_id,
        report_replay: true,
        agent_idle_scope_closed_pending_zero: true,
        page_errors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ mode, stage: "verified" }));
} finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise((done) => {
      const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
      child.once("exit", () => {
        clearTimeout(timer);
        done();
      });
    });
  }
  await writeFile(output + "/host.private.log", hostLog, { mode: 0o600 });
  await fixture.close();
}
