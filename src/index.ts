/** 原生插件装配入口；所有注册随 Cordis 作用域释放。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-agent-default-model";
import { readFileSync, realpathSync, existsSync } from "node:fs";
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
  let planning = false;
  const inputPath = (path: string) => {
    const full = realpathSync(resolve(runner.config.workspace, path.trim())),
      rel = relative(realpathSync(runner.config.workspace), full);
    if (rel === ".." || rel.startsWith(".." + sep))
      throw new Error("输入文件必须位于项目工作区");
    return full;
  };
  const start = (plan: unknown) => {
    const run = runner.start(plan);
    return `已启动 ${run.suite_run_id}\n${run.instances.length} 个实例；使用 /test-status 查看会话与状态、/test-stop 停止。\n报告：${runner.recorder!.directory}/report.html`;
  };
  const register = (
    command: string,
    description: string,
    handler: (input: string) => string | Promise<string>,
  ) =>
    ctx.effect(() =>
      ctx.commands.register({
        name: command,
        description,
        handler: async ({ rawInput }) => {
          try {
            return { kind: "success" as const, text: await handler(rawInput) };
          } catch (error) {
            return { kind: "error" as const, text: String(error) };
          }
        },
      }),
    );
  register("test-run", "执行项目内的JSON测试集合", (input) => {
    if (planning) throw new Error("正在规划");
    return start(JSON.parse(readFileSync(inputPath(input), "utf8")));
  });
  register(
    "test",
    "将自然语言任务规划并执行；缺少预期时返回问题",
    async (input) => {
      if (planning || runner.active || runner.quarantined)
        throw new Error("已有规划/运行或环境隔离");
      planning = true;
      try {
        return start(
          await planTask(
            ctx,
            input,
            runner.config.workspace,
            runner.config.stepTimeoutMs,
          ),
        );
      } finally {
        planning = false;
      }
    },
  );
  register("test-status", "查看当前批次、实例会话和隔离状态", () =>
    JSON.stringify(
      {
        planning,
        quarantined: runner.quarantined,
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
  register("test-stop", "停止业务动作；结算后执行预授权清理", () => {
    runner.stop();
    return "停止请求已提交；最终状态以 /test-status 和报告为准。";
  });
  register(
    "test-report",
    "只读重建报告：传入运行ID，省略使用本批次",
    (input) => {
      const id = input.trim() || runner.run?.suite_run_id;
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id))
        throw new Error("请提供合法运行ID");
      const directory = join(runner.config.outputRoot, id);
      if (!existsSync(directory)) throw new Error("运行记录不存在");
      const run = rebuild(directory);
      atomicJson(join(directory, "results-rebuilt.json"), run);
      writeReport(directory, run, "report-rebuilt.html");
      return join(directory, "report-rebuilt.html");
    },
  );
  register("test-release", "依据项目内处置证据JSON解除持久隔离", (input) => {
    runner.release(inputPath(input));
    return "隔离已解除，处置记录已保留。";
  });
  ctx.effect(() => () => runner.shutdown());
}
