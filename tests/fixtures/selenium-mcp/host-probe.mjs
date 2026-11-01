import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
/** 在独立 DSH 中核验原生 Selenium 接入边界及现有协议兼容模式。 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { parse, stringify } from "yaml";
import { chromium } from "playwright";
import { enter, openSettings, rpc } from "../../../scripts/compat/browser.mjs";
import { createCounterFixture } from "./counter.mjs";
import { rebuild } from "../../../dist/recorder.js";
assert(process.argv[2], "请提供独立输出目录");
assert(process.env.SELENIUM_PROBE_DSH_ROOT, "请指定已安装公开 DSH rc.5 的目录");
assert(
  process.env.SELENIUM_PROBE_MODEL_PATCH,
  "请指定仅供本机读取的模型补丁文件",
);
const root = resolve(process.argv[2]);
await mkdir(root, { recursive: true });
const project = fileURLToPath(new URL("../../../", import.meta.url));
const host = resolve(process.env.SELENIUM_PROBE_DSH_ROOT),
  cli = host + "/node_modules/@deepseek-ai/dsh/lib/bin.js";
const hostPackage = JSON.parse(
  await readFile(host + "/node_modules/@deepseek-ai/dsh/package.json", "utf8"),
);
assert.equal(hostPackage.version, "0.2.1-rc.5");
const pluginPackage = JSON.parse(
  await readFile(project + "/package.json", "utf8"),
);
const archive = resolve(
  process.env.SELENIUM_PROBE_ARCHIVE ??
    project +
      "/artifacts/package/dsh-test-plugin-" +
      pluginPackage.version +
      ".tgz",
);
const selectedMode = process.argv[3] ?? "all";
assert(
  [
    "native",
    "renamed",
    "minimal",
    "managed",
    "playwright-contract",
    "all",
  ].includes(selectedMode),
);
const entryFormat = process.argv[4] ?? "json";
assert(["json", "markdown"].includes(entryFormat));
const expected = Number(process.env.SELENIUM_PROBE_EXPECTED ?? 1);
assert([1, 2].includes(expected));
const fixtureCode = project + "/tests/fixtures/selenium-mcp";
const sha256 = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
const model = parse(
  await readFile(process.env.SELENIUM_PROBE_MODEL_PATCH, "utf8"),
).filter((p) => ["llm-pi-ai", "agent-default-model"].includes(p.id));
assert.equal(model.length, 2);
const fixture = await createCounterFixture({
  traceFile: root + "/host-clicks.jsonl",
});
const results = [];
let child,
  childText = "",
  activeOutput;
async function command(args, env, file) {
  const p = spawn(process.execPath, [cli, ...args], {
    cwd: host,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [p.stdout, p.stderr])
    stream.on("data", (c) => (log += c));
  const code = await new Promise((done, reject) => {
    p.once("exit", done);
    p.once("error", reject);
  });
  await writeFile(file, log, { mode: 0o600 });
  assert.equal(code, 0, file);
}
async function stop() {
  if (!child) return;
  const p = child;
  child = undefined;
  if (p.exitCode === null && p.signalCode === null) p.kill("SIGTERM");
  await new Promise((done) => {
    if (p.exitCode !== null || p.signalCode !== null) return done();
    const timer = setTimeout(() => p.kill("SIGKILL"), 12000);
    p.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
  await writeFile(activeOutput + "/host.log", childText, { mode: 0o600 });
  let alive = true;
  try {
    process.kill(p.pid, 0);
  } catch (e) {
    if (e.code === "ESRCH") alive = false;
  }
  assert.equal(alive, false);
  return { pid: p.pid, alive, exit: p.exitCode, signal: p.signalCode };
}
async function until(action, message, timeout = 300000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await delay(400);
  }
  throw new Error(message);
}
try {
  for (const mode of selectedMode === "all"
    ? ["native", "renamed", "minimal", "managed"]
    : [selectedMode]) {
    const serverName =
      mode === "playwright-contract"
        ? "playwright"
        : mode === "renamed"
          ? "custom"
          : "selenium";
    const output = root + "/" + entryFormat + "-" + mode;
    activeOutput = output;
    await mkdir(output);
    const home = output + "/home",
      profile = home + "/profiles/web",
      workspace = output + "/workspace",
      runRoot = output + "/runs";
    await mkdir(workspace);
    const env = {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: "1",
      PATH:
        process.execPath.slice(0, process.execPath.lastIndexOf("/")) +
        ":" +
        process.env.PATH,
      npm_config_cache: root + "/npm-cache",
    };
    console.log(JSON.stringify({ mode, stage: "installing" }));
    await command(
      ["plugin", "--profile", "web", "add", archive, "--ignore-scripts"],
      env,
      output + "/plugin-add.log",
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
    const patch = [
      { id: "hmr", disabled: true },
      { id: "directory-picker", disabled: true },
      { id: "tools", config: { mode: "native" } },
      { id: "agent-loop", config: { maxParallelToolCalls: 1 } },
      {
        id: "harness-test",
        config: {
          workspace,
          outputRoot: runRoot,
          stepTimeoutMs: 600000,
          cleanupTimeoutMs: 180000,
          cancelGraceMs: 500,
          browser: {
            backend: "auto",
            ...(mode === "managed"
              ? {
                  resourceLifecycle: {
                    scope: "resource",
                    start: {
                      tool_name: "mcp__selenium__create_context",
                      arguments: {},
                    },
                    close: {
                      tool_name: "mcp__selenium__dispose_context",
                      arguments: {},
                    },
                    identity: { from: "structured", pointer: "/id" },
                    identity_argument: "context_id",
                    released: {
                      from: "structured",
                      pointer: "/released",
                      type: "boolean",
                    },
                  },
                }
              : {}),
          },
        },
      },
      ...model,
      {
        insert: [
          {
            id: "selenium-mcp",
            name: "@deepseek-ai/dsh-mcp-client",
            config: {
              transport: "stdio",
              serverName,
              command: process.execPath,
              args: [fixtureCode + "/server.mjs"],
              cwd: project,
              env: {
                SELENIUM_MCP_MODE: mode,
                SELENIUM_MCP_ORIGIN: fixture.origin,
                SELENIUM_MCP_OUTPUT: output + "/service",
                ...(process.env.SELENIUM_BROWSER_BINARY
                  ? {
                      SELENIUM_BROWSER_BINARY:
                        process.env.SELENIUM_BROWSER_BINARY,
                    }
                  : {}),
                SE_CACHE_PATH:
                  process.env.SE_CACHE_PATH ?? root + "/selenium-cache",
                SE_AVOID_STATS: "true",
              },
              toolCallTimeoutMs: 60000,
              failOnStartupError: true,
            },
          },
          {
            id: "selenium-probe-state",
            name: fixtureCode + "/host-diagnostic.mjs",
          },
        ],
      },
    ];
    await writeFile(profile + "/cordis.patch.yml", stringify(patch), {
      mode: 0o600,
    });
    const target = fixture.origin + "/counter?scenario=" + mode;
    const task = `# 计数器按钮递增验证\n\n- 打开 ${target}，点击“增加 1”按钮一次，检查页面中 id 为 counter 的当前计数数值等于 ${expected}，不得修改此业务预期。${mode !== "minimal" ? "使用当前服务的截图工具记录页面。" : ""}\n`;
    await writeFile(workspace + "/counter.md", task);
    const plan = {
      schema_version: "2",
      suite_id: "selenium-counter",
      name: "Selenium 计数器按钮递增",
      source_refs: [
        {
          id: "counter-rule",
          kind: "user",
          uri: "fixture:counter",
          version: "1",
          locator: "固定种子",
          excerpt: "点击一次后计数应等于" + expected + "。",
        },
      ],
      cases: [
        {
          case_id: "counter",
          name: "计数器点击一次",
          datasets: [
            { data_id: "default", inputs: {}, expected: { counter: expected } },
          ],
          preconditions: [],
          cleanup: [],
          steps: [
            {
              step_id: "operate",
              kind: "action",
              description: "打开本地计数页并点击一次增加 1",
              required: true,
              depends_on: [],
              action: {
                goal: `打开 ${target}，使用当前浏览器工具观察页面，然后通过 test_execute_operation 点击“增加 1”按钮一次，最后 test_capture 采集真实计数。不得运行 shell、安装新工具或修改固定预期；缺少插件所需工具时，如实 test_fail_step 并按 test_current 结算收尾和报告。`,
                capability: "tool",
                allowed_targets: [target],
                inputs: { url: target },
                outputs: { counter: { type: "number" } },
                capture: {
                  counter: {
                    kind: "tool",
                    tool_name: `mcp__${serverName}__${mode === "renamed" ? "get_text" : "browser_read"}`,
                    arguments:
                      mode === "renamed"
                        ? { css: "#counter" }
                        : { selector: "#counter" },
                    extract: {
                      from: "structured",
                      pointer: "/text",
                      type: "number",
                    },
                  },
                },
                completion_requirements: ["counter"],
              },
            },
            {
              step_id: "check",
              kind: "assertion",
              description: "当前计数应等于 1",
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
        },
      ],
    };
    if (mode !== "minimal")
      plan.cases[0].steps[0].action.goal +=
        " 使用当前服务的截图工具记录页面，调用用途为observe。";
    await writeFile(
      workspace + "/counter-plan.json",
      JSON.stringify(plan, null, 2) + "\n",
    );
    childText = "";
    let url;
    child = spawn(process.execPath, [cli, "web", "--no-open", "--port", "0"], {
      cwd: host,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (c) => {
        childText += c;
        url ??= childText.match(/dsh web: (http:\/\/[^\s]+)/)?.[1];
      });
    await until(() => url, "独立 DSH 未就绪", 90000);
    await writeFile(
      output + "/state.json",
      JSON.stringify(
        { url, pid: child.pid, mode, home, output, runRoot },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await enter(page, { url });
      const audit = () =>
        page.evaluate(async () => {
          const r = await fetch("/selenium-probe");
          if (!r.ok) throw new Error("状态探针失败");
          return r.json();
        });
      const catalog = await until(
        async () => {
          const a = await audit();
          return a.catalog.some((n) => n.startsWith(`mcp__${serverName}__`))
            ? a.catalog
            : false;
        },
        "Selenium MCP 未注册",
        60000,
      );
      const mcp = catalog.filter((n) => n.startsWith("mcp__"));
      assert(!mcp.some((n) => n.startsWith("mcp__runbridge__")));
      if (mode !== "playwright-contract")
        assert(!mcp.some((n) => n.startsWith("mcp__playwright__")));
      assert(!existsSync(host + "/node_modules/@playwright/mcp"));
      await writeFile(
        output + "/catalog.json",
        JSON.stringify(
          {
            mcp,
            playwright_mcp_package: false,
            service_script: fixtureCode + "/server.mjs",
          },
          null,
          2,
        ),
      );
      const settings = await context.newPage();
      await enter(settings, { url });
      await openSettings(settings);
      assert.equal(
        await settings.locator("#dsh-test-browser-backend").count(),
        0,
      );
      assert(
        (await settings
          .getByRole("tab", { name: "工具接入", exact: true })
          .getAttribute("aria-selected")) === "true",
      );
      await settings
        .getByText(serverName + "（selenium-mcp）", { exact: true })
        .waitFor();
      for (const [width, height] of [
        [1440, 900],
        [1920, 1080],
      ]) {
        await settings.setViewportSize({ width, height });
        await settings.screenshot({
          path: output + `/settings-connections-${width}x${height}.png`,
        });
      }
      if (mode !== "minimal") {
        await settings
          .getByRole("tab", { name: "实时画面", exact: true })
          .click();
        await settings
          .getByRole("checkbox", { name: "显示实时画面", exact: true })
          .check();
        await settings
          .getByRole("button", { name: "保存画面偏好", exact: true })
          .click();
        await settings
          .getByRole("status")
          .filter({ hasText: "已保存" })
          .first()
          .waitFor();
        const prefs = parse(
          await readFile(profile + "/cordis.patch.yml", "utf8"),
        ).find((row) => row.id === "harness-test").config.browserPreview;
        assert.equal(prefs.enabled, true);
        assert.equal(prefs.mcpId, "");
        for (const [width, height] of [
          [1440, 900],
          [1920, 1080],
        ]) {
          await settings.setViewportSize({ width, height });
          await settings.screenshot({
            path: output + `/settings-media-${width}x${height}.png`,
          });
        }
      }
      await settings.close();
      const workspaceValue = await rpc(page, "workspace/create", {
        request: { path: workspace },
      });
      const created = await rpc(page, "session/create", {
        request: { workspaceId: workspaceValue.workspace.workspaceId },
      });
      const id = created.sessionId;
      await rpc(page, "session/rename", {
        request: { sessionId: id, title: "Selenium " + mode + " 计数器验证" },
      });
      await page.evaluate(
        (id) =>
          localStorage.setItem(
            "dsh.sessions.current",
            JSON.stringify({ sessionId: id }),
          ),
        id,
      );
      await page.reload();
      const composer = page.locator('[contenteditable="true"]').first();
      await composer.waitFor();
      await composer.fill(
        "/test-run " +
          (entryFormat === "json" ? "counter-plan.json" : "counter.md"),
      );
      await composer.press("Enter");
      console.log(JSON.stringify({ mode, stage: "running" }));
      let run, directory;
      const mediaFrames = new Set();
      await until(
        async () => {
          for (const n of await readdir(runRoot).catch(() => [])) {
            const d = runRoot + "/" + n;
            const r = await readFile(d + "/results.json", "utf8")
              .then(JSON.parse)
              .catch(() => null);
            if (r?.manifest.origin_session_id === id) {
              run = r;
              directory = d;
            }
          }
          if (run && mode !== "minimal" && run.lifecycle !== "FINISHED") {
            const image = await page.request.get(
              new URL(
                "/test-progress/" + id + "/" + run.suite_run_id + "/screenshot",
                url,
              ).href,
            );
            if (image.ok())
              mediaFrames.add(
                image.headers()["x-frame-id"] +
                  "/" +
                  image.headers()["x-capture-started-at"],
              );
          }
          const a = await audit();
          if (a.sessions.length)
            await writeFile(
              output + "/agent-state.json",
              JSON.stringify(a, null, 2),
            );
          const allow = page.getByRole("button", {
            name: "允许一次",
            exact: true,
          });
          if (await allow.isVisible()) await allow.click();
          return run?.lifecycle === "FINISHED";
        },
        "用例未在期限内封存",
        1200000,
      );
      const settled = await until(
        async () => {
          const state = await audit();
          const s = state.sessions.find((s) => s.id === id);
          return (
            s?.closed &&
            s.agent_status === "idle" &&
            s.when_idle &&
            s.pending_tools === 0 &&
            state
          );
        },
        "Agent 未完全空闲",
        120000,
      );
      await writeFile(
        output + "/idle-state.json",
        JSON.stringify(settled, null, 2),
      );
      const saved = JSON.parse(
        await readFile(directory + "/results.json", "utf8"),
      );
      const statuses = saved.instances.map((i) => i.status);
      assert.deepEqual(statuses, [expected === 1 ? "PASS" : "FAIL"]);
      assert(existsSync(directory + "/report.html"));
      assert(existsSync(directory + "/manual-cases.md"));
      assert(existsSync(directory + "/actual-steps.json"));
      const replay = await rebuild(directory);
      assert.deepEqual(
        replay.instances.map((i) => i.status),
        statuses,
      );
      const report = await context.newPage();
      await report.goto(
        new URL("/test-reports/" + saved.suite_run_id + "/report.html", url)
          .href,
      );
      assert((await report.locator("body").innerText()).includes("测试用例"));
      for (const [width, height] of [
        [1440, 900],
        [1920, 1080],
      ]) {
        await report.setViewportSize({ width, height });
        await report.screenshot({
          path: output + `/report-${width}x${height}.png`,
        });
      }
      const download = report.waitForEvent("download");
      await report
        .getByRole("link", { name: /下载手工用例/ })
        .first()
        .click();
      await (await download).saveAs(output + "/downloaded-manual.md");
      assert.equal(
        await readFile(output + "/downloaded-manual.md", "utf8"),
        await readFile(directory + "/manual-cases-1.md", "utf8"),
      );
      await report.close();
      const calls = saved.instances
        .flatMap((i) => i.steps)
        .flatMap((s) => s.calls);
      const checks = saved.instances
        .flatMap((i) => i.steps)
        .flatMap((s) => (s.assertion ? [s.assertion] : []));
      const source = output + "/service/selenium.jsonl";
      const trace = existsSync(source)
        ? (await readFile(source, "utf8"))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse)
        : [];
      const clicks = fixture.clicks.filter((c) => c.scenario === mode).length;
      assert.equal(clicks, 1);
      assert(trace.some((e) => e.event === "session_opened"));
      assert(
        trace.some(
          (e) =>
            (e.operation ?? e.tool) === "browser_click" &&
            e.event === "tool_finished" &&
            e.ok,
        ),
      );
      assert(
        checks.some(
          (c) =>
            c.status === (expected === 1 ? "PASS" : "FAIL") &&
            c.actual === 1 &&
            c.expected === expected,
        ),
      );
      if (mode === "minimal")
        assert(!saved.evidence.some((e) => e.media_type.startsWith("image/")));
      else if (expected === 1)
        assert(saved.evidence.some((e) => e.media_type === "image/png"));
      if (mode === "managed") {
        assert(trace.some((e) => e.event === "session_closed"));
        assert.equal(saved.instances[0].resources.tool_context.state, "absent");
      } else assert.equal(saved.manifest.resource_management, "external");
      assert.deepEqual(errors, []);
      const result = {
        mode,
        entry_format: entryFormat,
        expected,
        resource_management: saved.manifest.resource_management,
        execution_source: saved.manifest.execution_source,
        manual_download_verified: true,
        sdk_loaded_from_host: true,
        media_frames_observed: mediaFrames.size,
        media_events: (await readFile(directory + "/events.jsonl", "utf8"))
          .split("\n")
          .filter((line) => line.includes("media_")).length,
        status: "PASS",
        plugin_version: saved.manifest.plugin_version,
        host_version: hostPackage.version,
        candidate_sha256: sha256,
        case_statuses: statuses,
        quarantined: saved.resource_quarantined,
        clicks,
        mcp,
        run_id: saved.suite_run_id,
        directory,
        report: directory + "/report.html",
        report_replay: true,
        manual_markdown: true,
        agent_idle_scope_closed_pending_zero: true,
        assertions: checks.map((c) => ({
          status: c.status,
          expected: c.expected,
          actual: c.actual,
        })),
        failed_calls: calls
          .filter((c) => c.isError)
          .map((c) => ({ name: c.name, result: c.result })),
        selenium_sessions: trace
          .filter((e) => e.event === "session_opened")
          .map((e) => ({
            session_id: e.session_id,
            browser: e.browser,
            browser_version: e.browser_version,
          })),
        playwright_mcp_package: false,
        page_errors: errors,
      };
      await writeFile(
        output + "/summary.json",
        JSON.stringify(result, null, 2),
      );
      results.push(result);
      console.log(
        JSON.stringify({
          mode,
          stage: "verified",
          case_statuses: statuses,
          clicks,
        }),
      );
    } finally {
      await browser.close();
    }
    // 测试夹具先自行退出并确认原 Selenium 会话关闭，再停宿主；不让宿主强制退出抢先截断 quit 回执。
    const serviceTrace = output + "/service/selenium.jsonl";
    const beforeStop = (await readFile(serviceTrace, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    if (!beforeStop.some((e) => e.event === "session_closed")) {
      const servicePid = beforeStop.find(
        (e) => e.event === "session_opened",
      )?.pid;
      assert(Number.isSafeInteger(servicePid));
      process.kill(servicePid, "SIGTERM");
      await until(
        async () =>
          (await readFile(serviceTrace, "utf8"))
            .trim()
            .split("\n")
            .map(JSON.parse)
            .some((e) => e.event === "session_closed"),
        "测试夹具的原 Selenium 会话未关闭",
        15000,
      );
    }
    const stopped = await stop();
    results.at(-1).host_stopped = stopped;
    const ended = (await readFile(output + "/service/selenium.jsonl", "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert(ended.some((e) => e.event === "session_closed"));
    results.at(-1).selenium_released_after_host_stop = true;
    await writeFile(
      output + "/summary.json",
      JSON.stringify(results.at(-1), null, 2),
    );
  }
  await writeFile(
    root + "/host-results.json",
    JSON.stringify({ status: "PASS", results }, null, 2),
  );
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
  await writeFile(root + "/failure.txt", error.stack);
} finally {
  await stop();
  await fixture.close();
}
