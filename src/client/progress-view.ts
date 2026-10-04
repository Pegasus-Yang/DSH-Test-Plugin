/** 只读步骤展示规则；准备、清理和业务步骤保持各自身份。 */
import type {
  ProgressCase,
  ProgressSnapshot,
  ProgressStep,
} from "../progress-model.js";

export const phaseLabels = {
  planning: "正在规划",
  reviewing: "等待计划审核",
  executing: "执行中",
  stopping: "正在停止",
  cleanup: "正在清理",
  finished: "已结束",
  interrupted: "已中断",
};
export const statusLabels: Record<string, string> = {
  PENDING: "待执行",
  RUNNING: "运行中",
  SUCCEEDED: "已完成",
  PASS: "通过",
  FAIL: "失败",
  ERROR: "错误",
  BLOCKED: "阻塞",
  SKIPPED: "跳过",
  CANCELLED: "取消",
  INCONCLUSIVE: "结论不足",
};
export function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}
export function elapsed(step: ProgressStep, now: number): number {
  return step.started_at && !step.finished_at && step.status === "RUNNING"
    ? Math.max(0, now - Date.parse(step.started_at))
    : step.duration_ms;
}
export function tone(status: string): string {
  return status === "RUNNING"
    ? "running"
    : ["PASS", "SUCCEEDED"].includes(status)
      ? "pass"
      : ["FAIL", "ERROR", "INCONCLUSIVE", "BLOCKED"].includes(status)
        ? "error"
        : "muted";
}
export function selectedInstance(
  snapshot: ProgressSnapshot,
): ProgressCase | undefined {
  return (
    snapshot.instances.find(
      (instance) => instance.id === snapshot.current_instance_id,
    ) ??
    snapshot.instances.find((instance) => instance.status === "RUNNING") ??
    snapshot.instances[0]
  );
}
export interface StepRow {
  key: string;
  number: number;
  instance: ProgressCase;
  step: ProgressStep;
}
export function stepRows(snapshot: ProgressSnapshot): StepRow[] {
  let number = 0;
  return snapshot.instances.flatMap((instance) =>
    instance.steps.map((step) => ({
      key: `${instance.id}/${step.id}`,
      number: ++number,
      instance,
      step,
    })),
  );
}
export function progressTone(
  snapshot: ProgressSnapshot,
  failed = false,
): string {
  if (failed || snapshot.phase === "interrupted") return "error";
  if (snapshot.instances.some((instance) => tone(instance.status) === "error"))
    return "error";
  return snapshot.phase === "finished"
    ? snapshot.instances.length > 0 &&
      snapshot.instances.every((instance) =>
        ["PASS", "SUCCEEDED"].includes(instance.status),
      )
      ? "pass"
      : "muted"
    : "running";
}
export interface FocusStep {
  label: string;
  description: string;
  row?: StepRow;
  step?: ProgressStep;
  next?: ProgressStep;
}
export function focusStep(
  snapshot: ProgressSnapshot,
  rows = stepRows(snapshot),
): FocusStep {
  const instance = selectedInstance(snapshot);
  if (snapshot.phase === "planning")
    return { label: "正在规划", description: "正在分析任务并拆分测试步骤" };
  if (snapshot.phase === "reviewing")
    return {
      label: "等待审核",
      description: "请在原生审核中确认计划，批准后开始执行",
    };
  if (snapshot.phase === "cleanup") {
    const step =
      instance?.cleanup.find((step) => step.id === snapshot.current_step_id) ??
      instance?.cleanup.find((step) => step.status === "RUNNING");
    return {
      label: "资源清理",
      description: step?.description ?? "正在释放本轮测试资源",
      step,
    };
  }
  if (snapshot.phase === "finished" || snapshot.phase === "interrupted") {
    const problem = rows.find((row) => tone(row.step.status) === "error");
    const cleanupProblem = snapshot.instances
      .flatMap((instance) => instance.cleanup)
      .find((step) => tone(step.status) === "error");
    const setupProblem = snapshot.instances
      .flatMap((instance) => instance.setup)
      .find((step) => tone(step.status) === "error");
    const externalProblem = cleanupProblem ?? setupProblem;
    if (externalProblem)
      return {
        label: cleanupProblem ? "清理异常" : "准备异常",
        description: externalProblem.description,
        step: externalProblem,
      };
    if (problem)
      return {
        label: "异常步骤",
        description: problem.step.description,
        row: problem,
        step: problem.step,
      };
    if (snapshot.phase === "interrupted")
      return {
        label: "已中断",
        description: "本轮执行已中断，请查看步骤和运行记录",
      };
    return {
      label: "本轮已结束",
      description: "查看完整步骤与运行记录，了解本轮执行结果",
    };
  }
  const preparing = instance?.setup.find(
    (step) => step.id === snapshot.current_step_id,
  );
  if (preparing)
    return {
      label: "环境准备",
      description: preparing.description,
      step: preparing,
    };
  const row =
    rows.find(
      (row) =>
        row.instance.id === instance?.id &&
        row.step.id === snapshot.current_step_id,
    ) ??
    rows.find(
      (row) =>
        row.instance.id === instance?.id && row.step.status === "RUNNING",
    );
  if (!row)
    return {
      label: snapshot.phase === "stopping" ? "正在停止" : "等待下一步",
      description:
        snapshot.phase === "stopping"
          ? "正在等待在途操作结算"
          : "正在准备下一项测试操作",
    };
  const localIndex = row.instance.steps.indexOf(row.step);
  return {
    label: snapshot.phase === "stopping" ? "正在停止" : "当前步骤",
    description: row.step.description,
    row,
    step: row.step,
    next: row.instance.steps[localIndex + 1],
  };
}
