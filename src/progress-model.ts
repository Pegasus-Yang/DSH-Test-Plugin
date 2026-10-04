/** 从已校验计划和运行事实生成只读展示数据；不参与执行和断言。 */
import type {
  CaseRun,
  Step,
  StepResult,
  SuiteRun,
  TestCase,
  TestSuite,
} from "./contracts.js";

export type ProgressPhase =
  | "planning"
  | "reviewing"
  | "executing"
  | "stopping"
  | "cleanup"
  | "finished"
  | "interrupted";
export interface ProgressCheck {
  text: string;
  status: string;
  reason?: string;
}
export interface ProgressStep {
  id: string;
  description: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  duration_ms: number;
  reason?: string;
  checks: ProgressCheck[];
}
export interface ProgressCase {
  id: string;
  name: string;
  data_id: string;
  status: string;
  steps: ProgressStep[];
  setup: ProgressStep[];
  cleanup: ProgressStep[];
}
export interface PreviewState {
  ready: boolean;
  reason?: string;
  frame_id?: string;
  captured_at?: string;
  src?: string;
}
export interface ProgressSnapshot {
  session_id: string;
  run_id: string;
  title: string;
  rationale?: string;
  phase: ProgressPhase;
  created_at: string;
  finished_at?: string;
  server_now: string;
  current_instance_id?: string;
  current_step_id?: string;
  instances: ProgressCase[];
  total_steps: number;
  settled_steps: number;
  report_url?: string;
  preview: PreviewState;
}

function stepView(
  step: Step,
  result: StepResult | undefined,
  instance: CaseRun | undefined,
): ProgressStep {
  const checks = (step.checks ?? []).map((text, index) => {
    const checked = instance?.steps.find(
      (entry) => entry.step_id === `${step.step_id}_check_${index + 1}`,
    );
    return {
      text,
      status: checked?.assertion?.status ?? checked?.status ?? "PENDING",
      ...(checked?.assertion?.reason
        ? { reason: checked.assertion.reason }
        : {}),
    };
  });
  const failed = checks.find((check) =>
    ["FAIL", "ERROR", "INCONCLUSIVE", "BLOCKED"].includes(check.status),
  );
  return {
    id: step.step_id,
    description: step.description,
    status: failed?.status ?? result?.status ?? "PENDING",
    duration_ms: result?.duration_ms ?? 0,
    ...(result?.started_at ? { started_at: result.started_at } : {}),
    ...(result?.finished_at ? { finished_at: result.finished_at } : {}),
    ...(result?.reason ? { reason: result.reason } : {}),
    checks,
  };
}
function instanceView(
  spec: TestCase,
  instance: CaseRun | undefined,
  dataId: string,
): ProgressCase {
  const steps = instance?.effective_steps ?? [
    ...spec.preconditions,
    ...spec.steps,
    ...spec.cleanup,
  ];
  const declaredChecks = new Set(
    steps.flatMap((step) =>
      (step.checks ?? []).map(
        (_, index) => `${step.step_id}_check_${index + 1}`,
      ),
    ),
  );
  const setupIds = new Set(spec.preconditions.map((step) => step.step_id));
  const cleanupIds = new Set(spec.cleanup.map((step) => step.step_id));
  const view: ProgressCase = {
    id: instance?.case_run_id ?? `draft_${spec.case_id}_${dataId}`,
    name: instance?.name ?? spec.name,
    data_id: dataId,
    status: instance?.status ?? "PENDING",
    steps: [],
    setup: [],
    cleanup: [],
  };
  const seen = new Set<string>();
  for (const step of steps) {
    if (declaredChecks.has(step.step_id)) continue;
    const result = instance?.steps.find(
      (entry) => entry.step_id === step.step_id,
    );
    const phase =
      result?.phase ??
      (setupIds.has(step.step_id)
        ? "setup"
        : cleanupIds.has(step.step_id)
          ? "cleanup"
          : "test");
    (phase === "test" ? view.steps : view[phase]).push(
      stepView(step, result, instance),
    );
    seen.add(step.step_id);
  }
  // 自动初始化和关闭上下文不在原始业务计划中，按其真实阶段补充。
  for (const result of instance?.steps ?? []) {
    if (
      seen.has(result.step_id) ||
      declaredChecks.has(result.step_id) ||
      result.phase === "test"
    )
      continue;
    view[result.phase].push({
      id: result.step_id,
      description: result.description,
      status: result.status,
      started_at: result.started_at,
      finished_at: result.finished_at,
      duration_ms: result.duration_ms,
      reason: result.reason,
      checks: [],
    });
  }
  return view;
}

export function projectProgress(input: {
  run: SuiteRun;
  plan?: TestSuite;
  phase: ProgressPhase;
  current?: { case_run_id: string; step_id: string };
  now?: number;
  reportUrl?: string;
}): ProgressSnapshot {
  const { run } = input;
  const plan = input.plan ?? run.plan;
  const instances = run.instances.length
    ? run.instances.map((instance) =>
        instanceView(
          plan.cases.find((entry) => entry.case_id === instance.case_id) ?? {
            case_id: instance.case_id,
            name: instance.name,
            preconditions: [],
            steps: [],
            cleanup: [],
            datasets: [],
          },
          instance,
          instance.data_id,
        ),
      )
    : plan.cases.flatMap((spec) =>
        spec.datasets.map((data) =>
          instanceView(spec, undefined, data.data_id),
        ),
      );
  const business = instances.flatMap((instance) => instance.steps);
  return {
    session_id: String(run.manifest.origin_session_id ?? ""),
    run_id: run.suite_run_id,
    title: plan.name,
    ...(plan.planning?.rationale ? { rationale: plan.planning.rationale } : {}),
    phase:
      run.lifecycle === "FINISHED"
        ? "finished"
        : run.lifecycle === "INTERRUPTED"
          ? "interrupted"
          : input.phase,
    created_at: run.created_at,
    ...(run.finished_at ? { finished_at: run.finished_at } : {}),
    server_now: new Date(input.now ?? Date.now()).toISOString(),
    ...(input.current
      ? {
          current_instance_id: input.current.case_run_id,
          current_step_id: input.current.step_id,
        }
      : {}),
    instances,
    total_steps: business.length,
    settled_steps: business.filter(
      (step) => !["PENDING", "RUNNING"].includes(step.status),
    ).length,
    ...(run.lifecycle === "FINISHED" && input.reportUrl
      ? { report_url: input.reportUrl }
      : {}),
    preview: { ready: false },
  };
}
