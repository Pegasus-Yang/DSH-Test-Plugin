/** 将预览参数限于 MCP 的运行配置，不持久修改用户的浏览器条目。 */
import { FiberState, type Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-config-editor";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { PreviewConfig, TestConfig } from "./config.js";
import { normalizeBrowscreenExecutable } from "./browscreen-command.js";
import type {
  PreviewPreferences,
  PreviewSettingsInfo,
} from "./preview-preferences.js";

interface McpConfig {
  serverName?: string;
  transport?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}
type McpEntry = ReturnType<Context["configEditor"]["entries"]>[number];
function compatible(config: McpConfig): boolean {
  const browserIndex = config.args?.indexOf("--browser") ?? -1;
  const browser =
    browserIndex >= 0
      ? config.args?.[browserIndex + 1]
      : config.args?.find((arg) => arg.startsWith("--browser="))?.slice(10);
  return (
    config.serverName === "playwright" &&
    config.transport === "stdio" &&
    !!config.args?.some((arg) =>
      /@playwright[\/]mcp|@playwright\+mcp|playwright\/mcp\/cli\.js/.test(arg),
    ) &&
    !config.args.some((arg) =>
      /^(--cdp-endpoint|--extension)(=|$)/.test(arg),
    ) &&
    !["firefox", "webkit"].includes(browser ?? "")
  );
}

/** 保留用户的 JSON 配置、初始化脚本和 CLI 参数，补充本插件的 CDP 交付。 */
export function prepareMcpPreview(
  config: McpConfig,
  workDir: string,
  initializer: string,
): Pick<McpConfig, "args" | "env"> {
  const args: string[] = [];
  const initPages: string[] = [];
  let configPath: string | undefined;
  const source = config.args ?? [];
  for (let index = 0; index < source.length; index++) {
    const arg = source[index]!;
    if (arg === "--config") {
      configPath = source[++index];
      if (!configPath) throw new Error("Playwright 的 --config 缺少文件路径");
    } else if (arg.startsWith("--config=")) configPath = arg.slice(9);
    else if (arg === "--init-page") {
      while (source[index + 1] && !source[index + 1]!.startsWith("--"))
        initPages.push(source[++index]!);
    } else if (arg.startsWith("--init-page=")) initPages.push(arg.slice(12));
    else args.push(arg);
  }
  const cwd = resolve(config.cwd || process.cwd());
  const path = (value: string) =>
    isAbsolute(value) ? value : resolve(cwd, value);
  const original = configPath
    ? JSON.parse(readFileSync(path(configPath), "utf8"))
    : {};
  const browser = original.browser ?? {};
  if (["firefox", "webkit"].includes(browser.browserName))
    throw new Error(
      "实时预览需要 Chromium 的 CDP，不能修改 Firefox 或 WebKit 的启动参数",
    );
  const launch = browser.launchOptions ?? {};
  const launchArgs: string[] = [
    ...new Set([...(launch.args ?? []), "--enable-automation"]),
  ];
  if (!launchArgs.some((arg) => arg.startsWith("--remote-debugging-port=")))
    launchArgs.push("--remote-debugging-port=0");
  mkdirSync(workDir, { recursive: true });
  // 运行产物保留独立副本，卸载包期间正在退出的 MCP 也能完成初始化。
  const initializerBody = readFileSync(initializer);
  const initializerHash = createHash("sha256")
    .update(initializerBody)
    .digest("hex")
    .slice(0, 12);
  const publishedInitializer = join(
    workDir,
    `cdp-publisher-${initializerHash}.cjs`,
  );
  writeFileSync(publishedInitializer, initializerBody, { mode: 0o600 });
  const merged = {
    ...original,
    browser: {
      ...browser,
      initPage: [
        ...new Set([
          ...(browser.initPage ?? []).map(path),
          ...initPages.map(path),
          publishedInitializer,
        ]),
      ],
      launchOptions: {
        ...launch,
        args: launchArgs,
      },
    },
  };
  const body = JSON.stringify(merged, null, 2) + "\n";
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const generated = join(workDir, `mcp-preview-${hash}.json`);
  writeFileSync(generated, body, { mode: 0o600 });
  return {
    args: [...args, "--config", generated],
    env: { ...config.env, DSH_TEST_PREVIEW_DIR: workDir },
  };
}

export class PreviewSetup {
  private target?: { entry: McpEntry; workDir: string };
  private detach?: () => boolean;
  private message =
    "保存后，在下一次测试开始时接入浏览器；有画面后才打开浮窗。";
  constructor(
    private readonly ctx: Context,
    private readonly preferences: () => PreviewPreferences | undefined,
    private readonly config: Partial<TestConfig>,
    private readonly initializer = fileURLToPath(
      new URL("./cdp-publisher.cjs", import.meta.url),
    ),
  ) {}

  private attach(): void {
    if (this.detach) return;
    const setup = this;
    this.detach = this.ctx.on(
      "internal/config",
      function (_config, next) {
        const current = next();
        const target = setup.target;
        if (!target || this.entry !== target.entry || !compatible(current))
          return current;
        return {
          ...current,
          ...prepareMcpPreview(current, target.workDir, setup.initializer),
        };
      },
      { global: true },
    );
  }

  private async restore(): Promise<void> {
    const target = this.target;
    this.target = undefined;
    const fiber = target?.entry.fiber;
    if (
      !fiber ||
      fiber.uid === null ||
      target.entry.disabled ||
      this.ctx.root.fiber.uid === null ||
      this.ctx.root.fiber.state === FiberState.UNLOADING ||
      this.ctx.root.fiber.state === FiberState.DISPOSED ||
      fiber.state === FiberState.UNLOADING ||
      fiber.state === FiberState.DISPOSED ||
      fiber.config?.env?.DSH_TEST_PREVIEW_DIR !== target.workDir
    )
      return;
    await fiber.restart();
  }

  /** 停用或卸载时解除运行配置接入，仍在运行的 MCP 恢复原始配置。 */
  async dispose(): Promise<void> {
    this.detach?.();
    this.detach = undefined;
    await this.restore();
  }

  describe(): PreviewSettingsInfo {
    const entries = this.ctx.get("configEditor")?.entries() ?? [];
    return {
      namespace: this.ctx.fiber.entry?.options.id ?? "harness-test",
      mcpInstances: entries
        .filter((entry) => entry.options.name === "@deepseek-ai/dsh-mcp-client")
        .map((entry) => {
          const config = entry.options.config as McpConfig;
          return {
            id: entry.options.id,
            label: `${config.serverName ?? entry.options.id}（${entry.options.id}）`,
            compatible: compatible(config),
          };
        }),
      message: this.message,
    };
  }

  async prepare(): Promise<PreviewConfig | undefined> {
    const preferences = this.preferences();
    if (!preferences) {
      await this.restore();
      return this.config.preview;
    }
    if (!preferences.enabled) {
      await this.restore();
      this.message = "实时预览已关闭。";
      return;
    }
    const executable = normalizeBrowscreenExecutable(
      preferences.browscreenExecutable,
    );
    if (!existsSync(this.initializer))
      throw new Error("插件缺少 CDP 初始化文件，请重新构建或安装插件");
    const editor = this.ctx.get("configEditor");
    if (!editor)
      throw new Error(
        "当前宿主没有浏览器配置服务，请使用 Web profile 或手动配置预览",
      );
    const entry = editor
      .entries()
      .find((entry) => entry.options.id === preferences.mcpId);
    if (
      !entry ||
      entry.options.name !== "@deepseek-ai/dsh-mcp-client" ||
      !compatible(entry.options.config as McpConfig)
    )
      throw new Error(
        "请选择本机 stdio 的 Playwright MCP（serverName 为 playwright）",
      );
    const workDir = join(
      resolve(this.config.outputRoot ?? "artifacts/runs"),
      ".browser-preview",
      this.ctx.fiber.entry?.options.id ?? "harness-test",
    );
    const current = entry.options.config as McpConfig;
    const next = prepareMcpPreview(current, workDir, this.initializer);
    if (this.target?.entry !== entry) await this.restore();
    this.attach();
    this.target = { entry, workDir };
    this.message =
      "正在接入选中的 Playwright；不会启动 Browscreen，直到当前测试产生 CDP。";
    if (
      !isDeepStrictEqual(entry.fiber?.config?.args, next.args) ||
      !isDeepStrictEqual(entry.fiber?.config?.env, next.env)
    ) {
      if (!entry.fiber || entry.fiber.uid === null)
        throw new Error("所选 MCP 未启用，请先在插件设置中启用浏览器");
      await entry.fiber.restart();
    }
    this.message =
      "浏览器接入已准备；当前测试有 CDP 和有效画面时自动打开浮窗。";
    return {
      workDir,
      browscreenUrl: `http://127.0.0.1:${preferences.port}`,
      browscreenExecutable: executable,
    };
  }

  failed(error: unknown): string {
    this.message = `预览未启用：${error instanceof Error ? error.message : String(error)}`;
    return this.message;
  }
}
