/** 已保存操作与检查的纯投影；不请求模型，也不补造未执行步骤。 */
import type {
  ActualOperation,
  AssertionResult,
  CaseRun,
  Json,
  Phase,
  StepResult,
  SuiteRun,
} from "./contracts.js";

export const operationSchemaVersion = "1";
const prefix = "mcp__playwright__";
const interactions = new Set([
  "browser_navigate",
  "browser_navigate_back",
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_select_option",
  "browser_hover",
  "browser_drag",
  "browser_fill_form",
  "browser_wait_for",
  "browser_handle_dialog",
  "browser_file_upload",
  "browser_resize",
  "browser_close",
  "browser_evaluate",
  "browser_run_code",
]);
/** 模型在同一份支持名单中选择完整名称，避免省略MCP前缀反复失败。 */
export const operationToolNames = [...interactions, "browser_tabs"].map(
  (name) => prefix + name,
);

export function operationTool(name: string, args: unknown = {}): boolean {
  if (!name.startsWith(prefix)) return false;
  const tool = name.slice(prefix.length);
  if (tool === "browser_tabs")
    return (args as { action?: string })?.action !== "list";
  return interactions.has(tool);
}

export function compositeOperation(name: string, args: unknown): boolean {
  return (
    [
      prefix + "browser_evaluate",
      prefix + "browser_run_code",
      prefix + "browser_fill_form",
    ].includes(name) ||
    (name === prefix + "browser_type" &&
      (args as { submit?: boolean })?.submit === true)
  );
}

export function sealOperations(run: SuiteRun, reason: string): void {
  for (const step of run.instances.flatMap((i) => i.steps))
    for (const op of step.actual_operations ?? [])
      if (["REGISTERED", "DISPATCHED"].includes(op.state)) {
        op.state = "UNKNOWN";
        op.finished_at = new Date().toISOString();
        op.reason = reason;
      }
}

export interface ActualRow {
  id: string;
  number?: number;
  kind: "operation" | "check";
  phase: Phase;
  source_step_id: string;
  source_description: string;
  description: string;
  state: string;
  inputs: Record<string, Json>;
  expected:
    | string
    | { description: string; operator: string; value: Json; rule_ref: string };
  operation?: ActualOperation;
  assertion?: AssertionResult;
  tool_call_id?: string;
  evidence_refs: string[];
}
export interface ActualCase {
  case_run_id: string;
  case_id: string;
  data_id: string;
  name: string;
  original_task: string;
  parameters: Json;
  frozen_data: Json;
  status: string;
  completeness: "COMPLETE" | "PARTIAL" | "NOT_RECORDED";
  completeness_reasons: string[];
  needs_review: boolean;
  planned_steps: { step_id: string; description: string; checks?: string[] }[];
  preconditions: { definitions: string[]; recorded: ActualRow[] };
  steps: ActualRow[];
  cleanup: { definitions: string[]; recorded: ActualRow[] };
  not_dispatched: ActualRow[];
  call_records: {
    call_id: string;
    name: string;
    args_redacted: Json;
    body_started: "unknown" | boolean;
  }[];
}

const pendingExpected = "待补充，原任务未定义独立检查";
/** 手工执行使用真实输入；短期定位引用与任意脚本仅保留在调用依据中。 */
export function operationInputs(
  step: StepResult,
  op: ActualOperation,
): Record<string, Json> {
  const call = step.calls.find((c) => c.call_id === op.tool_call_id);
  return operationArguments(call?.args_redacted);
}

/** 只保留人可以使用的输入，不将短期定位或执行脚本写入手工用例。 */
export function operationArguments(value: unknown): Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const withoutLocators = (value: Json): Json =>
    Array.isArray(value)
      ? value.map(withoutLocators)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(
                ([key]) =>
                  !["ref", "startRef", "endRef", "function", "code"].includes(
                    key,
                  ),
              )
              .map(([key, v]) => [key, withoutLocators(v)]),
          )
        : value;
  return withoutLocators(value as Json) as Record<string, Json>;
}

