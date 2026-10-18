/** 三版共用浏览器操作；先完成宿主首次引导，再使用实际设置入口。 */
import assert from "node:assert/strict";

async function withOnboarding(page, action, timeout) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      for (const [title, button] of [
        ["预览版说明", "继续"],
        ["添加一个 API Key 开始使用", "稍后配置"],
        ["开始使用", "关闭"],
      ]) {
        const dialog = page.getByRole("dialog", { name: title, exact: true });
        if (await dialog.isVisible())
          await dialog
            .getByRole("button", { name: button, exact: true })
            .click({
              timeout: Math.min(1000, Math.max(1, deadline - Date.now())),
            });
      }
      return await action(Math.min(1000, Math.max(1, deadline - Date.now())));
    } catch (error) {
      if (error.name !== "TimeoutError") throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("宿主首次引导或页面操作未按时就绪");
}

async function settingsLauncher(page) {
  const account = page.getByRole("button", { name: "账号菜单", exact: true });
  const accountMenu = (await account.count()) > 0;
  return {
    accountMenu,
    button: accountMenu
      ? account
      : page.getByRole("button", { name: "设置", exact: true }),
  };
}

export async function enter(page, state, { timeout = 30000 } = {}) {
  await page.goto(state.url);
  // 未选工作区时聊天输入框不可编辑；页面就绪只要求设置入口可操作。
  await withOnboarding(
    page,
    async (actionTimeout) =>
      (await settingsLauncher(page)).button.click({
        trial: true,
        timeout: actionTimeout,
      }),
    timeout,
  );
}
export async function openSettings(page, { timeout = 30000 } = {}) {
  let accountMenu = false;
  await withOnboarding(
    page,
    async (actionTimeout) => {
      const launcher = await settingsLauncher(page);
      accountMenu = launcher.accountMenu;
      await launcher.button.click({ timeout: actionTimeout });
    },
    timeout,
  );
  if (accountMenu)
    await withOnboarding(
      page,
      (actionTimeout) =>
        page.getByRole("menuitem", { name: "设置", exact: true }).click({
          timeout: actionTimeout,
        }),
      timeout,
    );
  await withOnboarding(
    page,
    (actionTimeout) =>
      page.getByRole("button", { name: "测试插件", exact: true }).click({
        timeout: actionTimeout,
      }),
    timeout,
  );
  await page.locator("#dsh-test-browscreen-port").waitFor();
}
export async function rpc(page, method, args) {
  const response = await page.evaluate(
    async ({ method, args }) => {
      const result = await fetch("/api/" + method, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: crypto.randomUUID(),
          method,
          payload: { args },
        }),
      });
      return result.json();
    },
    { method, args },
  );
  assert(response.result?.ok, `${method} 失败：${JSON.stringify(response)}`);
  return response.result.value;
}
