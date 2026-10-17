/** 三版共用浏览器操作；仅宿主设置入口位置存在差异。 */
import assert from "node:assert/strict";

export async function enter(page, state) {
  await page.goto(state.url);
  const welcome = page.getByRole("button", { name: "继续", exact: true });
  await welcome.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  if (await welcome.isVisible()) await welcome.click();
}
export async function openSettings(page) {
  const account = page.getByRole("button", { name: "账号菜单", exact: true });
  if (await account.count()) {
    await account.click();
    await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  } else await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "测试插件", exact: true }).click();
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
