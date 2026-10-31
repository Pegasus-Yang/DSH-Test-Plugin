/** 将原规划、实际操作和运行依据组织为同一条执行过程。 */
import type {
  CaseRun,
  Phase,
  Step,
  StepResult,
  SuiteRun,
} from "./contracts.js";
import type { ActualCase, ActualRow } from "./actual-operations.js";
import { inputText, operationLabels } from "./actual-operations.js";
import { badge, duration, escape, icon, json } from "./report-format.js";

export interface ExecutionGroup {
  id: string;
  description: string;
  phase: Phase;
  planned?: Step;
  steps: StepResult[];
  rows: ActualRow[];
  system: boolean;
  status: string;
  needs_review: boolean;
}

const attention = new Set([
  "ERROR",
  "FAIL",
  "UNKNOWN",
  "INCONCLUSIVE",
  "BLOCKED",
  "CANCELLED",
  "NOT_DISPATCHED",
  "REGISTERED",
  "DISPATCHED",
]);

/**
 * 只按规划标识及冻结规则来源归组，不根据标题或任意 ID 后缀猜测。
 *
 * :param run: 已保存的整批运行。
 * :param instance: 当前用例实例。
 * :param actual: 该实例已投影的实际记录。
 * :returns: 包含未执行规划及无法归属记录的完整分组。
 */
export function executionGroups(
  run: SuiteRun,
  instance: CaseRun,
  actual: ActualCase,
): ExecutionGroup[] {
  const groups: ExecutionGroup[] = [];
  const owners = new Map<string, ExecutionGroup>();
  const checkOwners = new Map<string, ExecutionGroup>();
  const create = (
    id: string,
    description: string,
    phase: Phase,
    planned?: Step,
  ) => {
    const group: ExecutionGroup = {
      id,
      description,
      phase,
      planned,
      steps: [],
      rows: [],
      system: [
        "__reset",
        "__close",
        "__resource_open",
        "__resource_close",
      ].includes(id),
      status: "PENDING",
      needs_review: false,
    };
    groups.push(group);
    owners.set(`${phase}:${id}`, group);
    return group;
  };
  const definition = run.plan.cases.find((c) => c.case_id === instance.case_id);
  for (const [phase, steps] of [
    ["setup", definition?.preconditions ?? []],
    ["test", definition?.steps ?? []],
    ["cleanup", definition?.cleanup ?? []],
  ] as const)
    for (const step of steps) {
      const group = create(step.step_id, step.description, phase, step);
      if (step.kind === "intent")
        for (const [n] of (step.checks ?? []).entries()) {
          const rule = `${step.step_id}_check_${n + 1}`;
          if (run.plan.source_refs.some((source) => source.id === rule))
            checkOwners.set(rule, group);
        }
    }
  const recordedOwners = new Map<string, ExecutionGroup>();
  for (const step of instance.steps) {
    const spec = instance.effective_steps.find(
      (s) => s.step_id === step.step_id,
    );
    const key = `${step.phase}:${step.step_id}`;
    const ruleOwner = spec?.assertion?.rule_ref
      ? checkOwners.get(spec.assertion.rule_ref)
      : undefined;
    const group =
      owners.get(key) ??
      (ruleOwner?.phase === step.phase ? ruleOwner : undefined) ??
      create(step.step_id, step.description, step.phase);
    group.steps.push(step);
    recordedOwners.set(key, group);
  }
  for (const row of [
    ...actual.preconditions.recorded,
    ...actual.steps,
    ...actual.cleanup.recorded,
    ...actual.not_dispatched,
  ]) {
    const key = `${row.phase}:${row.source_step_id}`;
    const group =
      recordedOwners.get(key) ??
      owners.get(key) ??
      create(row.source_step_id, row.source_description, row.phase);
    group.rows.push(row);
  }
  for (const group of groups) {
    const states = group.steps.map(
      (step) => step.assertion?.status ?? step.status,
    );
    const failed = (
      [
        "ERROR",
        "FAIL",
        "INCONCLUSIVE",
        "BLOCKED",
        "CANCELLED",
        "SKIPPED",
        "RUNNING",
      ] as const
    ).find((state) => states.includes(state));
    const missingChecks =
      group.planned?.kind === "intent" &&
      (group.planned.checks?.length ?? 0) >
        group.steps.filter((s) => s.assertion).length;
    group.status =
      failed ??
      (states.length && !missingChecks
        ? states.includes("PASS")
          ? "PASS"
          : "SUCCEEDED"
        : "PENDING");
    group.needs_review =
      attention.has(group.status) ||
      group.rows.some(
        (row) =>
          attention.has(row.state) ||
          (row.operation && row.operation.granularity !== "atomic"),
      );
  }
  return groups;
}

