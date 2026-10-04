/** 将设置页选择交付给现有 MCP；只在下一次测试开始前接入。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-config-editor";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { PreviewConfig, TestConfig } from "./config.js";
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
  const merged = {
    ...original,
    browser: {
      ...browser,
      initPage: [
        ...new Set([
          ...(browser.initPage ?? []).map(path),
          ...initPages.map(path),
          initializer,
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
  mkdirSync(workDir, { recursive: true });
  const generated = join(workDir, `mcp-preview-${hash}.json`);
  writeFileSync(generated, body, { mode: 0o600 });
  return {
    args: [...args, "--config", generated],
    env: { ...config.env, DSH_TEST_PREVIEW_DIR: workDir },
  };
}

export class PreviewSetup {
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
    if (!preferences) return this.config.preview;
    if (!preferences.enabled) {
      this.message = "实时预览已关闭。";
      return;
    }
    const project = preferences.browscreenProject.trim();
    if (!isAbsolute(project) || !existsSync(join(project, "pyproject.toml")))
      throw new Error("请填写包含 pyproject.toml 的 Browscreen 绝对目录");
    if (!existsSync(join(project, ".venv")))
      throw new Error("Browscreen 尚未准备 .venv，请先按配置指南安装依赖");
    if (!existsSync(this.initializer))
      throw new Error("插件缺少 CDP 初始化文件，请重新构建或安装插件");
    const editor = this.ctx.get("configEditor");
    if (!editor)
      throw new Error(
        "当前宿主没有配置编辑服务，请使用 Web profile 或手动配置预览",
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
    this.message =
      "正在接入选中的 Playwright；不会启动 Browscreen，直到当前测试产生 CDP。";
    if (
      !isDeepStrictEqual(current.args, next.args) ||
      !isDeepStrictEqual(current.env, next.env)
    ) {
      await editor.edit(entry, (current) => {
        if (!compatible(current as McpConfig))
          throw new Error("所选 MCP 配置已变化，请重新选择兼容的浏览器");
        return {
          ...current,
          ...prepareMcpPreview(current as McpConfig, workDir, this.initializer),
        };
      });
    }
    this.message =
      "浏览器接入已准备；当前测试有 CDP 和有效画面时自动打开浮窗。";
    return {
      workDir,
      browscreenUrl: `http://127.0.0.1:${preferences.port}`,
      browscreenProject: project,
    };
  }

  failed(error: unknown): string {
    this.message = `预览未启用：${error instanceof Error ? error.message : String(error)}`;
    return this.message;
  }
}
