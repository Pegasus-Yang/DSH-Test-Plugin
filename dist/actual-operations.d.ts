/** 已保存操作与检查的纯投影；不请求模型，也不补造未执行步骤。 */
import type { ActualOperation, AssertionResult, CaseRun, Json, Phase, StepResult, SuiteRun } from "./contracts.js";
export declare const operationSchemaVersion = "1";
/** 模型在同一份支持名单中选择完整名称，避免省略MCP前缀反复失败。 */
export declare const operationToolNames: string[];
export declare function operationTool(name: string, args?: unknown): boolean;
export declare function compositeOperation(name: string, args: unknown): boolean;
export declare function sealOperations(run: SuiteRun, reason: string): void;
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
    expected: string | {
        description: string;
        operator: string;
        value: Json;
        rule_ref: string;
    };
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
    planned_steps: {
        step_id: string;
        description: string;
        checks?: string[];
    }[];
    preconditions: {
        definitions: string[];
        recorded: ActualRow[];
    };
    steps: ActualRow[];
    cleanup: {
        definitions: string[];
        recorded: ActualRow[];
    };
    not_dispatched: ActualRow[];
    call_records: {
        call_id: string;
        name: string;
        args_redacted: Json;
        body_started: "unknown" | boolean;
    }[];
}
/** 手工执行使用真实输入；短期定位引用与任意脚本仅保留在调用依据中。 */
export declare function operationInputs(step: StepResult, op: ActualOperation): Record<string, Json>;
export declare function projectActualCase(run: SuiteRun, instance: CaseRun): ActualCase;
export declare const operationLabels: Record<string, string>;
export declare function inputText(row: ActualRow): string;
export declare function expectedText(row: ActualRow): string;