interface ProcessContext {
  run: SuiteRun;
  instance: CaseRun;
  actual: ActualCase;
  index: number;
  compare: (step: StepResult, caseIndex: number) => string;
  callDetails: (id: string, value: unknown) => string;
}

export function executionProcess(context: ProcessContext): string {
  const { run, instance, actual, index, compare, callDetails } = context;
  const groups = executionGroups(run, instance, actual);
  const business = groups.filter(
    (group) => group.phase === "test" && !group.system,
  );
  const firstProblem = groups.find((group) => group.needs_review);
  const initial = firstProblem ?? business[0] ?? groups[0];
  const runtimeStep = (step: StepResult) =>
    `<details class="step" data-step-id="${escape(step.step_id)}"><summary><span class="step-copy"><strong>${escape(step.description)}</strong><small>${escape(step.step_id)} · ${step.required ? "必需" : "可选"}</small></span><span class="duration">${duration(step.duration_ms)}</span>${badge(step.status)}${icon("chevron-down", "chevron")}</summary><div class="step-content">${step.reason ? `<p class="reason">${escape(step.reason)}</p>` : ""}${step.assertion ? compare(step, index) : ""}${step.observations.map((o) => `<div class="observation-line">${escape(o.output_name)} = <code>${escape(JSON.stringify(o.value))}</code>${o.evidence_refs[0] ? ` <button class="evidence-button" data-evidence="evidence-${index}-${escape(o.evidence_refs[0])}">查看证据</button>` : ""}</div>`).join("")}${step.observations.some((o) => o.producer.adapter === "tool-result-v1") ? `<details class="inspect"><summary>工具结果采集依据</summary><pre>${json(step.observations.map((o) => ({ name: o.output_name, producer: o.producer, context_id: o.context_id })))}</pre></details>` : ""}${step.capture_attempts?.length ? `<details class="inspect"><summary>采集方式与调整记录 · ${step.capture_attempts.length} 次</summary><pre>${json(step.capture_attempts)}</pre></details>` : ""}${step.calls.length ? `<details class="inspect"><summary>${step.calls.length} 次工具调用 · 展开执行记录</summary>${step.calls.map((call) => `<div class="call"><strong>${escape(call.name)}</strong><small>${call.finished_at ? (call.isError ? "错误" : "已结算") : "未结算"}</small><pre>${json(call.args_redacted)}</pre>${callDetails(`${instance.case_run_id}:${call.call_id}`, call)}</div>`).join("")}</details>` : ""}</div></details>`;
  const actualRow = (row: ActualRow, position: string) => {
    const step = instance.steps.find(
      (s) => s.step_id === row.source_step_id && s.phase === row.phase,
    );
    const call = actual.call_records.find(
      (c) => c.call_id === row.tool_call_id,
    );
    if (row.kind === "check")
      return `<section class="actual-row actual-check" data-actual-id="${escape(row.id)}"><div class="actual-heading"><span class="row-kind">检查</span><h4>${escape(row.description)}</h4>${badge(row.state, row.state === "ERROR" ? "检查执行异常" : (operationLabels[row.state] ?? row.state))}</div>${step?.assertion ? compare(step, index) : ""}</section>`;
    const inputs = Object.fromEntries(
      Object.entries(row.inputs).filter(
        ([key, value]) =>
          [
            "element",
            "text",
            "value",
            "url",
            "key",
            "values",
            "fields",
            "paths",
            "promptText",
          ].includes(key) &&
          !(typeof value === "string" && row.description.includes(value)) &&
          !(
            Array.isArray(value) &&
            value.length > 0 &&
            value.every(
              (item) =>
                typeof item === "string" && row.description.includes(item),
            )
          ),
      ),
    );
    return `<section class="actual-row actual-operation" data-actual-id="${escape(row.id)}"><div class="actual-heading"><span class="row-kind">${position}</span><h4>${escape(row.description)}</h4>${badge(row.state, row.state === "SUCCEEDED" ? "操作完成" : row.state === "ERROR" ? "操作执行异常" : (operationLabels[row.state] ?? row.state))}</div>${Object.keys(inputs).length ? `<p class="human-input">${escape(inputText({ ...row, inputs }))}</p>` : ""}${row.operation?.reason ? `<p class="reason">${escape(row.operation.reason)}</p>` : ""}${row.operation?.granularity === "unknown" ? '<p class="reason">自定义工具的内部操作粒度未确认。</p>' : row.operation?.granularity === "composite" ? '<p class="reason">复合操作，内部动作需复核。</p>' : ""}${row.evidence_refs[0] ? `<button class="evidence-button" data-evidence="evidence-${index}-${escape(row.evidence_refs[0])}">查看证据</button>` : ""}<details class="inspect operation-details"><summary>操作依据</summary><p>来源：${escape(row.source_step_id)} · ${escape(row.source_description)}</p><pre>${json(row.inputs)}</pre>${call ? callDetails(`${instance.case_run_id}:${call.call_id}`, call) : ""}</details></section>`;
  };
  const renderGroup = (group: ExecutionGroup, number?: number) => {
    const checks = group.rows.filter((row) => row.kind === "check").length;
    const operations = group.rows.filter(
      (row) => row.kind === "operation",
    ).length;
    const hasRows = group.rows.length > 0;
    let operation = 0;
    const rows = group.rows
      .map((row) =>
        actualRow(
          row,
          row.state === "NOT_DISPATCHED"
            ? "—"
            : `${number ? number + "." : ""}${row.kind === "operation" ? ++operation : ""}`,
        ),
      )
      .join("");
    return `<details class="process-group${group.needs_review ? " has-issue" : ""}" id="process-${index}-${escape(group.phase)}-${escape(group.id)}" data-process-group${group.needs_review ? " data-process-issue" : ""}${group === initial ? " open" : ""}><summary>${number ? `<span class="number">${number}</span>` : ""}<span class="group-copy"><strong>${escape(group.description)}</strong><small>${hasRows ? `${operations} 个动作 · ${checks} 个已执行检查` : `${group.steps.length} 条运行记录`}${group.needs_review && !attention.has(group.status) ? " · 含需复核操作" : ""}</small></span><span class="duration">${duration(group.steps.reduce((total, s) => total + s.duration_ms, 0))}</span>${badge(group.status)}${icon("chevron-down", "chevron")}</summary><div class="group-body">${hasRows ? rows : group.steps.length ? group.steps.map(runtimeStep).join("") : '<p class="muted">该规划尚无执行记录，不能据此判定通过。</p>'}${group.planned?.checks?.length ? `<details class="inspect"><summary>规划与检查点</summary><ul>${group.planned.checks.map((check) => `<li>${escape(check)}</li>`).join("")}</ul></details>` : ""}${hasRows && group.steps.length ? `<details class="inspect runtime-details"><summary>运行依据 · ${group.steps.length} 条步骤记录</summary>${group.steps.map(runtimeStep).join("")}</details>` : ""}</div></details>`;
  };
  const phase = (name: string, items: ExecutionGroup[]) =>
    items.length
      ? `<details class="process-phase"${items.includes(firstProblem!) ? " open" : ""}><summary>${name} · ${items.length} 组</summary>${items.map((group) => renderGroup(group)).join("")}</details>`
      : "";
  return `<div class="process-toolbar"><span>${business.length} 个业务步骤</span><div><button class="text-button" data-process-expand="true">展开全部</button><button class="text-button" data-process-expand="false">收起全部</button></div></div>${actual.completeness === "NOT_RECORDED" ? '<p class="record-note">该历史运行未记录实际动作，以下保留已保存的规划和运行依据。</p>' : ""}${actual.completeness_reasons.length ? `<details class="inspect record-note"><summary>记录需复核 · ${actual.completeness_reasons.length} 项</summary><ul>${actual.completeness_reasons.map((reason) => `<li>${escape(reason)}</li>`).join("")}</ul></details>` : ""}${phase(
    "前置操作",
    groups.filter((group) => group.phase === "setup" && !group.system),
  )}<div class="process-list">${business.map((group, n) => renderGroup(group, n + 1)).join("") || '<p class="empty">尚无业务步骤记录。</p>'}</div>${phase(
    "业务收尾",
    groups.filter((group) => group.phase === "cleanup" && !group.system),
  )}${phase(
    "系统清理",
    groups.filter((group) => group.system),
  )}`;
}
