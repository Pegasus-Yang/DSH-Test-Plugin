/** 真实Harness命令驱动验收；浏览器仅操作宿主审批与报告，不代执行测试动作。 */
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const { url } = JSON.parse(
  await readFile(
    process.env.DSH_TEST_STATE ?? ".local/host-state.json",
    "utf8",
  ),
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
await page.goto(url);
await page.waitForTimeout(1500);
if (await page.getByRole("button", { name: "继续", exact: true }).count())
  await page.getByRole("button", { name: "继续", exact: true }).click();
// 命令持续到清理结束；请求独立于展示页导航，审批切换不取消运行。
const rpc = async (method, args) =>
  (
    await page
      .context()
      .request.post(new URL("/api/" + method, url).href, {
        data: {
          type: "client-request",
          rpcId: crypto.randomUUID(),
          method,
          payload: { args },
        },
        timeout: 780000,
      })
  ).json();
const created = await rpc("session/create", {
    request: { cwd: process.cwd() },
  }),
  sessionId = created.result.value.sessionId;
const pendingCommand = rpc("commands/execute", {
  agentId: sessionId,
  line: "/test-run " + (process.argv[2] ?? "examples/ceshiren-agent.json"),
  submittedAttachments: [],
}).then(
  (value) => ({ value }),
  (error) => ({ error }),
);
let runId, directory;
for (let n = 0; n < 30; n++) {
  const status = await rpc("commands/execute", {
    agentId: sessionId,
    line: "/test-status",
    submittedAttachments: [],
  });
  const state = JSON.parse(status.result.value.result.text);
  if (state.run) {
    runId = state.run.id;
    directory = state.run.directory;
    break;
  }
  await page.waitForTimeout(200);
}
if (!directory)
  throw new Error("测试未启动：" + JSON.stringify(await pendingCommand));
let selected, last, run;
try {
  for (let n = 0; n < 360; n++) {
    run = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
    const active = run.instances.find((i) => i.lifecycle === "RUNNING");
    const desired = active?.cleanup_session_id ?? active?.session_id;
    if (desired && desired !== selected) {
      selected = desired;
      await page.evaluate(
        (id) =>
          localStorage.setItem(
            "dsh.sessions.current",
            JSON.stringify({ sessionId: id }),
          ),
        selected,
      );
      await page.reload();
    }
    const allow = page.getByRole("button", { name: "允许一次", exact: true });
    if (await allow.count()) {
      console.log("批准当前用例的原生审批");
      await allow.click();
    }
    const progress = run.instances
      .map(
        (i) =>
          i.status +
          ":" +
          i.steps.map((s) => s.step_id + "=" + s.status).join(","),
      )
      .join(";");
    if (progress !== last) {
      console.log(progress);
      last = progress;
    }
    if (run.lifecycle === "FINISHED") break;
    if (n === 359) throw new Error("验收等待超过12分钟");
    await page.waitForTimeout(2000);
  }
  const settled = await pendingCommand;
  if (
    settled.error ||
    !settled.value?.result.ok ||
    settled.value.result.value.result.kind === "error"
  )
    throw new Error(JSON.stringify(settled));
  await mkdir("artifacts/validation/ceshiren", { recursive: true });
  await writeFile(
    "artifacts/validation/ceshiren/latest.json",
    JSON.stringify(
      {
        run_id: runId,
        directory,
        statistics: run.instances.map((i) => ({
          id: i.case_run_id,
          status: i.status,
        })),
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: join(directory, "harness-session.png"),
    fullPage: true,
  });
  const report = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  report.on("pageerror", (e) => errors.push(String(e)));
  await report.goto(pathToFileURL(join(directory, "report.html")).href);
  await report.screenshot({
    path: join(directory, "report-desktop.png"),
    fullPage: true,
  });
  await report.locator("#status").selectOption(run.instances[0].status);
  if (
    (await report.locator("article.case:visible").count()) !==
    run.instances.filter((i) => i.status === run.instances[0].status).length
  )
    throw new Error("报告筛选不一致");
  await report.getByRole("button", { name: "清除筛选" }).click();
  await report.setViewportSize({ width: 390, height: 844 });
  await report.screenshot({
    path: join(directory, "report-mobile.png"),
    fullPage: true,
  });
  if (errors.length) throw new Error("报告脚本错误: " + errors.join());
  console.log(
    JSON.stringify(
      {
        directory,
        status: run.instances.map((i) => i.status),
        assertions: run.instances.flatMap((i) =>
          i.steps.filter((s) => s.assertion).map((s) => s.assertion),
        ),
        report_errors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
