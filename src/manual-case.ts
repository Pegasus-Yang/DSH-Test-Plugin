/** 从操作事实生成供后续执行的手工用例；执行记录另存 JSON。 */
import { join } from "node:path";
import type { SuiteRun, Json } from "./contracts.js";
import { atomicWrite } from "./recorder.js";
import {
  projectActualCase,
  type ActualRow,
  type ActualCase,
} from "./actual-operations.js";
import {
  manualCaseSource,
  readManualSource,
  type ManualSourceData,
  type ManualCaseSource,
} from "./manual-source.js";

export function actualStepsDocument(run: SuiteRun) {
  return {
    format: "dsh-actual-steps",
    schema_version: "1",
    suite_run_id: run.suite_run_id,
    name: run.name,
    created_at: run.created_at,
    ...(run.finished_at ? { finished_at: run.finished_at } : {}),
    cases: run.instances.map((i) => projectActualCase(run, i)),
  };
}

interface ManualStep {
  description: string;
  expected: string;
}
const valueText = (value: Json): string =>
  typeof value === "string"
    ? value === ""
      ? "空字符串"
      : `「${value.replace(/\r\n|\r|\n/g, "\\n")}」`
    : JSON.stringify(value);
const cell = (text: string) =>
  text.replace(/[\\|<>]/g, "\\$&").replace(/\r\n|\r|\n/g, " ");
const operators: Record<string, string> = {
  eq: "等于",
  neq: "不等于",
  contains: "包含",
  range: "满足范围",
  exists: "存在性为",
  text: "文本符合",
  visible: "可见性为",
};

