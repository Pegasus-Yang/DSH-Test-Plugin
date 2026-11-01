import type { ToolRunContext, ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { type Binding, type Json, type Step, type StepResult, type SuiteRun, type ActualOperation } from "./contracts.js";
import { Recorder } from "./recorder.js";
import type { LegacyBrowserTools, DomToolBinding } from "./tool-capabilities.js";
import { RunBridge } from "./runbridge.js";
interface CaptureHost {
    id: string;
    browser?: RunBridge;
    legacyTools?: LegacyBrowserTools;
    domBindings?: Record<string, DomToolBinding>;
    assertTool?(name: string): void;
    call(name: string, args: unknown, parent: ToolRunContext, explanation?: Pick<ActualOperation, "description" | "description_source">): Promise<{
        callId: string;
        result: ToolExecutionResult;
    }>;
}
/** 图片取自实际返回，按内容去重；没有媒体能力时不另行调用默认截图工具。 */
export declare function archiveToolImages(recorder: Recorder, suite: SuiteRun, result: ToolExecutionResult): string[];
export declare function mcpResult(value: unknown): unknown;
/** 固定的只读DOM采集函数；选择器来自通过Schema校验的计划或本次运行绑定。 */
export declare function domFunction(captures: Record<string, unknown>, origins: string[]): string;
export declare function captureStep(host: CaptureHost, recorder: Recorder, suite: SuiteRun, step: Step, result: StepResult, binding: Binding, exec: ToolRunContext): Promise<Json>;
export {};
