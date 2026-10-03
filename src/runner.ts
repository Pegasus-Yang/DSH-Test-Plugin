/** 串行实例执行、停止收尾和持久隔离。 */
import type { Context } from "@deepseek-ai/cordis";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  aggregate,
  expand,
  field,
  parsePlan,
  type Binding,
  type CaseRun,
  type Json,
  type Phase,
  type Step,
  type StepResult,
  type SuiteRun,
  type TestSuite,
} from "./contracts.js";
import { evaluate } from "./assertions.js";
import { Recorder, atomicJson, rebuild } from "./recorder.js";
import { HarnessSession, type ActiveStep, type HostOptions } from "./host.js";
import { captureStep } from "./adapters.js";
import { writeReport } from "./report.js";
import { applyRevision } from "./revisions.js";

export interface RunnerConfig {
  workspace: string;
  outputRoot: string;
  stepTimeoutMs: number;
  cleanupTimeoutMs: number;
  cancelGraceMs: number;
  hookTimeoutMs: number;
  maxModelSteps: number;
  maxRevisions: number;
}
export const defaults: RunnerConfig = {
  workspace: process.cwd(),
  outputRoot: resolve("artifacts/runs"),
  stepTimeoutMs: 180000,
  cleanupTimeoutMs: 60000,
  cancelGraceMs: 10000,
  hookTimeoutMs: 5000,
  maxModelSteps: 24,
  maxRevisions: 10,
};
export type HookName =
  | "before_step"
  | "after_observation"
  | "after_assertion"
  | "report_ready";