function operationDescription(
  description: string,
  name: string,
  inputs: Record<string, Json>,
): string {
  const tool = name.replace(/^mcp__playwright__/, "");
  const element = typeof inputs.element === "string" ? inputs.element : "";
  if (tool === "browser_type" && typeof inputs.text === "string")
    return `在${element || "输入框"}中输入${valueText(inputs.text)}${inputs.submit ? "并提交" : ""}${inputs.text.includes("\n") ? "（\\n 表示换行）" : ""}`;
  if (tool === "browser_navigate" && typeof inputs.url === "string")
    return `访问 ${inputs.url}`;
  if (tool === "test_api_get" && typeof inputs.url === "string")
    return `发送 GET 请求到 ${inputs.url}`;
  if (tool === "browser_fill_form" && Array.isArray(inputs.fields))
    return (
      "填写表单：" +
      inputs.fields
        .map((f) => {
          const field = f as Record<string, Json>;
          return `${field.name ?? "字段"}输入${valueText(field.value ?? "")}`;
        })
        .join("；")
    );
  if (tool === "browser_click" && element)
    return `${inputs.button === "right" ? "右键点击" : "点击"}${element}${inputs.doubleClick ? "（双击）" : ""}${Array.isArray(inputs.modifiers) && inputs.modifiers.length ? "（按住 " + inputs.modifiers.join("+") + "）" : ""}`;
  if (tool === "browser_hover" && element) return `将鼠标移到${element}`;
  if (tool === "browser_drag" && inputs.startElement && inputs.endElement)
    return `从${inputs.startElement}拖动到${inputs.endElement}`;
  if (tool === "browser_wait_for") {
    const waits = [
      typeof inputs.time === "number" ? `等待 ${inputs.time} 秒` : "",
      typeof inputs.text === "string"
        ? `等待${valueText(inputs.text)}出现`
        : "",
      typeof inputs.textGone === "string"
        ? `等待${valueText(inputs.textGone)}消失`
        : "",
    ].filter(Boolean);
    if (waits.length) return waits.join("，");
  }
  if (
    tool === "browser_resize" &&
    typeof inputs.width === "number" &&
    typeof inputs.height === "number"
  )
    return `将浏览器窗口调整为 ${inputs.width} × ${inputs.height}`;
  if (tool === "browser_tabs") {
    if (inputs.action === "new") return "打开新的浏览器标签页";
    if (typeof inputs.index === "number")
      return `${inputs.action === "close" ? "关闭" : "切换到"}第 ${inputs.index + 1} 个浏览器标签页`;
  }
  if (
    tool === "browser_select_option" &&
    element &&
    Array.isArray(inputs.values)
  )
    return `在${element}中选择${inputs.values.map(valueText).join("、")}`;
  if (tool === "browser_press_key" && typeof inputs.key === "string")
    return `${description}，按 ${inputs.key}`;
  if (tool === "browser_file_upload" && Array.isArray(inputs.paths))
    return `${description}，选择文件 ${inputs.paths.map(valueText).join("、")}`;
  if (tool === "browser_handle_dialog")
    return `${inputs.accept ? "确认" : "取消"}页面对话框${typeof inputs.promptText === "string" ? "，输入" + valueText(inputs.promptText) : ""}`;
  return description;
}
function manualRows(
  rows: ActualRow[],
  source: ManualCaseSource,
  data?: ManualSourceData,
  calls: ActualCase["call_records"] = [],
): ManualStep[] {
  return rows
    .filter((r) => r.kind === "check" || r.state === "SUCCEEDED")
    .map((row) => {
      if (row.kind === "check") {
        const check =
          source.checks[row.source_step_id] ??
          (typeof row.expected === "object" ? row.expected : undefined);
        return {
          description: check?.description ?? row.description,
          expected: check
            ? `${operators[check.operator] ?? check.operator} ${valueText(check.value)}`
            : "",
        };
      }
      const raw = data?.operations[row.id];
      return {
        description: operationDescription(
          raw?.description ?? row.description,
          raw?.name ??
            calls.find((call) => call.call_id === row.tool_call_id)?.name ??
            "",
          raw?.inputs ?? row.inputs,
        ),
        expected: "",
      };
    });
}
function phaseRows(
  rows: ActualRow[],
  definitions: ManualCaseSource["preconditions"],
  source: ManualCaseSource,
  data?: ManualSourceData,
  calls: ActualCase["call_records"] = [],
): ManualStep[] {
  // 按原前置/收尾顺序补入声明的条件，不把失败尝试写成下一次必须重做的动作。
  const steps: ManualStep[] = [];
  for (const definition of definitions) {
    const recorded = rows.filter(
      (r) => r.source_step_id === definition.step_id,
    );
    if (recorded.length)
      steps.push(...manualRows(recorded, source, data, calls));
    else
      steps.push({
        description: definition.description,
        expected: definition.expected
          ? `${operators[definition.expected.operator] ?? definition.expected.operator} ${valueText(definition.expected.value)}`
          : "",
      });
  }
  steps.push(
    ...manualRows(
      rows.filter(
        (r) => !definitions.some((d) => d.step_id === r.source_step_id),
      ),
      source,
      data,
      calls,
    ),
  );
  return steps;
}
function rowsTable(rows: ManualStep[]): string {
  return (
    "| 序号 | 操作步骤 | 预期结果 |\n| --- | --- | --- |\n" +
    rows
      .map(
        (r, n) => `| ${n + 1} | ${cell(r.description)} | ${cell(r.expected)} |`,
      )
      .join("\n") +
    "\n"
  );
}
export function manualCaseFilename(index?: number, rebuilt = false): string {
  return `manual-cases${index === undefined ? "" : "-" + (index + 1)}${rebuilt ? "-rebuilt" : ""}.md`;
}
export function manualCasesMarkdown(
  run: SuiteRun,
  caseRunId?: string,
  data?: ManualSourceData,
): string {
  const sources = data?.cases ?? manualCaseSource(run);
  return run.instances
    .filter((i) => !caseRunId || i.case_run_id === caseRunId)
    .map((i) => {
      const c = projectActualCase(run, i);
      const source =
        sources[i.case_run_id] ?? manualCaseSource(run)[i.case_run_id]!;
      const original = source.original_case.replace(/[<>]/g, "\\$&");
      return `# 用例名称：${cell(source.name)}\n\n## 原始用例\n\n${original}\n\n## 前置用例\n\n${rowsTable(phaseRows(c.preconditions.recorded, source.preconditions, source, data, c.call_records))}\n## 实际步骤\n\n${rowsTable(manualRows(c.steps, source, data, c.call_records))}\n## 收尾\n\n${rowsTable(phaseRows(c.cleanup.recorded, source.cleanup, source, data, c.call_records))}`;
    })
    .join("\n---\n\n");
}
export function writeManualCases(
  directory: string,
  run: SuiteRun,
  rebuilt = false,
): void {
  const suffix = rebuilt ? "-rebuilt" : "";
  const source = readManualSource(directory, run.suite_run_id);
  atomicWrite(
    join(directory, `actual-steps${suffix}.json`),
    JSON.stringify(actualStepsDocument(run), null, 2) + "\n",
  );
  atomicWrite(
    join(directory, manualCaseFilename(undefined, rebuilt)),
    manualCasesMarkdown(run, undefined, source),
  );
  for (const [index, instance] of run.instances.entries())
    atomicWrite(
      join(directory, manualCaseFilename(index, rebuilt)),
      manualCasesMarkdown(run, instance.case_run_id, source),
    );
}
