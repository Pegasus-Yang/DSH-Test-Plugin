/** Playwright MCP 的公开页面初始化扩展，只交付当前测试页面的 CDP。 */
import type { Page, CDPSession } from "playwright";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface PreviewOwner {
  run_id: string;
  case_run_id: string;
}
export interface PublishedCdp extends PreviewOwner {
  target_id: string;
  endpoint: string;
  browser_endpoint: string;
  published_at: string;
}

async function readOwner(directory: string): Promise<PreviewOwner> {
  return JSON.parse(await readFile(join(directory, "owner.json"), "utf8"));
}
async function publish(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

/** 初始化扩展失败仅禁用画面，不改变 MCP 的业务操作。 */
export default async function publishPage({
  page,
}: {
  page: Page;
}): Promise<void> {
  const directory = process.env.DSH_TEST_PREVIEW_DIR;
  if (!directory) return;
  let session: CDPSession | undefined;
  try {
    const owner = await readOwner(directory);
    if (!owner.run_id || !owner.case_run_id) return;
    session = await page.context().newCDPSession(page);
    const command = await session.send("Browser.getBrowserCommandLine");
    let port = command.arguments
      .map((argument) => /^--remote-debugging-port=(\d+)$/.exec(argument))
      .filter((match) => match)
      .at(-1)?.[1];
    if (port === "0") {
      const profile = command.arguments
        .map((argument) => /^--user-data-dir=(.+)$/.exec(argument))
        .filter((match) => match)
        .at(-1)?.[1];
      if (!profile) return;
      // 由当前页面的公开命令行定位浏览器临时目录，只读取实际分配的端口。
      port = (await readFile(join(profile, "DevToolsActivePort"), "utf8"))
        .split(/\r?\n/)[0]
        ?.trim();
    }
    if (!port || Number(port) < 1 || Number(port) > 65535) return;
    const { targetInfo } = await session.send("Target.getTargetInfo");
    const browserEndpoint = `http://127.0.0.1:${port}`;
    const response = await fetch(`${browserEndpoint}/json/list`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return;
    const targets = (await response.json()) as {
      id: string;
      type: string;
      webSocketDebuggerUrl?: string;
    }[];
    const target = targets.find((entry) => entry.id === targetInfo.targetId);
    if (!target?.webSocketDebuggerUrl) return;
    const current = await readOwner(directory);
    if (
      current.run_id !== owner.run_id ||
      current.case_run_id !== owner.case_run_id
    )
      return;
    const metadata: PublishedCdp = {
      ...owner,
      target_id: target.id,
      endpoint: target.webSocketDebuggerUrl,
      browser_endpoint: browserEndpoint,
      published_at: new Date().toISOString(),
    };
    await mkdir(directory, { recursive: true });
    await publish(join(directory, ".cdp"), metadata.endpoint + "\n");
    await publish(join(directory, "cdp.json"), JSON.stringify(metadata));
  } catch (error) {
    console.warn("测试页面未交付 CDP，实时预览保持关闭：", String(error));
  } finally {
    await session?.detach().catch(() => {});
  }
}
