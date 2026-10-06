/** 原生对话增强入口；命令只激活当前Agent的测试能力。 */
import type { Context } from "@deepseek-ai/cordis";
import type { CommandInvocation } from "@deepseek-ai/dsh-commands";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fileArgument, loadDataInput, loadTextInput } from "./case-input.js";
import { NativeTests } from "./native-test.js";
import type { PluginConfig } from "./config.js";
import type {} from "@deepseek-ai/dsh-settings";
import { PreviewSetup } from "./preview-setup.js";
import { PreviewSettingsAccess } from "./preview-settings-access.js";
import { reportPrefix } from "./report-access.js";
import { ProgressAccess, progressPrefix } from "./progress-access.js";
import { TestUiAccess } from "./test-ui-access.js";
export { parsePlan } from "./contracts.js";
export { Config } from "./config.js";
export const name = "harness-test";
export const inject = ["commands", "tools", "systemPrompt"] as const;
declare module "@deepseek-ai/cordis" {
  interface Context {
    nativeTests: NativeTests;
  }
}
export function apply(ctx: Context, config: PluginConfig = {}): void {
  const { browserPreview, ...runtimeConfig } = config;
  const setup = new PreviewSetup(
    ctx,
    () => browserPreview?.get(),
    runtimeConfig,
  );
  const tests = new NativeTests(ctx, runtimeConfig, async () => {
    try {
      await tests.preview.configure(await setup.prepare());
    } catch (error) {
      await tests.preview.configure(undefined);
      tests.preview.unavailable(setup.failed(error));
    }
  });
  ctx.inject(["settings"], (settings) => {
    settings.effect(() =>
      settings.settings.configure({ auto: false }, ctx.fiber),
    );
  });
  const progress = new ProgressAccess(
    (sessionId) => tests.presentation(sessionId),
    tests.preview,
  );
  ctx.provide("nativeTests", tests);
  ctx.inject(["webServer", "connection", "agents"], (web) => {
    const previewSettings = new PreviewSettingsAccess(() => setup.describe());
    web.effect(() => () => previewSettings.dispose());
    const interfaceActions = new TestUiAccess(
      tests,
      inputPath,
      async (sessionId, token, signal) => {
        const agent = web.agents.get(sessionId as SessionId);
        if (!agent)
          throw new Error("当前对话尚未加载，请打开对话后再进入设置释放环境。");
        return web.agents.withInitiator(agent, () =>
          tests.recovery.recover(agent, token, signal),
        );
      },
    );
    web.effect(() => () => interfaceActions.dispose());
    web.effect(() =>
      web.webServer.register({
        kind: "prefix",
        path: "/test-ui",
        handler: (req, res) => {
          if (!web.connection.authorizeIndex(req, res)) return;
          void interfaceActions.serve(req, res).catch(() => {
            if (!res.headersSent) res.writeHead(503);
            res.end();
          });
        },
      }),
    );
    tests.reports.origin = () => `http://127.0.0.1:${web.webServer.port}`;
    web.effect(() => () => {
      tests.reports.origin = undefined;
    });
    web.effect(() =>
      web.webServer.register({
        kind: "prefix",
        path: "/test-recovery",
        handler: (req, res) => {
          if (!web.connection.authorizeIndex(req, res)) return;
          if (
            req.method !== "GET" ||
            req.url?.split("?")[0] !== "/test-recovery"
          ) {
            res.writeHead(405);
            res.end();
            return;
          }
          res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify(tests.recovery.status()));
        },
      }),
    );
    web.effect(() =>
      web.webServer.register({
        kind: "prefix",
        path: "/test-preview-settings",
        handler: (req, res) => {
          if (!web.connection.authorizeIndex(req, res)) return;
          void previewSettings.serve(req, res).catch(() => {
            if (!res.headersSent) res.writeHead(503);
            res.end();
          });
        },
      }),
    );
    web.effect(() =>
      web.webServer.register({
        kind: "prefix",
        path: reportPrefix,
        handler: (req, res) => {
          if (
            tests.reports.authorizeFile(req) ||
            web.connection.authorizeIndex(req, res)
          )
            tests.reports.serve(req, res);
        },
      }),
    );
    web.effect(() =>
      web.webServer.register({
        kind: "prefix",
        path: progressPrefix,
        handler: (req, res) => {
          if (web.connection.authorizeIndex(req, res))
            void progress.serve(req, res).catch(() => {
              if (!res.headersSent) res.writeHead(503);
              res.end();
            });
        },
      }),
    );
  });
  function commandWorkspace(agent: CommandInvocation["agent"]): string {
    // 命令随发起对话的工作区读取文件；无 cwd 的历史会话沿用插件配置。
    return agent?.session?.header?.cwd ?? tests.config.workspace;
  }
  function inputPath(
    input: string,
    workspace = tests.config.workspace,
  ): string {
    const full = realpathSync(resolve(workspace, input.trim()));
    const rel = relative(realpathSync(workspace), full);
    if (rel === ".." || rel.startsWith(".." + sep))
      throw new Error("输入文件必须位于项目工作区：" + workspace);
    return full;
  }
  const register = (
    name: string,
    description: string,
    handler: (invocation: CommandInvocation) => string | Promise<string>,
    hint?: string,
  ) =>
    ctx.effect(() =>
      ctx.commands.register({
        name,
        description,
        ...(hint ? { input: { hint } } : {}),
        handler: async (invocation) => {
          try {
            return { kind: "success", text: await handler(invocation) };
          } catch (error) {
            return { kind: "error", text: String(error) };
          }
        },
      }),
    );
  register(
    "test",
    "在当前对话启用测试增强，正常规划、执行、断言并生成报告",
    ({ agent, rawInput }) => tests.start(agent, rawInput.trim()),
    "任务描述，包含动作、输入和可验证的预期结果",
  );
  register(
    "test-plan",
    "在原生plan模式规划测试，经用户审核修改并同意后执行",
    ({ agent, rawInput }) => {
      const file = /^--file\s+([\s\S]+)$/.exec(rawInput.trim());
      if (rawInput.trim() === "--file")
        throw new Error("请提供TXT或Markdown用例路径");
      return tests.start(
        agent,
        rawInput.trim(),
        undefined,
        true,
        file
          ? loadTextInput(commandWorkspace(agent), fileArgument(file[1]!))
          : undefined,
      );
    },
    "任务描述或 --file cases.md；规划后先审核，确认后执行",
  );
  register(
    "test-run",
    "执行TXT、Markdown文字用例或完整JSON测试集合",
    ({ agent, rawInput }) => {
      const usage =
        "请提供工作区内的TXT、Markdown或JSON测试集合文件路径，例如 /test-run examples/cases.txt；自然语言任务请使用 /test <任务描述>。";
      if (!rawInput.trim()) throw new Error(usage);
      const workspace = commandWorkspace(agent);
      const input = fileArgument(rawInput);
      let path: string;
      try {
        path = inputPath(input, workspace);
      } catch (error) {
        if (
          ["ENOENT", "ENOTDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw new Error(
            `输入文件不存在：${resolve(workspace, input)}。当前工作区：${workspace}。${usage}`,
          );
        throw error;
      }
      if (!statSync(path).isFile()) throw new Error(usage);
      const extension = extname(path).toLowerCase();
      if ([".txt", ".md", ".markdown"].includes(extension)) {
        return tests.start(
          agent,
          rawInput.trim(),
          undefined,
          false,
          loadTextInput(workspace, path),
        );
      }
      if (extension !== ".json") throw new Error(usage);
      const plan = JSON.parse(readFileSync(path, "utf8"));
      return tests.start(
        agent,
        `执行测试集合 ${rawInput.trim()}。请在当前对话逐步说明执行情况，按test_current指引使用原生工具完成采集、断言及清理，最后提供报告链接。`,
        plan,
      );
    },
    "TXT、Markdown或JSON文件路径；自然语言请使用 /test",
  );
  register(
    "test-data",
    "读取CSV参数与任务模板，先审核每个实例的参数和文字步骤，再执行",
    ({ agent, rawInput }) =>
      tests.start(
        agent,
        rawInput.trim(),
        undefined,
        true,
        loadDataInput(commandWorkspace(agent), rawInput),
      ),
    "data.csv <包含${参数名}的任务> 或 data.csv --file cases.md",
  );
  ctx.effect(() => async () => {
    await tests.shutdown();
    await setup.dispose();
  });
}