export function projectActualCase(
  run: SuiteRun,
  instance: CaseRun,
): ActualCase {
  const definition = run.plan.cases.find((c) => c.case_id === instance.case_id);
  const source = run.plan.planning?.input?.instances.find(
    (i) => i.id === instance.case_id,
  );
  const recorded =
    run.manifest.actual_operations_schema === operationSchemaVersion ||
    instance.steps.some((s) => s.actual_operations?.length);
  const steps: ActualRow[] = [],
    setup: ActualRow[] = [],
    cleanup: ActualRow[] = [],
    rejected: ActualRow[] = [];
  const reasons = new Set<string>();
  let needsReview = false;
  for (const step of instance.steps) {
    if (["__reset", "__close"].includes(step.step_id)) continue;
    for (const note of step.actual_operation_notes ?? []) reasons.add(note);
    const rows: ActualRow[] = [];
    for (const op of step.actual_operations ?? []) {
      if (
        op.binding.suite_run_id !== run.suite_run_id ||
        op.binding.case_run_id !== instance.case_run_id ||
        op.binding.step_id !== step.step_id ||
        op.binding.phase !== step.phase
      ) {
        reasons.add("操作归属与当前实例不一致，未纳入步骤");
        continue;
      }
      const row: ActualRow = {
        id: op.operation_id,
        kind: "operation",
        phase: step.phase,
        source_step_id: step.step_id,
        source_description: step.description,
        description: op.description,
        state: op.state,
        inputs: operationInputs(step, op),
        expected: pendingExpected,
        operation: op,
        tool_call_id: op.tool_call_id,
        // 仅关联同一调用直接生产的证据，不把本步最后截图冒充操作截图。
        evidence_refs: [
          ...new Set(
            step.observations
              .filter((o) => o.producer.call_id === op.tool_call_id)
              .flatMap((o) => o.evidence_refs),
          ),
        ],
      };
      if (!op.dispatch_observed || op.state === "NOT_DISPATCHED")
        rejected.push(row);
      else rows.push(row);
      if (["REGISTERED", "DISPATCHED", "UNKNOWN"].includes(op.state))
        reasons.add("存在未获确认的操作结果");
      if (op.granularity === "composite")
        reasons.add("包含复合操作，内部每个动作尚未逐项确认");
      if (op.state !== "SUCCEEDED") needsReview = true;
    }
    if (recorded && step.assertion) {
      const spec = instance.effective_steps.find(
        (s) => s.step_id === step.step_id,
      )?.assertion;
      rows.push({
        id: step.assertion.assertion_id,
        kind: "check",
        phase: step.phase,
        source_step_id: step.step_id,
        source_description: step.description,
        description: step.description,
        state: step.assertion.status,
        inputs: {},
        expected: {
          description: step.description,
          operator: step.assertion.operator,
          value: step.assertion.expected,
          rule_ref: spec?.rule_ref ?? "",
        },
        assertion: step.assertion,
        evidence_refs: step.assertion.evidence_refs,
      });
      if (step.assertion.status !== "PASS") needsReview = true;
    }
    (step.phase === "test"
      ? steps
      : step.phase === "setup"
        ? setup
        : cleanup
    ).push(...rows);
    if (
      recorded &&
      step.phase === "test" &&
      ["CANCELLED", "BLOCKED", "SKIPPED", "RUNNING"].includes(step.status)
    )
      reasons.add("部分规划步骤未执行或未结算，仅导出已保存事实");
  }
  steps.forEach((row, n) => {
    row.number = n + 1;
  });
  if (recorded && (instance.incomplete || instance.resource_quarantined))
    reasons.add("本次运行记录不完整或环境未确认释放");
  if (recorded && !steps.length)
    reasons.add("没有已派发的业务操作或已执行检查");
  return {
    case_run_id: instance.case_run_id,
    case_id: instance.case_id,
    data_id: instance.data_id,
    name: instance.name,
    original_task:
      source?.task ?? run.plan.planning?.original_task ?? run.plan.name,
    parameters: source?.parameters ?? instance.data.inputs,
    frozen_data: instance.data as unknown as Json,
    status: instance.status,
    completeness: !recorded
      ? "NOT_RECORDED"
      : reasons.size
        ? "PARTIAL"
        : "COMPLETE",
    completeness_reasons: !recorded
      ? ["此运行未记录实际操作说明，不根据旧调用事后补写"]
      : [...reasons],
    needs_review: needsReview || reasons.size > 0 || !recorded,
    planned_steps: (definition?.steps ?? []).map((s) => ({
      step_id: s.step_id,
      description: s.description,
      ...(s.checks ? { checks: s.checks } : {}),
    })),
    preconditions: {
      definitions: definition?.preconditions.map((s) => s.description) ?? [],
      recorded: setup,
    },
    steps,
    cleanup: {
      definitions: definition?.cleanup.map((s) => s.description) ?? [],
      recorded: cleanup,
    },
    not_dispatched: rejected,
    call_records: instance.steps.flatMap((s) =>
      s.calls
        .filter((c) =>
          s.actual_operations?.some((o) => o.tool_call_id === c.call_id),
        )
        .map((c) => ({
          call_id: c.call_id,
          name: c.name,
          args_redacted: c.args_redacted,
          body_started: c.body_started,
        })),
    ),
  };
}

export const operationLabels: Record<string, string> = {
  REGISTERED: "已登记，尚未派发",
  DISPATCHED: "派发中，结果待确认",
  SUCCEEDED: "工具执行成功",
  ERROR: "工具执行异常，结果需复核",
  NOT_DISPATCHED: "未执行",
  UNKNOWN: "结果未知，需复核",
  PASS: "检查通过",
  FAIL: "检查失败",
  BLOCKED: "检查阻塞",
  INCONCLUSIVE: "检查结论不足",
  CANCELLED: "已取消",
};
export function inputText(row: ActualRow): string {
  const labels: Record<string, string> = {
    element: "控件",
    text: "输入内容",
    url: "地址",
    key: "按键",
    values: "选项",
    fields: "字段",
    action: "操作",
    index: "位置",
    time: "等待秒数",
    paths: "文件",
    button: "鼠标键",
    startElement: "起点",
    endElement: "终点",
    accept: "接受对话框",
    promptText: "对话框输入",
  };
  return (
    Object.entries(row.inputs)
      .map(
        ([key, value]) =>
          `${labels[key] ?? key}：${typeof value === "string" ? value : JSON.stringify(value)}`,
      )
      .join("；") || "—"
  );
}
export function expectedText(row: ActualRow): string {
  return typeof row.expected === "string"
    ? row.expected
    : `${row.expected.description}；${row.expected.operator} ${JSON.stringify(row.expected.value)}`;
}
