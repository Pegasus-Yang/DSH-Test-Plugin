/** 把已记录的执行事实发布到命令所属对话；不生成虚构模型回复。 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { atomicJson } from "./recorder.js";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { TestProgress } from "./progress-types.js";
import type { SuiteRun } from "./contracts.js";
import { statistics } from "./contracts.js";
import { redact, type Recorder, type RecordedEvent } from "./recorder.js";

export class ConversationProgress {
  private warned = false;
  readonly value: TestProgress;
  constructor(
    private readonly agent: Agent,
    id: string,
    title: string,
    private readonly outputRoot: string,
  ) {
    this.value = {
      id,
      sessionId: agent.id,
      title,
      state: "planning",
      detail: "正在准备测试",
      updatedAt: "",
      instances: [],
    };
  }
  publish(): void {
    this.value.updatedAt = new Date().toISOString();
    try {
      mkdirSync(join(this.outputRoot, "conversation"), { recursive: true });
      atomicJson(
        join(this.outputRoot, "conversation", `${this.value.id}.json`),
        redact(this.value),
      );
    } catch {
      if (!this.warned)
        console.warn(
          "测试对话进度写入失败；执行与清理继续，最终结果见运行记录。",
        );
      this.warned = true;
    }
  }
  session(id: string): void {
    this.value.planningSession = id;
    this.value.detail = "正在将任务转为步骤和可验证断言";
    this.publish();
  }
  update(run: SuiteRun, recorder: Recorder, event?: RecordedEvent): void {
    this.value.runId = run.suite_run_id;
    this.value.title = String(recorder.sanitize(run.name));
    this.value.state =
      run.lifecycle === "CANCELLING" ? "cancelling" : "running";
    this.value.instances = recorder.sanitize(
      run.instances.map((instance) => ({
        id: instance.case_run_id,
        name: instance.name,
        dataId: instance.data_id,
        status: instance.status,
        ...(instance.session_id ? { sessionId: instance.session_id } : {}),
        ...(instance.cleanup_session_id
          ? { cleanupSession: instance.cleanup_session_id }
          : {}),
        steps: instance.steps.map((step) => {
          const tool = step.calls.at(-1);
          return {
            id: step.step_id,
            phase: step.phase,
            description: step.description,
            status: step.status,
            ...(step.reason ? { reason: step.reason } : {}),
            values: step.observations.map((o) => ({
              name: o.output_name,
              value: o.value,
            })),
            ...(step.assertion
              ? {
                  assertion: {
                    status: step.assertion.status,
                    actual: step.assertion.actual,
                    expected: step.assertion.expected,
                    operator: step.assertion.operator,
                  },
                }
              : {}),
            ...(tool
              ? {
                  tool: {
                    name: tool.name,
                    finished: !!tool.finished_at,
                    error: !!tool.isError,
                  },
                }
              : {}),
          };
        }),
      })),
    ) as unknown as TestProgress["instances"];
    const current = this.value.instances
      .flatMap((i) => i.steps)
      .findLast((s) => s.status === "RUNNING");
    this.value.detail =
      this.value.state === "cancelling"
        ? "停止已请求：等待在途操作结算并执行预授权清理"
        : current
          ? `正在执行：${current.description}`
          : "正在调度步骤或整理结果";
    if (event?.type === "approval_asked")
      this.value.detail = "等待审批：请打开当前执行会话处理审批";
    this.publish();
  }
  finish(
    run: SuiteRun,
    recorder: Recorder,
    report?: TestProgress["report"],
  ): string {
    this.update(run, recorder);
    this.value.state = "finished";
    const counts = statistics(run);
    const labels: Record<string, string> = {
      total: "共",
      PASS: "通过",
      FAIL: "失败",
      ERROR: "错误",
      BLOCKED: "阻塞",
      INCONCLUSIVE: "证据不足",
      CANCELLED: "取消",
    };
    this.value.detail = `测试结束：${Object.entries(counts)
      .map(([key, count]) => `${labels[key] ?? key} ${count} 项`)
      .join(
        "，",
      )}${run.incomplete ? "；记录不完整" : ""}${run.resource_quarantined ? "；环境已隔离" : ""}`;
    if (report) this.value.report = report;
    else this.value.detail += "；报告生成失败，请检查运行记录";
    this.publish();
    return this.value.detail;
  }
  fail(error: unknown): void {
    this.value.state = "error";
    this.value.detail = String(redact(String(error)));
    this.publish();
  }
}
