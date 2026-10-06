/** 从同一份已脱敏事实生成手工用例，原文件与重建文件分别保存。 */
import { join } from "node:path";
import { atomicWrite } from "./recorder.js";
import { projectActualCase, inputText, expectedText, operationLabels, } from "./actual-operations.js";
export function actualStepsDocument(run) {
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
const md = (text) => String(text ?? "")
    .replace(/[\\`*_{}\[\]<>&#|]/g, (c) => `&#${c.charCodeAt(0)};`)
    .replace(/\r?\n/g, "<br>");
function rowsTable(rows, numbered) {
    if (!rows.length)
        return "未记录。\n";
    return (`| ${numbered ? "序号" : "记录"} | 操作步骤 | 实际输入 | 原有预期 | 本次记录 | 来源规划步骤 |\n| --- | --- | --- | --- | --- | --- |\n` +
        rows
            .map((row) => `| ${numbered ? row.number : "—"} | ${md(row.description)} | ${md(inputText(row))} | ${md(expectedText(row))} | ${md(operationLabels[row.state] ?? row.state)}${row.operation?.granularity === "composite" ? "；复合操作" : ""}${row.operation?.reason ? "；" + md(row.operation.reason) : ""} | ${md(row.source_step_id)}：${md(row.source_description)} |`)
            .join("\n") +
        "\n");
}
function caseMarkdown(c) {
    return `## ${md(c.name)}\n\n实例：${md(c.case_run_id)}；数据：${md(c.data_id)}；本次状态：${md(c.status)}。\n\n实际步骤说明完整性：${c.completeness}。${c.needs_review ? "保存为手工用例前请复核失败、重试、复合操作和缺少的预期。" : "操作说明已记录；工具成功与业务检查结果分别显示。"}\n\n${c.completeness_reasons.map((r) => `- ${md(r)}\n`).join("")}\n### 原始任务\n\n${md(c.original_task)}\n\n### 测试数据\n\n${md(JSON.stringify(c.parameters, null, 2))}\n\n### 原规划\n\n${c.planned_steps.map((s, n) => `${n + 1}. ${md(s.description)}${s.checks?.length ? "；检查：" + s.checks.map(md).join("；") : ""}`).join("\n")}\n\n### 前置条件\n\n${c.preconditions.definitions.map((s) => `- ${md(s)}`).join("\n") || "原计划未定义独立前置条件。"}\n\n${rowsTable(c.preconditions.recorded, false)}\n### 实际步骤\n\n${rowsTable(c.steps, true)}\n### 收尾\n\n${c.cleanup.definitions.map((s) => `- ${md(s)}`).join("\n") || "原计划未定义业务收尾。"}\n\n${rowsTable(c.cleanup.recorded, false)}\n${c.not_dispatched.length ? "### 未执行的说明（不计步骤序号）\n\n" + rowsTable(c.not_dispatched, false) + "\n" : ""}`;
}
export function manualCasesMarkdown(run, caseRunId) {
    const cases = actualStepsDocument(run).cases.filter((c) => !caseRunId || c.case_run_id === caseRunId);
    return (`# ${md(run.name)} · 手工用例\n\n运行：${md(run.suite_run_id)}。本文件记录本次实际路径，保留失败和重试；未重新复跑。没有独立检查的操作预期需由使用者补充。技术定位引用仅在 JSON 调用依据中保存。\n\n` +
        cases.map(caseMarkdown).join("\n"));
}
export function writeManualCases(directory, run, rebuilt = false) {
    const suffix = rebuilt ? "-rebuilt" : "";
    atomicWrite(join(directory, `actual-steps${suffix}.json`), JSON.stringify(actualStepsDocument(run), null, 2) + "\n");
    atomicWrite(join(directory, `manual-cases${suffix}.md`), manualCasesMarkdown(run));
}
