/** 真实 Web 配置保存、磁盘核对和重启回读；不依赖模型服务。 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { parse } from "yaml";
import { enter, openSettings } from "./browser.mjs";

const [stateFile, mode] = process.argv.slice(2);
const state = JSON.parse(await readFile(stateFile, "utf8"));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1050 },
  locale: "zh-CN",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await enter(page, state);
  if (["removed", "disabled"].includes(mode)) {
    await page.locator('[contenteditable="true"]').first().waitFor();
    assert.equal(
      await page.locator('style[data-plugin="dsh-test-plugin"]').count(),
      0,
      "停用或卸载后仍挂载客户端",
    );
    const response = await page.request.get(
      new URL("/test-preview-settings", state.url).href,
    );
    const body = await response.json().catch(() => null);
    assert(!response.ok() || !body?.mcpInstances, "停用后仍挂载插件 HTTP 服务");
    const mcp = await page.evaluate(async () =>
      (await fetch("/compat-audit-config")).json(),
    );
    assert(mcp.mcpReady, "停用或卸载插件后原 MCP 工具不可用");
  } else {
    await page
      .locator('style[data-plugin="dsh-test-plugin"]')
      .waitFor({ state: "attached" });
    // 访客访问插件接口不能得到设置内容。
    const anonymous = await browser.newContext();
    const response = await anonymous.request.get(
      new URL("/test-preview-settings", state.url).href,
    );
    assert.notEqual(response.status(), 200, "设置接口缺少宿主认证");
    await anonymous.close();
    await openSettings(page);
    if (mode === "save") {
      await page.locator("#dsh-test-browscreen-port").fill("13402");
      await page
        .locator("#dsh-test-preview-mcp")
        .selectOption("compat-playwright");
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "已保存" }).waitFor();
    }
    if (["save", "read"].includes(mode)) {
      assert.equal(
        await page.locator("#dsh-test-browscreen-port").inputValue(),
        "13402",
      );
      assert.equal(
        await page.locator("#dsh-test-preview-mcp").inputValue(),
        "compat-playwright",
      );
      const saved = parse(
        await readFile(join(state.profile, "cordis.patch.yml"), "utf8"),
      );
      assert.equal(
        saved.find((row) => row.id === "harness-test").config.browserPreview
          .port,
        13402,
        "偏好未保存至实际 profile",
      );
      const insert = saved.flatMap((row) => row.insert ?? []);
      const mcp =
        saved.find((row) => row.id === "compat-playwright") ??
        insert.find((row) => row.id === "compat-playwright");
      assert.equal(
        mcp.config.toolCallTimeoutMs,
        mode === "save" ? 60000 : 61000,
        "MCP 配置未持久化",
      );
      if (mode === "read") {
        const effective = await page.evaluate(async () =>
          (await fetch("/compat-audit-config")).json(),
        );
        assert.equal(
          effective.mcpToolCallTimeoutMs,
          61000,
          "重启后 MCP 未读取已保存的实际配置",
        );
        assert(effective.mcpReady, "重启后 MCP 工具未注册");
      }
      const info = await page.evaluate(async () =>
        (await fetch("/test-preview-settings")).json(),
      );
      assert(
        info.mcpInstances.some(
          (row) => row.id === "compat-playwright" && row.compatible,
        ),
        "重启后 MCP 不可用",
      );
    }
  }
  await page.screenshot({
    path: join(state.output, `web-${mode}.png`),
    fullPage: true,
  });
  assert.deepEqual(errors, [], "浏览器脚本错误");
  await writeFile(
    join(state.output, `web-${mode}.json`),
    JSON.stringify(
      {
        host_version: state.version,
        mode,
        status: "PASS",
        default_model_env_key: state.default_model_env_key,
        page_errors: errors,
      },
      null,
      2,
    ),
  );
  console.log(`${state.version}：Web ${mode} 通过`);
} catch (error) {
  await page
    .screenshot({
      path: join(state.output, `web-${mode}-failure.png`),
      fullPage: true,
    })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
