import type { ToolRunContext, ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { type Binding, type Json, type Step, type StepResult, type SuiteRun } from "./contracts.js";
import { Recorder } from "./recorder.js";
interface CaptureHost {
    id: string;
    call(name: string, args: unknown, parent: ToolRunContext): Promise<{
        callId: string;
        result: ToolExecutionResult;
    }>;
}
export declare function mcpResult(value: unknown): unknown;
/** 固定的只读DOM采集函数；选择器来自通过Schema校验的计划或本次运行绑定。 */
export declare function domFunction(captures: Record<string, unknown>, origins: string[]): string;
export declare function captureStep(host: CaptureHost, recorder: Recorder, suite: SuiteRun, step: Step, result: StepResult, binding: Binding, exec: ToolRunContext): Promise<Json>;
export {};
