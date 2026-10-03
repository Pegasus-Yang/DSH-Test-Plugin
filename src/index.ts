/** 原生插件装配入口；所有注册随 Cordis 作用域释放。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "@deepseek-ai/dsh-client-connection";
import { ReportAccess, reportPrefix } from "./report-access.js";
import { reportNotice } from "./report-notice.js";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-commands";
import type { CommandInvocation } from "@deepseek-ai/dsh-commands";
import { ConversationProgress } from "./progress.js";
import type {} from "@deepseek-ai/dsh-agent-default-model";
import { readFileSync, realpathSync, existsSync, statSync } from "node:fs";
import { resolve, relative, sep, join } from "node:path";
import { TestRunner, type RunnerConfig } from "./runner.js";
import { planTask } from "./planner.js";
import { rebuild, atomicJson } from "./recorder.js";
import { writeReport } from "./report.js";
import { statistics } from "./contracts.js";
declare module "@deepseek-ai/cordis" {
  interface Context {
    testRunner: TestRunner;
  }
}
export const name = "harness-test";
export const inject = [
  "agents",
  "tools",
  "commands",
  "agentDefaultModel",
] as const;
export { TestRunner } from "./runner.js";
export { parsePlan } from "./contracts.js";
export function apply(ctx: Context, config: Partial<RunnerConfig> = {}): void {
  const runner = new TestRunner(ctx, config);
  ctx.provide("testRunner", runner);
  const reports = new ReportAccess(runner.config.outputRoot);
  ctx.inject(["webServer", "connection"], (web) => {
    web.effect(() =>
      web.webServer.register({
        kind: "prefix",
        path: reportPrefix,
        handler: (req, res) => {
          if (web.connection.authorizeIndex(req, res)) reports.serve(req, res);
        },
      }),
    );
    web.on("webserver/index-inject", (table) =>
      table.push({
        kind: "script",
        placement: "body",
        text: "(" + reportNotice.toString() + ")();",
      }),
    );
  });
  let planning = false;
  let planningAbort: AbortController | undefined;
  let planningId: string | undefined;
  const inputPath = (path: string) => {
    const full = realpathSync(resolve(runner.config.workspace, path.trim())),
      rel = relative(realpathSync(runner.config.workspace), full);
    if (rel === ".." || rel.startsWith(".." + sep))
      throw new Error("输入文件必须位于项目工作区");
    return full;
  };
  const start = async (
    plan: unknown,
    invocation: CommandInvocation,
    progress: ConversationProgress,
  ) => {
    invocation.signal.throwIfAborted();
    const stop = () => runner.stop();
    invocation.signal.addEventListener("abort", stop, { once: true });
    try {
      const run = runner.start(plan, undefined, (event) => {
        if (
          [
            "state_saved",
            "session_created",
            "tool_bound",
            "tool_finished",
            "approval_asked",
            "approval_decided",
            "stop_requested",
          ].includes(event.type)
        )
          progress.update(runner.run!, runner.recorder!, event);
      });
      reports.select(run, "report.html", false);
      const completed = await runner.done!;
      reports.finish(completed);
      const report = reports.state();
      const summary = progress.finish(
        completed,
        runner.recorder!,
        report?.ready ? { url: report.url, path: report.path } : undefined,
      );
      return `${summary}\n运行ID：${run.suite_run_id}\n${report?.ready ? `查看测试报告：${report.url}\n保存位置：${report.path}` : "报告未生成"}`;
    } finally {
      invocation.signal.removeEventListener("abort", stop);
    }
  };
  const register = (
    command: string,
    description: string,
    handler: (
      input: string,
      invocation: CommandInvocation,
    ) => string | Promise<string>,
    inputHint?: string,
  ) =>
    ctx.effect(() =>
      ctx.commands.register({
        name: command,
        description,
        ...(inputHint === undefined ? {} : { input: { hint: inputHint } }),
        handler: async (invocation) => {
          try {
            return {
              kind: "success" as const,
              text: await handler(invocation.rawInput, invocation),
            };
          } catch (error) {
            return { kind: "error" as const, text: String(error) };
          }
        },
      }),
    );
  register(
    "test-run",
    "执行项目内的JSON测试集合；自然语言请使用 /test",
    async (input, invocation) => {
      if (planning) throw new Error("正在规划");
      const usage =
        "请提供工作区内的JSON测试集合文件路径，例如 /test-run examples/ceshiren-agent.json；自然语言任务请使用 /test <任务描述>。";
      if (!input.trim()) throw new Error(usage);
      let path: string;
      try {
        path = inputPath(input);
      } catch (error) {
        if (
          ["ENOENT", "ENOTDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw new Error(`输入文件不存在。${usage}`);
        throw error;
      }
      if (!statSync(path).isFile()) throw new Error(usage);
      const plan = JSON.parse(readFileSync(path, "utf8"));
      const progress = new ConversationProgress(
        invocation.agent,
        invocation.commandId,
        "执行JSON测试集合",
        runner.config.outputRoot,
      );
      progress.publish();
      try {
        return await start(plan, invocation, progress);
      } catch (error) {
        progress.fail(error);
        throw error;
      }
    },
    "JSON测试集合路径；自然语言请使用 /test",
  );
  register(
    "test",
    "将自然语言任务规划并执行；缺少预期时返回问题",
    async (input, invocation) => {
      if (planning || runner.active || runner.quarantined)
        throw new Error("已有规划/运行或环境隔离");
      planning = true;
      planningAbort = new AbortController();
      planningId = invocation.commandId;
      const progress = new ConversationProgress(
        invocation.agent,
        invocation.commandId,
        input,
        runner.config.outputRoot,
      );
      try {
        progress.publish();
        const plan = await planTask(
          ctx,
          input,
          runner.config.workspace,
          runner.config.stepTimeoutMs,
          AbortSignal.any([planningAbort.signal, invocation.signal]),
          (id) => progress.session(id),
        );
        planning = false;
        return await start(plan, invocation, progress);
      } catch (error) {
        progress.fail(error);
        throw error;
      } finally {
        planning = false;
        planningAbort = undefined;
        planningId = undefined;
      }
    },
    "任务描述，包含动作、输入和可验证的预期结果",
  );
  register("test-status", "查看当前批次、实例会话和隔离状态", () =>
    JSON.stringify(
      {
        planning,
        quarantined: runner.quarantined,
        report: reports.state(),
        run: runner.run
          ? {
              id: runner.run.suite_run_id,
              lifecycle: runner.run.lifecycle,
              statistics: statistics(runner.run),
              instances: runner.run.instances.map((i) => ({
                id: i.case_run_id,
                status: i.status,
                session: i.session_id,
                cleanup_session: i.cleanup_session_id,
              })),
              directory: runner.recorder!.directory,
            }
          : null,
      },
      null,
      2,
    ),
  );
  register("test-stop", "停止业务动作；结算后执行预授权清理", (input) => {
    if (
      input.trim() &&
      input.trim() !== (planning ? planningId : runner.run?.suite_run_id)
    )
      throw new Error("该测试已结束或不是当前运行，未停止其他测试");
    planningAbort?.abort();
    runner.stop();
    return "停止请求已提交；最终状态以 /test-status 和报告为准。";
  });
  register(
    "test-report",
    "只读重建报告：传入运行ID，省略使用本批次",
    (input, invocation) => {
      const id = input.trim() || runner.run?.suite_run_id || reports.latestId;
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id))
        throw new Error("请提供合法运行ID");
      if (runner.active && id === runner.run?.suite_run_id)
        throw new Error("测试仍在运行，结束后网页会自动显示报告入口。");
      const directory = join(runner.config.outputRoot, id);
      if (!existsSync(directory)) throw new Error("运行记录不存在");
      const run = rebuild(directory);
      atomicJson(join(directory, "results-rebuilt.json"), run);
      writeReport(directory, run, "report-rebuilt.html");
      reports.select(run, "report-rebuilt.html");
      const progress = new ConversationProgress(
        invocation.agent,
        invocation.commandId,
        "测试报告",
        runner.config.outputRoot,
      );
      Object.assign(progress.value, {
        state: "finished",
        detail: "报告已从运行记录重建",
        runId: id,
        report: {
          url: reports.url(id, "report-rebuilt.html"),
          path: join(directory, "report-rebuilt.html"),
        },
      });
      progress.publish();
      return `报告已生成，点击网页中的“查看测试报告”。\n保存位置：${join(directory, "report-rebuilt.html")}\n浏览地址（相对当前DSH网页）：${reports.url(id, "report-rebuilt.html")}\n报告为静态HTML，可离线打开；无需填写运行ID即可查看最近报告。`;
    },
    "运行ID（可留空，查看最近报告）",
  );
  register(
    "test-release",
    "依据项目内处置证据JSON解除持久隔离",
    (input) => {
      runner.release(inputPath(input));
      return "隔离已解除，处置记录已保留。";
    },
    "处置证据JSON路径",
  );
  ctx.effect(() => () => {
    planningAbort?.abort();
    return runner.shutdown();
  });
}
