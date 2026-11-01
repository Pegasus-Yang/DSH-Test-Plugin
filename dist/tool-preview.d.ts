/** Agent 选择采集方法，宿主核对原页面身份后复用；不参与业务断言。 */
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { type ToolExtract } from "./tool-results.js";
import { type TestToolCatalog } from "./tool-runtime.js";
export interface ToolPreviewRecipe {
    tool_name: string;
    arguments?: Record<string, unknown>;
    arguments_json?: string;
    mode?: "once" | "poll";
    context: ToolExtract;
    frame_context?: ToolExtract;
    source_context?: ToolExtract;
    frame_source_context?: ToolExtract;
    identity_argument?: string;
    image?: ToolExtract;
    transport?: "image" | "cdp";
}
export interface ToolPreviewFrame {
    bytes: Buffer;
    mime: string;
    id: string;
    capturedAt: string;
}
export interface ToolPreviewContext {
    callId: string;
    tool: string;
    caseId: string;
    result: ToolExecutionResult;
}
export declare function imageFrame(result: ToolExecutionResult): Omit<ToolPreviewFrame, "id" | "capturedAt">;
type Dispatch = (name: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
export declare class ToolPreview {
    private readonly host;
    private context?;
    private recipe?;
    private identity?;
    private sourceIdentity?;
    private timer?;
    private generation;
    private count;
    private attempts;
    private started;
    private pending;
    private stopped;
    private reason;
    private mode;
    constructor(host: {
        catalog: () => TestToolCatalog;
        frame: (context: ToolPreviewContext, frame: ToolPreviewFrame, mode: "once" | "poll") => void;
        clear: () => void;
        event: (kind: string, value: unknown) => void;
        poll: () => Promise<void>;
        viewing: () => boolean;
        cdp: (context: ToolPreviewContext, metadata: unknown) => Promise<void>;
    });
    bind(context: ToolPreviewContext): void;
    private reset;
    state(): {
        mode: "once" | "poll" | "waiting" | "trying" | "unverified" | "unavailable";
        reason: string;
        source: string | undefined;
        context_call_id: string | undefined;
        tool: string | undefined;
        frames: number;
        attempts: number;
        generation: number;
        candidates: string[];
    };
    unavailable(reason: string): void;
    retry(): void;
    reserveAttempt(): void;
    nextCase(): void;
    stop(): void;
    connect(recipe: ToolPreviewRecipe, dispatch: Dispatch, reserved?: boolean): Promise<ReturnType<ToolPreview["state"]>>;
    private arm;
    capture(dispatch: Dispatch): Promise<void>;
}
export {};
