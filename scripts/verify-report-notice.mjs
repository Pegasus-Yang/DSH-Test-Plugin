/** 真实DSH网页验收：保留发起会话，等待自动提示并点击报告及附件。 */
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const { url } = JSON.parse(await readFile(".local/host-state.json", "utf8"));
const output = resolve("artifacts/validation/report-notice");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
try {
  await page.goto(url);
  const notice = page.locator("#harness-test-report-notice");
  await notice.getByRole("link", { name: "查看测试报告" }).waitFor();
  const previous = await notice.locator(".id").textContent();
  const rpc = async (method, args) =>
    page.evaluate(
      async ({ method, args }) =>
        (
          await fetch("/api/" + method, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              type: "client-request",
              rpcId: crypto.randomUUID(),
              method,
              payload: { args },
            }),
          })
        ).json(),
      { method, args },
    );
  const created = await rpc("session/create", {
    request: { cwd: process.cwd() },
  });
  const agentId = created.result.value.sessionId;
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        "dsh.sessions.current",
        JSON.stringify({ sessionId: id }),
      ),
    agentId,
  );
  await page.reload();
  const command = await rpc("commands/execute", {
    agentId,
    line: "/test-run examples/ceshiren-agent.json",
    submittedAttachments: [],
  });
  assert.equal(command.result.value.result.kind, "success");
  const runId = command.result.value.result.text.match(/run-[\w-]+/)[0];
  await notice.locator(".id").filter({ hasText: runId }).waitFor();
  await notice.getByRole("status").filter({ hasText: "测试运行中" }).waitFor();
  await notice.screenshot({ path: output + "/running.png" });
  await notice
    .getByRole("status")
    .filter({ hasText: "报告已生成" })
    .waitFor({ timeout: 240000 });
  assert.match(await notice.locator(".path").textContent(), /report\.html/);
  await notice.screenshot({ path: output + "/completed.png" });
  await page.screenshot({ path: output + "/web-completed.png" });
  const [report] = await Promise.all([
    context.waitForEvent("page"),
    notice.getByRole("link", { name: "查看测试报告" }).click(),
  ]);
  await report.waitForLoadState();
  assert.equal(await report.locator(".comparison").count(), 3);
  const comparison = report.locator(".comparison").last();
  assert.deepEqual(await comparison.locator("pre").allTextContents(), [
    "1",
    "0",
  ]);
  assert.match(report.url(), /\/test-reports\/run-/);
  await report
    .locator("details")
    .evaluateAll((es) => es.forEach((e) => (e.open = true)));
  const [attachment] = await Promise.all([
    context.waitForEvent("page"),
    report.getByRole("link", { name: "查看截图" }).first().click(),
  ]);
  await attachment.waitForLoadState();
  assert.match(attachment.url(), /\/evidence\/.+\.png$/);
  await attachment.close();
  await report
    .locator("details")
    .evaluateAll((es) => es.forEach((e) => (e.open = false)));
  await report.locator("#status").selectOption("PASS");
  assert.equal(await report.locator("article.case:visible").count(), 1);
  await report.screenshot({
    path: output + "/http-report.png",
    fullPage: true,
  });
  const unauthorized = await fetch(report.url());
  assert.equal(unauthorized.status, 401);
  const again = await rpc("commands/execute", {
    agentId,
    line: "/test-report",
    submittedAttachments: [],
  });
  assert.equal(again.result.value.result.kind, "success");
  await page.waitForTimeout(2500);
  assert.match(
    await notice
      .getByRole("link", { name: "查看测试报告" })
      .getAttribute("href"),
    /report-rebuilt\.html$/,
  );
  await page.reload();
  await notice.getByRole("link", { name: "查看测试报告" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await notice.screenshot({ path: output + "/mobile-notice.png" });
  await notice.getByRole("button", { name: "收起报告提示" }).click();
  await notice.getByRole("button", { name: "测试报告", exact: true }).click();
  assert.equal(
    await notice.getByRole("link", { name: "查看测试报告" }).isVisible(),
    true,
  );
  assert.deepEqual(errors, []);
  const result = {
    run_id: runId,
    previous_report_restored: !!previous,
    completion_notice: true,
    saved_path_visible: true,
    report_url: report.url(),
    report_actual: 1,
    report_expected_not: 0,
    attachment_opened: true,
    unauthorized_status: unauthorized.status,
    report_command_without_id: true,
    page_reload_restores: true,
    narrow_notice: true,
    browser_errors: errors,
  };
  await writeFile(output + "/result.json", JSON.stringify(result, null, 2));
  console.log(result);
} finally {
  await browser.close();
}
