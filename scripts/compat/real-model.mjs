/** 在真实宿主、模型及 Playwright MCP 上验证用户 Markdown/CSV 入口。 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { enter, rpc } from "./browser.mjs";
import { assertDraftCancellation } from "./gitlab-ui.mjs";
import {
  actualStepsDocument,
  manualCasesMarkdown,
} from "../../dist/manual-case.js";
import { readManualSource } from "../../dist/manual-source.js";
import { seeds } from "../gitlab/plans.mjs";
import { publicGet } from "../gitlab/client.mjs";

const state = JSON.parse(await readFile(process.argv[2], "utf8"));
const mode = process.argv[3] ?? "full";
assert(
  ["full", "gitlab-ui", "gitlab-draft"].includes(mode),
  "模式仅支持 full、gitlab-ui 或 gitlab-draft",
);
if (mode !== "full")
  assert(process.env.DSH_GITLAB_STATE, "缺少 GitLab 准备记录");
const evidence = join(state.output, "real-model");
await mkdir(evidence);
const workspace = join(state.root, "workspace"),
  runRoot = join(state.root, "runs");
let slowRequests = 0,
  laterRequests = 0;
const fixture = createServer((req, res) => {
  if (req.url === "/api/slow") {
    slowRequests++;
    const timer = setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"amount":101}');
    }, 20000);
    res.once("close", () => clearTimeout(timer));
    return;
  }
  if (req.url === "/api/later") laterRequests++;
  if (req.url.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"amount":101}');
  } else {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      '<!doctype html><html lang="zh-CN"><title>固定登录页夹具</title><body><h1>登录</h1><label>账号<input id="username" aria-label="账号"></label><label>密码<input id="password" aria-label="密码" type="password"></label><button>登录</button></body></html>',
    );
  }
});
await new Promise((done) => fixture.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${fixture.address().port}`;
await writeFile(
  join(workspace, "ui.md"),
  `# 页面元素检查\n\n浏览器由插件内置生命周期管理，关闭浏览器不属于业务检查步骤。业务计划只包含下列页面元素检查，不另行增加关闭页面的业务步骤。\n\n- 打开 ${origin}/，检查页面存在账号输入框、密码输入框以及文字为“登录”的按钮。只查看，不填写账号密码，不提交表单。\n`,
);
for (const [name, expected] of [
  ["api", 101],
  ["api-fail", 100],
])
  await writeFile(
    join(workspace, name + ".md"),
    `- 使用 GET 请求 ${origin}/api/amount，读取 body.amount，断言数值等于 ${expected}。预期来自固定夹具种子，不根据实际响应修改预期。\n`,
  );
await writeFile(
  join(workspace, "csv.md"),
  `- 使用 GET 请求 ${origin}/api/amount，读取 body.amount，断言数值等于 \${expected}。预期来自固定 CSV，不根据实际响应修改预期。\n`,
);
await writeFile(join(workspace, "data.csv"), "expected\n101\n100\n");
await writeFile(
  join(workspace, "stop.md"),
  `- 使用 GET 请求 ${origin}/api/slow，断言 body.amount 等于 101，再 GET ${origin}/api/later，断言 body.amount 等于 101。两个请求必须依次执行。\n`,
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  locale: "zh-CN",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const summary = {
  host_version: state.version,
  plugin_version: state.plugin_version,
  candidate_sha256: state.candidate_sha256,
  mode,
  exemption: false,
  cases: [],
};
const save = () =>
  writeFile(
    join(state.output, "real-model.json"),
    JSON.stringify(summary, null, 2),
  );
const seen = new Set();
async function allow() {
  const button = page.getByRole("button", { name: "允许一次", exact: true });
  if (await button.isVisible()) await button.click();
}
async function until(check, message, timeout = 1800000) {
  const begin = Date.now();
  while (Date.now() - begin < timeout) {
    await allow();
    const value = await check();
    if (value) return value;
    await page.waitForTimeout(400);
  }
  throw new Error(message);
}
async function runs(sessionId) {
  const found = [];
  for (const name of await readdir(runRoot).catch(() => [])) {
    if (!name.startsWith("run-")) continue;
    const directory = join(runRoot, name);
    const run = await readFile(join(directory, "results.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (run?.manifest.origin_session_id === sessionId && !seen.has(name))
      found.push({ directory, run });
  }
  return found;
}
const waitRun = (sessionId, finished = false) =>
  until(
    async () =>
      (await runs(sessionId)).find(
        ({ run }) => !finished || run.lifecycle === "FINISHED",
      ),
    "运行记录未按时完成",
  );
async function waitIdle(sessionId) {
  return until(
    async () => {
      const rows = await page.evaluate(async () => {
        const r = await fetch("/compat-audit-state");
        if (!r.ok) throw new Error("缺少实际 Agent 状态探针");
        return r.json();
      });
      const selected = sessionId
        ? rows.filter((row) => row.id === sessionId)
        : rows;
      return (
        (!sessionId || selected.length > 0) &&
        selected.every(
          (row) =>
            row.closed &&
            row.agentStatus === "idle" &&
            row.whenIdleResolved &&
            row.pendingTools === 0,
        )
      );
    },
    "Agent、测试作用域或在途调用未释放",
    240000,
  );
}
async function select(sessionId) {
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        "dsh.sessions.current",
        JSON.stringify({ sessionId: id }),
      ),
    sessionId,
  );
  await page.reload();
  await page.locator('[contenteditable="true"]').first().waitFor();
}
async function send(text) {
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.fill(text);
  await composer.press("Enter");
}
async function approve() {
  const review = page.locator("[data-plan-review-key]");
  await review.waitFor({ state: "visible", timeout: 180000 });
  await page.getByRole("button", { name: "同意执行", exact: true }).click();
}
async function verify(sessionId, kind, statuses) {
  const { directory, run } = await waitRun(sessionId, true);
  seen.add(run.suite_run_id);
  const item = {
    kind,
    session_id: sessionId,
    run_id: run.suite_run_id,
    statuses: run.instances.map((i) => i.status),
    same_session: run.instances.every(
      (i) => i.session_id === sessionId && i.cleanup_session_id === sessionId,
    ),
    resource_quarantined: run.resource_quarantined,
    directory,
  };
  summary.cases.push(item);
  await save();
  assert.deepEqual(item.statuses, statuses, `${kind} 不符合固定预期`);
  assert(item.same_session, "执行或清理离开原会话");
  assert.equal(run.resource_quarantined, false);
  assert.equal(run.manifest.plugin_version, state.plugin_version);
  if (kind === "gitlab-api") {
    const prepared = JSON.parse(
      await readFile(resolve(process.env.DSH_GITLAB_STATE), "utf8"),
    );
    const checks = (index, path, expected) =>
      run.instances[index].steps.filter(
        (step) =>
          step.assertion?.status === "PASS" &&
          step.assertion.operator === "eq" &&
          step.assertion.operand_snapshot.actual_path.endsWith(path) &&
          step.assertion.actual === expected &&
          step.assertion.expected === expected,
      ).length;
    for (const [path, expected] of [
      [".status", 200],
      [".body.length", 1],
      [".body.0.id", prepared.projects.api.id],
      [".body.0.path", prepared.projects.api.path],
      [".body.0.visibility", "public"],
    ])
      assert(
        checks(0, path, expected) >= 1,
        `GitLab 项目检索缺少固定检查 ${path}`,
      );
    assert.equal(checks(1, ".status", 200), 4, "GitLab 四页状态码检查不完整");
    assert.equal(
      checks(1, ".body.length", 1),
      3,
      "GitLab 前三页固定长度检查不完整",
    );
    assert(
      checks(1, ".body.length", 0) === 1 ||
        run.instances[1].steps.some(
          (step) =>
            step.assertion?.status === "PASS" &&
            step.assertion.operator === "eq" &&
            step.assertion.operand_snapshot.actual_path.endsWith(".body") &&
            JSON.stringify(step.assertion.actual) === "[]" &&
            JSON.stringify(step.assertion.expected) === "[]",
        ),
      "GitLab 第四页空数组未得到可信断言",
    );
    for (const [index, seed] of seeds.entries()) {
      assert(
        checks(1, ".body.0.iid", prepared.projects.api.issues[index].iid) >= 1,
        "GitLab 固定 Issue 编号不完整",
      );
      assert(
        checks(1, ".body.0.title", seed.title) >= 1,
        "GitLab 固定 Issue 标题不完整",
      );
    }
    assert(
      checks(2, ".status", 404) === 1 &&
        checks(2, ".body.message", "404 Project Not Found") === 1,
      "GitLab 缺失项目反例不完整",
    );
    item.fixed_seed_checks = true;
  }
  if (kind === "ui")
    assert(
      run.instances[0].steps.filter((step) => step.assertion?.status === "PASS")
        .length >= 3,
      "页面三个检查点没有全部形成可信断言",
    );
  if (kind === "api" || kind === "api-fail" || kind === "csv") {
    const expected = kind === "csv" ? [101, 100] : [kind === "api" ? 101 : 100];
    for (const [index, instance] of run.instances.entries())
      assert(
        instance.steps.some(
          (step) =>
            step.assertion?.actual === 101 &&
            step.assertion.expected === expected[index],
        ),
        "缺少固定 amount 真值与预期的可信断言",
      );
    assert(
      !run.evidence.some((e) => /^(image|video)\//.test(e.media_type)),
      "纯接口混入浏览器媒体",
    );
  }
  const validated = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../validate-report.mjs", import.meta.url)),
      directory,
    ],
    { encoding: "utf8", timeout: 120000 },
  );
  assert.equal(
    validated.status,
    0,
    `报告重放或证据核对失败：${validated.stderr}`,
  );
  item.report_integrity = true;
  if (kind === "gitlab-ui_draft_cancel") {
    const prepared = JSON.parse(
      await readFile(resolve(process.env.DSH_GITLAB_STATE), "utf8"),
    );
    assertDraftCancellation(
      actualStepsDocument(run),
      prepared.origin +
        "/" +
        prepared.projects.ui.path_with_namespace +
        "/-/work_items",
      run,
    );
    item.native_cancel_without_repair_navigation = true;
  }
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, "actual-steps.json"), "utf8")),
    actualStepsDocument(run),
    "实际步骤导出与最终运行记录不一致",
  );
  assert.equal(
    await readFile(join(directory, "manual-cases.md"), "utf8"),
    manualCasesMarkdown(
      run,
      undefined,
      readManualSource(directory, run.suite_run_id),
    ),
    "手工用例导出与最终记录不一致",
  );
  item.manual_exports_match = true;
  const report = await context.newPage();
  await report.goto(
    new URL(`/test-reports/${run.suite_run_id}/report.html`, state.url).href,
  );
  assert((await report.textContent("body")).includes("实际值 ACTUAL"));
  await report.screenshot({
    path: join(evidence, `${kind}-report.png`),
    fullPage: true,
  });
  await report.close();
  await waitIdle(sessionId);
  item.agent_idle_scope_closed_pending_zero = true;
  await save();
  console.log(
    `${state.version}：${kind} ${item.statuses.join(",")}，报告重放及资源释放通过`,
  );
  return run;
}
try {
  await enter(page, state);
  const workspaceValue = await rpc(page, "workspace/create", {
    request: { path: workspace },
  });
  async function newSession(title) {
    await waitIdle();
    const created = await rpc(page, "session/create", {
      request: { workspaceId: workspaceValue.workspace.workspaceId },
    });
    await rpc(page, "session/rename", {
      request: {
        sessionId: created.sessionId,
        title: `${state.version} ${title}`,
      },
    });
    await select(created.sessionId);
    return created.sessionId;
  }
  if (mode === "full") {
    const sessionId = await newSession("Markdown UI 和同会话连续运行");
    await send("/test-plan --file ui.md");
    const review = page.locator("[data-plan-review-key]");
    await review.waitFor({ state: "visible", timeout: 180000 });
    await page.screenshot({
      path: join(evidence, "plan-review.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "要求修改", exact: true }).click();
    await review.waitFor({ state: "hidden" });
    await page.waitForTimeout(1500);
    assert.equal(await review.count(), 0, "关闭审核后自动重开");
    const pending = await waitRun(sessionId);
    assert.equal(pending.run.instances.length, 0);
    assert(!existsSync(join(pending.directory, "plan.json")));
    summary.review = {
      dismissed_without_dispatch: true,
      no_frozen_plan: true,
      not_reopened: true,
    };
    await save();
    await send("保持原用例内容不变，请重新提交计划并展示原生审核。");
    await approve();
    await verify(sessionId, "ui", ["PASS"]);
    await send("请仅回复：兼容检查完成。不要调用任何工具。");
    await page
      .getByText(/^兼容检查完成[。.!！]?$/)
      .last()
      .waitFor({ timeout: 120000 });
    await waitIdle(sessionId);
    summary.ordinary_chat_after_test = true;
    await send("/test-run api.md");
    await verify(sessionId, "api", ["PASS"]);
    summary.same_session_next_run = true;
    const negativeSession = await newSession("Markdown 固定反例");
    await send("/test-run api-fail.md");
    await verify(negativeSession, "api-fail", ["FAIL"]);
    const csvSession = await newSession("CSV 多实例");
    await send("/test-data data.csv --file csv.md");
    await approve();
    await verify(csvSession, "csv", ["PASS", "FAIL"]);
    const cancelSession = await newSession("原生审核取消");
    await send("/test-plan --file api.md");
    await review.waitFor({ state: "visible", timeout: 180000 });
    const beforeCancel = await waitRun(cancelSession);
    assert(!existsSync(join(beforeCancel.directory, "plan.json")));
    await rpc(page, "session/cancel", {
      request: { sessionId: cancelSession },
    });
    const cancelled = await waitRun(cancelSession, true);
    await waitIdle(cancelSession);
    seen.add(cancelled.run.suite_run_id);
    assert(
      cancelled.run.instances.every(
        (i) =>
          i.status !== "PASS" && i.steps.every((s) => s.calls.length === 0),
      ),
      "审核取消后仍执行业务",
    );
    summary.review.cancel_without_business = true;
    const stopSession = await newSession("接口在途停止");
    await send("/test-run stop.md");
    await until(() => slowRequests > 0, "没有进入固定慢接口");
    await rpc(page, "session/cancel", { request: { sessionId: stopSession } });
    const stopped = await waitRun(stopSession, true);
    await waitIdle(stopSession);
    assert.equal(laterRequests, 0, "停止后又执行了后续业务请求");
    assert(stopped.run.instances.every((i) => i.status !== "PASS"));
    assert.equal(stopped.run.resource_quarantined, false);
    summary.stop = {
      run_id: stopped.run.suite_run_id,
      in_flight: true,
      later_requests: laterRequests,
      agent_idle_scope_closed_pending_zero: true,
    };
  }
  if (process.env.DSH_GITLAB_STATE) {
    const preparedFile = resolve(process.env.DSH_GITLAB_STATE);
    const prepared = JSON.parse(await readFile(preparedFile, "utf8"));
    assert.equal(
      prepared.status,
      "prepared",
      "GitLab 数据必须是本轮尚未执行的准备记录",
    );
    assert(/^dsh-gitlab-[a-z0-9-]+$/.test(prepared.marker));
    for (const [kind, statuses] of mode === "gitlab-draft"
      ? [["ui_draft_cancel", ["PASS"]]]
      : mode === "gitlab-ui"
        ? [
            ["ui_filters", ["PASS"]],
            ["ui_draft_cancel", ["PASS"]],
          ]
        : [
            ["api", ["PASS", "PASS", "PASS"]],
            ["ui_filters", ["PASS"]],
            ["ui_draft_cancel", ["PASS"]],
          ]) {
      await cp(
        join(dirname(preparedFile), kind + ".md"),
        join(workspace, `gitlab-${kind}.md`),
      );
      const id = await newSession(`GitLab Markdown ${kind}`);
      await send(`/test-run gitlab-${kind}.md`);
      await verify(id, `gitlab-${kind}`, statuses);
    }
    const closed = await publicGet(
      prepared.origin,
      `/projects/${prepared.projects.ui.id}/issues?state=closed&labels=dsh-smoke`,
    );
    assert.equal(closed.status, 200);
    assert.equal(closed.body.length, 1);
    assert.equal(closed.body[0].iid, prepared.projects.ui.issues[2].iid);
    assert.equal(closed.body[0].title, seeds[2].title);
    const draft = await publicGet(
      prepared.origin,
      `/projects/${prepared.projects.ui.id}/issues?search=${encodeURIComponent(prepared.marker + "-cancelled-draft")}`,
    );
    assert.equal(draft.status, 200);
    assert.deepEqual(draft.body, [], "取消的 UI 草稿仍被持久化");
    summary.gitlab = {
      marker: prepared.marker,
      state_file: preparedFile,
      markdown_ui_and_api: mode === "full",
      final_persistence_checked: true,
    };
  }
  assert.deepEqual(errors, []);
  summary.status = "PASS";
} catch (error) {
  summary.status = "FAIL";
  summary.error = error.message;
  process.exitCode = 1;
  await page
    .screenshot({ path: join(evidence, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error(`${state.version}：真实模型验收失败 ${error.message}`);
} finally {
  summary.page_errors = errors;
  await save();
  await browser.close();
  fixture.closeAllConnections();
  await new Promise((done) => fixture.close(done));
}