export type Hook = (
  view: Readonly<{ instance: CaseRun; step?: Step; result?: StepResult }>,
) => void | boolean | Promise<void | boolean>;
export interface SessionDriver {
  id: string;
  run(active: ActiveStep, goal: string): Promise<void>;
  cancel(): void;
  drain(): Promise<boolean>;
  seal(): void;
  dispose(): Promise<void>;
  resume?(): void;
}
export type SessionFactory = (
  recorder: Recorder,
  options: HostOptions,
) => Promise<SessionDriver>;

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}
async function bounded<T>(job: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      job,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("hook超时")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class TestRunner {
  readonly config: RunnerConfig;
  run?: SuiteRun;
  recorder?: Recorder;
  done?: Promise<SuiteRun>;
  private driver?: SessionDriver;
  private stopping = false;
  private hooks: Partial<Record<HookName, Hook[]>> = {};
  constructor(
    private ctx: Context,
    config: Partial<RunnerConfig> = {},
    private factory?: SessionFactory,
  ) {
    this.config = { ...defaults, ...config };
    for (const [key, value] of Object.entries(this.config))
      if (typeof value === "number" && (!Number.isFinite(value) || value <= 0))
        throw new Error("预算必须为有限正数: " + key);
    mkdirSync(this.config.outputRoot, { recursive: true });
    const released = new Set(
      readdirSync(this.config.outputRoot)
        .filter((n) => n.startsWith("release-") && n.endsWith(".json"))
        .map((n) => {
          try {
            return JSON.parse(
              readFileSync(join(this.config.outputRoot, n), "utf8"),
            ).quarantine.details.run_id;
          } catch {
            return undefined;
          }
        }),
    );
    for (const entry of readdirSync(this.config.outputRoot, {
      withFileTypes: true,
    }).filter((d) => d.isDirectory() && !released.has(d.name))) {
      const dir = join(this.config.outputRoot, entry.name);
      if (!existsSync(join(dir, "events.jsonl"))) continue;
      try {
        const recovered = rebuild(dir);
        if (recovered.resource_quarantined)
          this.quarantine({
            run_id: recovered.suite_run_id,
            reason: "重启发现未结算调用",
          });
      } catch (error) {
        this.quarantine({
          run_id: entry.name,
          reason: "运行记录无法验证: " + String(error),
        });
      }
    }
  }
  hook(name: HookName, fn: Hook): () => void {
    const list = (this.hooks[name] ??= []);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  private async invoke(
    name: HookName,
    instance: CaseRun,
    step?: Step,
    result?: StepResult,
  ): Promise<boolean> {
    for (const fn of this.hooks[name] ?? []) {
      this.recorder!.event("hook_started", {
        name,
        case_run_id: instance.case_run_id,
        step_id: step?.step_id,
      });
      try {
        const allowed = await bounded(
          Promise.resolve().then(() =>
            fn(freeze(structuredClone({ instance, step, result }))),
          ),
          this.config.hookTimeoutMs,
        );
        this.recorder!.event("hook_finished", {
          name,
          case_run_id: instance.case_run_id,
          step_id: step?.step_id,
          allowed: allowed !== false,
        });
        if (allowed === false && name === "before_step") return false;
      } catch (error) {
        this.recorder!.event("hook_failed", { name, error: String(error) });
        if (name === "before_step") throw error;
        instance.issues.push(name + "警示: " + String(error));
        this.recorder!.event("hook_warning", { name, error: String(error) });
      }
    }
    return true;
  }
  get active(): boolean {
    return (
      this.run?.lifecycle === "RUNNING" || this.run?.lifecycle === "CANCELLING"
    );
  }
  get quarantined(): boolean {
    return existsSync(join(this.config.outputRoot, "quarantine.json"));
  }
  private quarantine(data: unknown): void {
    atomicJson(join(this.config.outputRoot, "quarantine.json"), {
      created_at: new Date().toISOString(),
      details: data,
    });
  }
  /** 运维证明必须是实际文件，解除行为留有独立审计；不自动推断外部已停止。 */
  release(evidenceFile: string): void {
    if (this.active) throw new Error("活动批次不能解除隔离");
    const proof = JSON.parse(readFileSync(evidenceFile, "utf8"));
    if (
      proof.external_stopped !== true ||
      proof.environment_reset !== true ||
      !proof.operator ||
      !proof.details ||
      !proof.evidence
    )
      throw new Error("需提供外部停止、环境重置、操作者与处置证据");
    const current = JSON.parse(
      readFileSync(join(this.config.outputRoot, "quarantine.json"), "utf8"),
    );
    atomicJson(
      join(this.config.outputRoot, "release-" + randomUUID() + ".json"),
      { quarantine: current, proof, released_at: new Date().toISOString() },
    );
    unlinkSync(join(this.config.outputRoot, "quarantine.json"));
  }
  start(input: unknown, previousRunId?: string): SuiteRun {
    if (this.active) throw new Error("已有活动批次");
    if (this.quarantined)
      throw new Error("环境已隔离，先核实外部停止并重置环境");
    const plan = parsePlan(input);
    this.stopping = false;
    const id =
      "run-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID().slice(0, 8);
    this.recorder = new Recorder(this.config.outputRoot, id);
    this.recorder.protect(plan);
    this.run = {
      schema_version: "1",
      suite_run_id: id,
      name: plan.name,
      created_at: new Date().toISOString(),
      lifecycle: "RUNNING",
      plan,
      instances: expand(plan),
      evidence: [],
      incomplete: false,
      resource_quarantined: false,
      manifest: {
        plugin_version: "0.1.0",
        tools_mode: "native",
        max_parallel_tool_calls: 1,
        budgets: {
          execution_ms: this.config.stepTimeoutMs,
          approval_ms: this.config.stepTimeoutMs,
          cleanup_ms: this.config.cleanupTimeoutMs,
          cancel_grace_ms: this.config.cancelGraceMs,
          hook_ms: this.config.hookTimeoutMs,
          max_model_steps: this.config.maxModelSteps,
        },
        previous_run_id: previousRunId ?? null,
      },
    };
    this.recorder.json("plan.json", plan);
    this.recorder.snapshot(this.run);
    this.done = this.execute(this.run, plan);
    return this.run;
  }
  stop(): void {
    if (!this.active) return;
    this.stopping = true;
    this.run!.lifecycle = "CANCELLING";
    this.recorder!.event("stop_requested", {});
    this.driver?.cancel();
  }
  async shutdown(): Promise<void> {
    this.stop();
    if (this.done) await this.done;
  }
  private async makeDriver(
    instance: CaseRun,
    cleanup = false,
  ): Promise<SessionDriver> {
    const options: HostOptions = {
      cleanup,
      workspace: this.config.workspace,
      stepTimeoutMs: cleanup
        ? this.config.cleanupTimeoutMs
        : this.config.stepTimeoutMs,
      cancelGraceMs: this.config.cancelGraceMs,
      maxModelSteps: this.config.maxModelSteps,
      propose: cleanup
        ? undefined
        : (proposal) => {
            if (this.stopping) throw new Error("停止后不能修订");
            return applyRevision(
              this.run!,
              this.recorder!,
              proposal as Parameters<typeof applyRevision>[2],
              this.config.maxRevisions,
            ) as unknown as Json;
          },
      onSession: (id) => {
        if (cleanup) instance.cleanup_session_id = id;
        else instance.session_id = id;
        this.recorder!.event("session_created", {
          case_run_id: instance.case_run_id,
          session_id: id,
          cleanup,
        });
      },
    };
    return this.factory
      ? this.factory(this.recorder!, options)
      : HarnessSession.create(this.ctx, this.recorder!, options);
  }
  private async execute(suite: SuiteRun, plan: TestSuite): Promise<SuiteRun> {
    try {
      for (const instance of suite.instances) {
        if (this.stopping || suite.resource_quarantined) {
          instance.status = this.stopping ? "CANCELLED" : "BLOCKED";
          instance.cancelled = this.stopping;
          instance.blocked = !this.stopping;
          instance.lifecycle = "FINISHED";
          continue;
        }
        const testCase = plan.cases.find(
          (c) => c.case_id === instance.case_id,
        )!;
        instance.status = "RUNNING";
        instance.lifecycle = "RUNNING";
        this.recorder!.snapshot(suite);
        try {
          this.driver = await this.makeDriver(instance);
          instance.session_id = this.driver.id;
          if (
            [...testCase.preconditions, ...testCase.steps].some(
              (s) => s.action?.capability === "browser",
            )
          ) {
            instance.resources.browser_context = {
              id: this.driver.id,
              state: "exists",
            };
            const reset: Step = {
              step_id: "__reset",
              kind: "action",
              description: "初始化独立浏览器上下文（关闭上一上下文）",
              required: true,
              depends_on: [],
              action: {
                goal: "调用 test_capture，由可信采集器关闭此前浏览器上下文，然后 test_finish_step。后续导航会创建干净上下文。",
                capability: "browser",
                allowed_targets: ["https://localhost"],
                inputs: {},
                outputs: { released: { type: "boolean", const: true } },
                completion_requirements: ["released"],
                capture: { released: { kind: "browser_close" } },
              },
            };
            await this.step(instance, reset, "setup");
          }
          let halted = instance.steps.some(
            (s) =>
              s.required && s.status !== "SUCCEEDED" && s.status !== "PASS",
          );
          for (const phase of ["setup", "test"] as const) {
            const steps =
              phase === "setup"
                ? testCase.preconditions
                : instance.effective_steps;
            for (let n = 0; n < steps.length; n++) {
              const step = steps[n]!;
              if (this.stopping || halted || suite.resource_quarantined) {
                this.skip(
                  instance,
                  step,
                  phase,
                  this.stopping ? "用户停止" : "前序必需步骤未通过",
                );
                continue;
              }
              const result = await this.step(instance, step, phase);
              halted =
                instance.integrity_error ||
                (step.required &&
                  !["SUCCEEDED", "PASS"].includes(result.status));
            }
          }
        } catch (error) {
          instance.integrity_error = true;
          instance.issues.push(String(error));
          this.driver?.cancel();
        }
        if (this.stopping) instance.cancelled = true;
        // 先结算业务在途调用，随后独立Agent以新取消信号执行预授权清理。
        if (this.driver) {
          if (instance.integrity_error || this.stopping) this.driver.cancel();
          if (!(await this.driver.drain()))
            this.isolate(instance, "业务调用收尾超限");
          if (!instance.resource_quarantined) await this.driver.dispose();
          else this.driver.seal();
          this.driver = undefined;
        }
        if (!instance.resource_quarantined && !this.recorder!.failed) {
          try {
            const cleanupSteps = [...testCase.cleanup];
            if (
              instance.resources.browser_context?.state === "exists" &&
              !cleanupSteps.some((s) =>
                Object.values(s.action?.capture ?? {}).some(
                  (c) => c.kind === "browser_close",
                ),
              )
            )
              cleanupSteps.push({
                step_id: "__release",
                kind: "action",
                description: "释放实例浏览器上下文",
                required: true,
                depends_on: [],
                run_if: "resource_exists",
                resource_ref: "browser_context",
                action: {
                  goal: "仅调用test_capture释放浏览器，然后test_finish_step。",
                  capability: "browser",
                  allowed_targets: ["https://localhost"],
                  inputs: {},
                  outputs: { released: { type: "boolean", const: true } },
                  completion_requirements: ["released"],
                  capture: { released: { kind: "browser_close" } },
                },
              });
            if (cleanupSteps.length) {
              this.driver = await this.makeDriver(instance, true);
              instance.cleanup_session_id = this.driver.id;
            }
            for (const step of cleanupSteps) {
              if (step.run_if === "resource_exists") {
                const resource = instance.resources[step.resource_ref!];
                if (resource?.state === "absent") {
                  this.skip(instance, step, "cleanup", "资源确认不存在", false);
                  continue;
                }
                if (!resource || resource.state === "unknown") {
                  this.isolate(
                    instance,
                    "清理资源状态未知: " + step.resource_ref,
                  );
                  break;
                }
              }
              const result = await this.step(instance, step, "cleanup");
              if (
                step.required &&
                !["SUCCEEDED", "PASS", "SKIPPED"].includes(result.status) &&
                step.resource_ref
              )
                this.isolate(
                  instance,
                  "必要资源清理未完成: " + step.resource_ref,
                );
              if (instance.resource_quarantined) break;
              if (
                result.status === "SUCCEEDED" &&
                Object.values(step.action?.capture ?? {}).some(
                  (c) => c.kind === "browser_close",
                ) &&
                instance.resources.browser_context
              )
                instance.resources.browser_context.state = "absent";
            }
            if (this.driver) {
              if (!(await this.driver.drain()))
                this.isolate(instance, "清理收尾超限");
              if (!instance.resource_quarantined) await this.driver.dispose();
              else this.driver.seal();
              this.driver = undefined;
            }
          } catch (error) {
            instance.integrity_error = true;
            instance.issues.push("清理错误: " + String(error));
            this.isolate(instance, "清理无法证明结算");
          }
        }
        instance.status = aggregate(instance);
        instance.lifecycle = "FINISHED";
        this.recorder!.snapshot(suite);
      }
    } catch (error) {
      suite.incomplete = true;
      for (const i of suite.instances)
        if (i.lifecycle !== "FINISHED") {
          i.status = "ERROR";
          i.lifecycle = "INTERRUPTED";
          i.incomplete = true;
          i.integrity_error = true;
          i.issues.push(String(error));
        }
      if (this.driver) {
        this.driver.cancel();
        const settled = await this.driver.drain();
        if (!settled) {
          suite.resource_quarantined = true;
          this.quarantine({
            run_id: suite.suite_run_id,
            reason: "记录错误且执行未结算",
          });
          this.driver.seal();
        } else await this.driver.dispose();
        this.driver = undefined;
      }
    } finally {
      suite.lifecycle = "FINISHED";
      suite.finished_at = new Date().toISOString();
      try {
        this.recorder!.snapshot(suite);
        writeReport(
          this.recorder!.directory,
          this.recorder!.sanitize(suite) as unknown as SuiteRun,
        );
        for (const instance of suite.instances)
          await this.invoke("report_ready", instance);
        this.recorder!.snapshot(suite);
      } catch (error) {
        suite.incomplete = true;
        atomicJson(join(this.recorder!.directory, "emergency.json"), {
          error: String(error),
          run: this.recorder!.sanitize(suite),
        });
      }
    }
    return suite;
  }
  private isolate(instance: CaseRun, reason: string): void {
    instance.incomplete = true;
    instance.integrity_error = true;
    instance.resource_quarantined = true;
    instance.issues.push(reason);
    instance.unsettled_call_ids = instance.steps.flatMap((s) =>
      s.calls.filter((c) => !c.finished_at).map((c) => c.call_id),
    );
    this.run!.incomplete = true;
    this.run!.resource_quarantined = true;
    this.quarantine({
      run_id: this.run!.suite_run_id,
      case_run_id: instance.case_run_id,
      reason,
      unsettled_call_ids: instance.unsettled_call_ids,
    });
  }
  private skip(
    instance: CaseRun,
    step: Step,
    phase: Phase,
    reason: string,
    applicable?: boolean,
  ): void {
    instance.steps.push({
      step_id: step.step_id,
      phase,
      description: step.description,
      required: step.required,
      status: "SKIPPED",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: 0,
      reason,
      calls: [],
      observations: [],
      ...(phase === "cleanup"
        ? { cleanup_applicable: applicable ?? true }
        : {}),
    });
  }
  private async step(
    instance: CaseRun,
    step: Step,
    phase: Phase,
  ): Promise<StepResult> {
    const started = performance.now();
    const result: StepResult = {
      step_id: step.step_id,
      phase,
      description: step.description,
      required: step.required,
      status: "RUNNING",
      started_at: new Date().toISOString(),
      duration_ms: 0,
      calls: [],
      observations: [],
      ...(phase === "cleanup" ? { cleanup_applicable: true } : {}),
    };
    const binding: Binding = {
      suite_run_id: this.run!.suite_run_id,
      case_run_id: instance.case_run_id,
      phase,
      step_id: step.step_id,
      attempt_id: "1",
    };
    instance.steps.push(result);
    this.recorder!.event("step_started", { step }, binding);
    this.recorder!.snapshot(this.run!);
    try {
      if (!(await this.invoke("before_step", instance, step, result))) {
        result.status = step.kind === "assertion" ? "SKIPPED" : "BLOCKED";
        result.reason = "before_step拒绝";
        if (step.required) instance.blocked = true;
        return result;
      }
      if (
        step.depends_on.some(
          (id) =>
            !instance.steps.some(
              (s) =>
                s.step_id === id && ["SUCCEEDED", "PASS"].includes(s.status),
            ),
        )
      ) {
        result.status = "BLOCKED";
        result.reason = "依赖未满足";
        if (step.required) instance.blocked = true;
        return result;
      }
      if (step.assertion) {
        result.assertion = evaluate(step, instance);
        result.status = result.assertion.status;
        if (phase === "setup" && result.status === "FAIL") {
          instance.blocked = true;
          result.status = "BLOCKED";
        }
        this.recorder!.event("assertion_evaluated", result.assertion, binding);
        await this.invoke("after_assertion", instance, step, result);
      } else {
        const active: ActiveStep = {
          binding,
          result,
          allowedTargets: step.action!.allowed_targets,
          approval: step.action!.approval ?? false,
          closed: false,
          finish: false,
          blocked: false,
          captureDone: false,
          complete: () =>
            step.action!.completion_requirements.every((name) =>
              result.observations.some((o) => o.output_name === name),
            ),
          capture: (exec) =>
            captureStep(
              this.driver as HarnessSession,
              this.recorder!,
              this.run!,
              step,
              result,
              binding,
              exec,
            ),
        };
        const inputs = Object.fromEntries(
          Object.entries(step.action!.inputs).map(([key, v]) => [
            key,
            v &&
            typeof v === "object" &&
            !Array.isArray(v) &&
            typeof v.input_ref === "string"
              ? field({ data: instance.data }, v.input_ref)
              : v &&
                  typeof v === "object" &&
                  !Array.isArray(v) &&
                  typeof v.resource_ref === "string"
                ? instance.resources[v.resource_ref]
                : v &&
                    typeof v === "object" &&
                    !Array.isArray(v) &&
                    Object.hasOwn(v, "literal")
                  ? v.literal
                  : v,
          ]),
        );
        await this.driver!.run(
          active,
          step.action!.goal + "\n绑定输入：" + JSON.stringify(inputs),
        );
        result.status = active.blocked
          ? "BLOCKED"
          : this.stopping && phase !== "cleanup"
            ? "CANCELLED"
            : active.finish
              ? "SUCCEEDED"
              : "ERROR";
        if (active.blocked && step.required) instance.blocked = true;
      }
    } catch (error) {
      result.status =
        this.stopping && phase !== "cleanup" ? "CANCELLED" : "ERROR";
      result.reason = String(error);
      if (step.action) {
        this.driver!.cancel();
        if (!(await this.driver!.drain()))
          this.isolate(instance, "步骤取消后未能结算");
        else if (!this.stopping) this.driver!.resume?.();
      }
      if (this.recorder!.failed) instance.integrity_error = true;
    } finally {
      result.finished_at = new Date().toISOString();
      result.duration_ms = Math.round(performance.now() - started);
      if (
        !step.required &&
        !["SUCCEEDED", "PASS", "SKIPPED"].includes(result.status)
      )
        instance.issues.push(
          "可选步骤警示: " + step.step_id + " " + result.status,
        );
      if (result.observations.length)
        await this.invoke("after_observation", instance, step, result);
      this.recorder!.event("step_finished", result, binding);
      this.recorder!.snapshot(this.run!);
    }
    return result;
  }
}
