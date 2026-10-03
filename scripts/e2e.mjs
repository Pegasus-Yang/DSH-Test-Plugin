/** 经普通网页输入执行验收；不写会话日志、本地存储或绕开原生对话。 */
import { chromium } from "playwright";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const { url } = JSON.parse(
  await readFile(
    process.env.DSH_TEST_STATE ?? ".local/host-state.json",
    "utf8",
  ),
);
const root = resolve(process.env.DSH_TEST_OUTPUT ?? "artifacts/runs");
const previous = new Set(await readdir(root));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
try {
  await page.goto(url);
  // 登录重定向后的新请求携带宿主Cookie。
  await page.goto(new URL("/", url).href);
  await page
    .getByRole("button", { name: "新建会话", exact: true })
    .first()
    .click();
  const composer = page.locator('[contenteditable="true"]').first();
  await composer.fill(
    "/test-run " + (process.argv[2] ?? "examples/ceshiren-agent.json"),
  );
  await composer.press("Enter");
  let directory, run;
  for (let n = 0; n < 360; n++) {
    const allow = page.getByRole("button", { name: "允许一次", exact: true });
    if (await allow.count()) await allow.click();
    for (const id of (await readdir(root)).filter(
      (id) => id.startsWith("run-") && !previous.has(id),
    )) {
      try {
        const candidate = JSON.parse(
          await readFile(join(root, id, "results.json"), "utf8"),
        );
        if (candidate.manifest.execution === "native-conversation") {
          directory = join(root, id);
          run = candidate;
        }
      } catch {
        /* 等待原子快照。 */
      }
    }
    if (run?.lifecycle === "FINISHED") break;
    if (n === 359) throw new Error("原生验收超过12分钟");
    await page.waitForTimeout(2000);
  }
  assert(run && directory, "没有生成原生运行记录");
  assert(
    run.instances.every(
      (i) =>
        i.session_id === run.manifest.origin_session_id &&
        i.cleanup_session_id === i.session_id,
    ),
    "出现独立执行会话",
  );
  assert(
    run.instances.every((i) => i.status === "PASS"),
    "测试未全部通过",
  );
  const link = page.getByRole("link", { name: /查看测试报告/ }).last();
  await link.waitFor({ timeout: 60000 });
  const href = await link.getAttribute("href");
  assert(
    href?.startsWith(new URL(url).origin + "/test-reports/"),
    "缺少可浏览报告链接",
  );
  const report = await page.context().newPage();
  const errors = [];
  report.on("pageerror", (e) => errors.push(String(e)));
  await report.goto(href);
  assert((await report.textContent("body")).includes("实际值 ACTUAL"));
  const evidence = join(directory, "acceptance");
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "conversation.png"),
    fullPage: true,
  });
  await report.screenshot({
    path: join(evidence, "report.png"),
    fullPage: true,
  });
  await writeFile(
    join(evidence, "verification.json"),
    JSON.stringify(
      {
        session_id: run.manifest.origin_session_id,
        report_url: href,
        statuses: run.instances.map((i) => i.status),
        report_errors: errors,
      },
      null,
      2,
    ),
  );
  assert.equal(errors.length, 0);
  console.log(
    JSON.stringify(
      {
        directory,
        statuses: run.instances.map((i) => i.status),
        report_errors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
