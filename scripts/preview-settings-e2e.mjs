/** 从真实 DSH 设置页保存偏好；不调用模型、不改用户的现有 profile。 */
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parse } from "yaml";
import assert from "node:assert/strict";
const state = JSON.parse(
  await readFile(
    process.env.DSH_TEST_STATE ?? ".local/settings-host-state.json",
    "utf8",
  ),
);
const evidence = resolve(
  process.env.DSH_SETTINGS_E2E_EVIDENCE ??
    "artifacts/validation/preview-settings/web",
);
const executable = process.env.DSH_BROWSCREEN_EXECUTABLE ?? "browscreen";
const port = Number(process.env.DSH_BROWSCREEN_PORT ?? "13402");
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1280, height: 1000 },
  locale: "zh-CN",
});
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("websocket", (socket) =>
  socket.on("framereceived", (frame) => {
    const text = String(frame.payload);
    if (/settings\/(rejected|conflict)/.test(text))
      console.log("设置拒绝诊断：", text.slice(0, 1400));
  }),
);
page.on("response", async (response) => {
  const body = response.request().postData() ?? "";
  if (body.includes("harness-test")) {
    const result = await response.json();
    if (result.result?.ok === false)
      console.log("测试插件设置拒绝：", result.result.error?.message);
  }
});
async function openSettings() {
  await page
    .locator('style[data-plugin="dsh-test-plugin"]')
    .waitFor({ state: "attached" });
  const item = page.getByRole("button", { name: "测试插件", exact: true });
  if (!(await item.isVisible()))
    await page.getByRole("button", { name: "设置", exact: true }).click();
  await item.click();
  await page.locator("#dsh-test-browscreen-port").waitFor();
}
try {
  await page.goto(state.url);
  await page.goto(new URL("/", state.url).href);
  const welcome = page.getByRole("button", { name: "继续", exact: true });
  await welcome.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await welcome.isVisible()) await welcome.click();
  await openSettings();
  const checkbox = page.getByRole("checkbox", { name: "启用浏览器实时预览" });
  await checkbox.check();
  await page
    .getByText("高级设置：Browscreen 命令路径", { exact: true })
    .click();
  await page
    .locator("#dsh-test-browscreen-executable")
    .fill("/not-installed-browscreen/browscreen");
  await page.getByRole("button", { name: "检测安装", exact: true }).click();
  await page
    .locator("[data-test-browscreen-check]")
    .filter({ hasText: "未找到 Browscreen" })
    .waitFor();
  await page.locator("#dsh-test-browscreen-executable").fill(executable);
  assert.equal(
    await page.locator("[data-test-browscreen-check]").count(),
    0,
    "修改入口后保留了旧检测结果",
  );
  await page.getByRole("button", { name: "检测安装", exact: true }).click();
  await page
    .locator("[data-test-browscreen-check]")
    .filter({ hasText: "Browscreen 0.2.1 已安装" })
    .waitFor();
  const beforeSave = parse(
    await readFile(join(state.home, "profiles/web/cordis.patch.yml"), "utf8"),
  );
  assert(
    !beforeSave.some(
      (row) => row.id === "harness-test" && row.config?.browserPreview,
    ),
    "检测安装提前保存了配置",
  );
  await page.locator("#dsh-test-browscreen-port").fill(String(port));
  await page
    .locator("#dsh-test-preview-mcp")
    .selectOption("mcp-test-playwright");
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  const profile = join(state.home, "profiles/web/cordis.patch.yml");
  const rows = parse(await readFile(profile, "utf8"));
  assert.deepEqual(
    rows.find((row) => row.id === "harness-test").config.browserPreview,
    {
      enabled: true,
      browscreenExecutable: executable,
      port,
      mcpId: "mcp-test-playwright",
    },
  );
  assert(
    !rows.some((row) => row.id === "mcp-test-playwright"),
    "保存设置提前重启了 MCP",
  );
  await page.screenshot({ path: join(evidence, "settings-saved.png") });
  await page.reload();
  await openSettings();
  assert(await checkbox.isChecked());
  assert.equal(
    await page.locator("#dsh-test-browscreen-executable").inputValue(),
    executable,
  );
  assert.equal(
    await page.locator("#dsh-test-browscreen-port").inputValue(),
    String(port),
  );
  assert.equal(
    await page.locator("#dsh-test-preview-mcp").inputValue(),
    "mcp-test-playwright",
  );
  await page.screenshot({ path: join(evidence, "settings-reloaded.png") });
  assert.equal(errors.length, 0);
  await writeFile(
    join(evidence, "settings-verification.json"),
    JSON.stringify(
      {
        saved: true,
        installationDetected: true,
        detectedVersion: "0.2.1",
        missingCommandExplained: true,
        detectionDidNotSave: true,
        reloaded: true,
        mcpUntouchedUntilNextTest: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "原生设置页保存与刷新验证通过；尚未提前连接 MCP 或启动 Browscreen。",
  );
} catch (error) {
  await page
    .screenshot({ path: join(evidence, "settings-failure.png") })
    .catch(() => {});
  console.log((await page.locator("body").innerText()).slice(-3500));
  throw error;
} finally {
  await browser.close();
}
