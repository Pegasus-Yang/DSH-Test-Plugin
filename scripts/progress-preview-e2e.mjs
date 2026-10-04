/** 从真实 DSH 输入框验收规划、进度与条件浮窗；只操作隔离本地夹具。 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const { url } = JSON.parse(
  await readFile(
    process.env.DSH_TEST_STATE ?? ".local/progress-host-state.json",
    "utf8",
  ),
);
const root = resolve(
  process.env.DSH_TEST_OUTPUT ?? "artifacts/validation/progress-preview/runs",
);
const evidence = resolve(
  process.env.DSH_PREVIEW_E2E_EVIDENCE ??
    "artifacts/validation/progress-preview/web",
);
await mkdir(evidence, { recursive: true });
const fixture = createServer((req, res) => {
  if (req.url === "/api/amount") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ amount: 101 }));
    return;
  }
  res.setHeader("Content-Type", "text/html;charset=utf-8");
  res.end(
    "<!doctype html><title>实时预览夹具</title><style>body{background:#eef4fc;font:30px system-ui;padding:60px}button{font:20px system-ui;padding:14px}</style><h1>PREVIEW BEFORE</h1><button onclick=\"document.body.style.background='#e7f4ed';document.querySelector('h1').textContent='PREVIEW AFTER'\">改变页面</button>",
  );
});
await new Promise((done) => fixture.listen(0, "127.0.0.1", done));
const target = `http://127.0.0.1:${fixture.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  locale: "zh-CN",
});
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const results = [];
try {
  await page.goto(url);
  await page.goto(new URL("/", url).href);
  const welcome = page.getByRole("button", { name: "继续", exact: true });
  await welcome.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await welcome.isVisible()) await welcome.click();
  await page
    .getByRole("button", { name: "新建会话", exact: true })
    .first()
    .waitFor({ timeout: 30000 });
  for (const mode of process.env.DSH_PREVIEW_E2E_MODE
    ? [process.env.DSH_PREVIEW_E2E_MODE]
    : ["api", "browser"]) {
    const previous = new Set(await readdir(root));
    const previousSession = await page
      .locator("[data-conversation-content]")
      .first()
      .getAttribute("data-conversation-session");
    const previousPhase = await page
      .locator("[data-conversation-content]")
      .first()
      .getAttribute("data-content-phase");
    await page
      .getByRole("button", { name: "新建会话", exact: true })
      .first()
      .click();
    await page.waitForFunction(
      ({ previousSession, previousPhase }) => {
        const content = document.querySelector("[data-conversation-content]");
        return (
          content &&
          content.dataset.contentPhase === "hero" &&
          content.dataset.conversationSession &&
          (previousPhase === "hero" ||
            content.dataset.conversationSession !== previousSession)
        );
      },
      { previousSession, previousPhase },
      { timeout: 15000 },
    );
    const composer = page.locator('[contenteditable="true"]').first();
    await composer.fill(
      mode === "api"
        ? `/test-plan 发送GET请求到 ${target}/api/amount，验证HTTP状态码为200，返回amount为101`
        : `${process.env.DSH_PREVIEW_E2E_DIRECT ? "/test" : "/test-plan"} ${process.env.DSH_PREVIEW_E2E_SIMPLE ? `访问 ${target}，验证页面上的h1文字等于PREVIEW BEFORE` : `访问 ${target}，点击改变页面按钮，验证页面上的h1文字等于PREVIEW AFTER`}`,
    );
    await composer.press("Enter");
    let run,
      directory,
      sawReview = false,
      sawPreview = false,
      sawProgress = false,
      frameLoaded = false;
    let lastFrame;
    const frameIds = new Set();
    const stepStatuses = new Set();
    for (let count = 0; count < 360; count++) {
      for (const id of (await readdir(root)).filter(
        (entry) => entry.startsWith("run-") && !previous.has(entry),
      )) {
        try {
          const next = JSON.parse(
            await readFile(join(root, id, "results.json"), "utf8"),
          );
          if (next.manifest.execution === "native-conversation") {
            run = next;
            directory = join(root, id);
          }
        } catch {}
      }
      const progress = page.locator("[data-test-progress]");
      if (await progress.count()) {
        sawProgress = true;
        for (const status of await progress
          .locator("[data-step-status]")
          .evaluateAll((nodes) => nodes.map((node) => node.dataset.stepStatus)))
          stepStatuses.add(status);
      }
      const preview = page.locator("[data-test-browser-preview]");
      if (mode === "api")
        assert.equal(await preview.count(), 0, "纯API测试出现画面浮窗");
      if (run && !run.plan.cases.length) {
        const approve = page
          .getByRole("button", { name: /批准|同意|Approve/ })
          .filter({ visible: true });
        if (await approve.count()) {
          sawReview = true;
          const progressButton = page.getByRole("button", {
            name: "查看测试进度",
            exact: true,
          });
          await progressButton.click();
          await page.screenshot({
            path: join(evidence, "api-plan-review.png"),
          });
          await approve.first().click();
        }
      }
      const allow = page.getByRole("button", { name: "允许一次", exact: true });
      if (await allow.count()) await allow.first().click();
      if (mode === "browser" && (await preview.count())) {
        sawPreview = true;
        const iframe = page
          .frames()
          .find(
            (frame) =>
              frame.url().includes("/test-progress/") &&
              frame.url().endsWith("/preview"),
          );
        if (iframe) {
          const image = iframe.locator("#image");
          if (await image.isVisible()) {
            frameLoaded = true;
            const status = await iframe.locator("#status").textContent();
            const id = /第 (\d+) 帧/.exec(status ?? "")?.[1];
            if (id) frameIds.add(id);
            if (id !== lastFrame) {
              lastFrame = id;
              await page.screenshot({
                path: join(evidence, "browser-progress-preview.png"),
              });
            }
          }
        }
      }
      if (run?.lifecycle === "FINISHED") break;
      if (count === 359) throw new Error(`${mode} 验收超过12分钟`);
      if (count === 15 && !run)
        throw new Error(
          `${mode} 未创建测试运行：${(await page.locator("body").textContent()).slice(-1800)}`,
        );
      await page.waitForTimeout(2000);
    }
    assert(run && directory, "没有生成测试结果");
    assert(sawProgress, "前端进度插件没有显示");
    assert(
      run.instances.every((instance) => instance.status === "PASS"),
      `${mode} 测试未通过`,
    );
    if (mode === "api") {
      assert(sawReview, "没有观察到原生计划审核");
      assert(
        run.instances.every((instance) =>
          instance.steps.every((step) =>
            step.calls.every(
              (call) => !call.name.startsWith("mcp__playwright__"),
            ),
          ),
        ),
        "API测试触碰浏览器",
      );
    } else {
      assert(sawPreview && frameLoaded, "没有加载真实浏览器画面");
      assert(frameIds.size >= 2, "预览没有持续更新");
    }
    await page.waitForTimeout(1500);
    assert.equal(
      await page.locator("[data-test-browser-preview]").count(),
      0,
      "结束后没有关闭预览浮窗",
    );
    assert(
      (await page.locator("[data-test-progress]").textContent()).includes(
        "已结束",
      ),
    );
    await page.screenshot({ path: join(evidence, mode + "-finished.png") });
    results.push({
      mode,
      run_id: run.suite_run_id,
      session_id: run.manifest.origin_session_id,
      statuses: run.instances.map((instance) => instance.status),
      sawReview,
      sawProgress,
      sawPreview,
      frameLoaded,
      frameIds: [...frameIds],
      stepStatuses: [...stepStatuses],
    });
    console.log(JSON.stringify(results.at(-1)));
    await writeFile(
      join(evidence, mode + "-verification.json"),
      JSON.stringify(results.at(-1), null, 2),
    );
    await page
      .getByRole("link", { name: /查看测试报告/ })
      .last()
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("button", { name: /停止生成|Stop generating/ })
      .waitFor({ state: "hidden", timeout: 60000 });
    await page.waitForTimeout(1000);
  }
  assert.equal(errors.length, 0, "浏览器界面出现运行时错误");
  await writeFile(
    join(evidence, "verification.json"),
    JSON.stringify({ results, page_errors: errors }, null, 2),
  );
} catch (error) {
  await page
    .screenshot({ path: join(evidence, "failure.png") })
    .catch(() => {});
  await writeFile(
    join(evidence, "failure.json"),
    JSON.stringify({ error: String(error), page_errors: errors }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => fixture.close(done));
}
