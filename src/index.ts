/** 原生对话增强入口；命令只激活当前Agent的测试能力。 */
import type { Context } from "@deepseek-ai/cordis";
import type { CommandInvocation } from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-client-connection";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { NativeTests } from "./native-test.js";
import type { TestConfig } from "./config.js";
import { reportPrefix } from "./report-access.js";
import { atomicJson, rebuild } from "./recorder.js";
import { writeReport } from "./report.js";
export { parsePlan } from "./contracts.js";
export const name = "harness-test";
export const inject = ["commands", "tools", "systemPrompt"] as const;
declare module "@deepseek-ai/cordis" {
  interface Context {
    nativeTests: NativeTests;
  }
}
export function apply(ctx: Context, config: Partial<TestConfig> = {}): void {
  const tests = new NativeTests(ctx, config);
  ctx.provide("nativeTests", tests);
  ctx.inject(["webServer", "connection"], (web) => {
    tests.reports.origin = () => `http://127.0.0.1:${web.webServer.port}`;
    web.effect(() => () => {
      tests.reports.origin = undefined;
    });
    web.effect(() =>
      web.webServer.register({
        kind: "prefix",
        path: reportPrefix,
        handler: (req, res) => {
          if (web.connection.authorizeIndex(req, res))
            tests.reports.serve(req, res);
        },
      }),
    );
  });
  const inputPath = (input: string) => {
    const full = realpathSync(resolve(tests.config.workspace, input.trim()));
    const rel = relative(realpathSync(tests.config.workspace), full);
    if (rel === ".." || rel.startsWith(".." + sep))
      throw new Error("输入文件必须位于项目工作区");
    return full;
  };
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
    ({ agent, rawInput }) =>
      tests.start(agent, rawInput.trim(), undefined, true),
    "任务描述；规划后先审核，确认后执行",
  );
  register(
    "test-run",
    "在当前对话执行JSON测试集合；自然语言请使用 /test",
    ({ agent, rawInput }) => {
      const usage =
        "请提供工作区内的JSON测试集合文件路径，例如 /test-run examples/ceshiren-agent.json；自然语言任务请使用 /test <任务描述>。";
      if (!rawInput.trim()) throw new Error(usage);
      let path: string;
      try {
        path = inputPath(rawInput);
      } catch (error) {
        if (
          ["ENOENT", "ENOTDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw new Error("输入文件不存在。" + usage);
        throw error;
      }
      if (!statSync(path).isFile()) throw new Error(usage);
      const plan = JSON.parse(readFileSync(path, "utf8"));
      return tests.start(
        agent,
        `执行测试集合 ${rawInput.trim()}。请在当前对话逐步说明执行情况，按test_current指引使用原生工具完成采集、断言及清理，最后提供报告链接。`,
        plan,
      );
    },
    "JSON测试集合路径；自然语言请使用 /test",
  );
  register("test-status", "查看当前对话的测试状态", ({ agent }) => {
    const test = tests.sessions.get(agent.id);
    return test
      ? JSON.stringify(
          { ...test.state(), directory: test.recorder.directory },
          null,
          2,
        )
      : "当前对话没有测试任务。";
  });
  register(
    "test-stop",
    "停止当前对话测试业务，结算后在同一会话执行预授权清理",
    ({ agent }) => {
      const test = tests.sessions.get(agent.id);
      if (!test || test.closed) return "当前对话没有活动测试。";
      test.stop();
      return "已请求停止；当前会话将在在途操作结算后执行预授权清理，并给出最终报告。";
    },
  );
  register(
    "test-report",
    "重建指定报告；省略ID仅查看当前对话的报告",
    ({ agent, rawInput }) => {
      const runId = rawInput.trim() || tests.reportId(agent.id);
      if (!runId || !/^run-[\w-]+$/.test(runId))
        throw new Error("当前对话没有报告，请提供合法运行ID。");
      if (
        tests.sessions.get(agent.id)?.run.suite_run_id === runId &&
        !tests.sessions.get(agent.id)?.closed
      )
        throw new Error("当前测试尚未结束。");
      const directory = join(tests.config.outputRoot, runId);
      if (!existsSync(directory)) throw new Error("运行记录不存在");
      const run = rebuild(directory);
      atomicJson(join(directory, "results-rebuilt.json"), run);
      writeReport(directory, run, "report-rebuilt.html");
      return `报告为静态HTML，可离线打开。\n保存位置：${join(directory, "report-rebuilt.html")}\n查看测试报告：${tests.reports.url(runId, "report-rebuilt.html")}`;
    },
    "运行ID（可留空，查看当前对话报告）",
  );
  register(
    "test-release",
    "确认外部已停止并重置后，用工作区证据文件解除共享环境隔离",
    ({ rawInput }) => {
      tests.release(inputPath(rawInput));
      return "已记录处置证据并解除隔离。";
    },
    "工作区内的处置证据JSON路径",
  );
  ctx.effect(() => () => tests.shutdown());
}
