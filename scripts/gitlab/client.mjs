/** 只为准备和清理数据登录 GitLab；浏览器会话不交给插件复用。 */
export async function gitlabClient(config) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "缺少 Playwright。请先在插件源码项目执行 pnpm install --frozen-lockfile",
    );
  }
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(config.browser_channel !== "chromium" ? { channel: "chrome" } : {}),
    });
  } catch {
    throw new Error(
      "无法启动浏览器。请安装 Chrome，或执行 pnpm exec playwright install chromium 并配置 browser_channel 为 chromium",
    );
  }
  try {
    const page = await browser.newPage();
    await page.goto(config.sign_in_url, { timeout: 30000 });
    await page
      .getByRole("textbox", {
        name: /Username or primary email|用户名|电子邮件/i,
      })
      .fill(config.username);
    await page
      .getByRole("textbox", { name: /Password|密码/i })
      .fill(config.password);
    await page.getByRole("button", { name: /^Sign in$|^登录$/i }).click();
    await page.waitForURL((url) => url.pathname !== "/users/sign_in", {
      timeout: 30000,
    });
    const csrf = await page
      .locator('meta[name="csrf-token"]')
      .getAttribute("content");
    async function request(method, path, data, expected = 200) {
      let response;
      try {
        response = await page.request.fetch(config.origin + "/api/v4" + path, {
          method,
          data,
          headers: { "X-CSRF-Token": csrf },
          maxRedirects: 0,
          timeout: 30000,
        });
      } catch {
        throw new Error(
          "GitLab " + method + " 请求无法完成，请检查网络或服务状态",
        );
      }
      const accepted = Array.isArray(expected) ? expected : [expected];
      if (!accepted.includes(response.status()))
        throw new Error(
          `GitLab ${method} 请求返回 ${response.status()}，预期 ${accepted.join("/")}。检查账号权限、项目可见性或测试环境健康状态。`,
        );
      if (expected === 204) return null;
      try {
        const body = await response.json();
        return Array.isArray(expected)
          ? { status: response.status(), body }
          : body;
      } catch {
        throw new Error("GitLab 返回非 JSON 响应，请检查服务或反向代理");
      }
    }
    const user = await request("GET", "/user");
    return { request, user, close: () => browser.close() };
  } catch {
    await browser.close();
    throw new Error(
      "GitLab 登录或会话验证失败。检查本地配置、服务可达性、账号密码及是否启用了二次认证；不会输出凭据或浏览器调用日志。",
    );
  }
}

export async function publicGet(origin, path) {
  try {
    const response = await fetch(origin + "/api/v4" + path, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    return { status: response.status, body: await response.json() };
  } catch {
    throw new Error(
      "GitLab 公开 JSON 接口请求失败，请检查网络、服务和可见性策略",
    );
  }
}

/** 删除前核对当前账户及专用项目标记；不按名称前缀批量删除。 */
export function assertOwned(project, state, user, target) {
  // UI 创建尚未进入设置页时可能没有描述；仍须匹配本次预留名称、账号及命名空间。
  const unfinishedUi =
    target?.role === "created" &&
    (project.description === null || project.description === "");
  if (
    user.id !== state.owner_id ||
    project.namespace?.id !== state.namespace_id ||
    !project.path.startsWith(state.marker + "-") ||
    (project.description !== state.marker + "：仅用于 DSH GitLab 验收" &&
      !unfinishedUi)
  )
    throw new Error(
      "项目归属或测试标记不匹配，拒绝修改或删除；请人工核对准备记录",
    );
  if (target) {
    const scheduled =
      project.marked_for_deletion_at || project.marked_for_deletion_on;
    const scheduledPath = target.path + "-deletion_scheduled-" + project.id;
    if (
      (project.path !== target.path &&
        !(scheduled && project.path === scheduledPath)) ||
      (typeof target.id === "number" && project.id !== target.id)
    )
      throw new Error("项目路径或 ID 与准备记录不符，拒绝清理");
  }
}
