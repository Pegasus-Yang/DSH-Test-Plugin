/** 当前Agent的测试增强：宿主驱动对话，插件提供约束、可信采集和确定性结果。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { ToolCallId } from "@deepseek-ai/dsh-llm/brand";
import type { ToolExecutionResult, ToolRunContext } from "@deepseek-ai/dsh-tools";
import { type Phase, type Step, type SuiteRun } from "./contracts.js";
import { Recorder } from "./recorder.js";
import { RecoveryManager } from "./recovery.js";
import { ReportAccess } from "./report-access.js";
import { PreviewManager } from "./preview.js";
import { type ProgressSnapshot } from "./progress-model.js";
import { type TestConfig } from "./config.js";
import type { TextInput } from "./case-input.js";
import type { ActualOperation } from "./contracts.js";
declare module "@deepseek-ai/dsh-llm" {
    interface MessageSourceMap {
        "plugin:test": {
            kind: "plugin:test";
            form: "notice";
            summary: string;
        };
    }
}
export declare class NativeTests {
    readonly ctx: Context;
    private readonly preparePreview?;
    readonly config: TestConfig;
    readonly reports: ReportAccess;
    readonly preview: PreviewManager;
    readonly recovery: RecoveryManager;
    readonly sessions: Map<string, NativeTest>;
    private readonly historicalProgress;
    private starting;
    constructor(ctx: Context, config: Partial<TestConfig>, preparePreview?: (() => Promise<void>) | undefined);
    start(agent: Agent, task: string, plan?: unknown, review?: boolean, input?: TextInput): Promise<string>;
    reportId(sessionId: string): string | undefined;
    presentation(sessionId: string): ProgressSnapshot | null;
    quarantine(run: SuiteRun, reason: string): void;
    release(evidenceFile: string): void;
    shutdown(): Promise<void>;
}
export declare class NativeTest {
    private owner;
    private review;
    private input?;
    readonly recorder: Recorder;
    readonly run: SuiteRun;
    readonly agent: Agent;
    closed: boolean;
    private planned;
    private reportReady;
    private cancelled;
    private cleanupTurn;
    private finalizing;
    private nudges;
    private planningQuestion;
    private cursor;
    private entries;
    private current?;
    private calls;
    private pendingTools;
    private trustedCalls;
    private operations;
    private delegatedFailures;
    private disposers;
    private timer?;
    private stoppingTimer?;
    private mediaDeadline?;
    private task;
    private readonly originalTask;
    private readonly manualSource;
    private draft?;
    private reviewCall?;
    private reviewDismissed;
    private previousPlanMode?;
    private announcement?;
    constructor(owner: NativeTests, agent: Agent, task: string, review?: boolean, input?: TextInput | undefined);
    get id(): string;
    enterPlanMode(): Promise<void>;
    private setPlanMode;
    attach(): void;
    private missingAnnouncement;
    private outputLanguage;
    start(task: string): Promise<string>;
    submit(input: unknown, trustedFile?: boolean): unknown;
    private validateEffective;
    private reviewMarkdown;
    private freeze;
    private advance;
    private finishStep;
    state(): {
        current: {
            instance: string;
            step: Step;
            checks: {
                check_index: number;
                text: string;
                bound: boolean;
            }[];
            observations: {
                ref: string;
                value: import("./contracts.js").Json;
            }[];
            inputs: {
                [k: string]: unknown;
            };
            phase: Phase;
        } | null;
        assertions: (import("./contracts.js").AssertionResult | undefined)[];
        next: string;
        plan_summary?: string | undefined;
        announcement_required?: string | undefined;
        review_markdown?: string | undefined;
        phase: string;
        planning_input?: TextInput | undefined;
        run_id: string;
        session_id: string;
    };
    presentation(): ProgressSnapshot;
    private bind;
    private isTrusted;
    private settle;
    call(name: string, args: unknown, parent: ToolRunContext, explanation?: Pick<ActualOperation, "description" | "description_source">): Promise<{
        callId: ToolCallId;
        result: ToolExecutionResult;
    }>;
    stop(reason?: string): void;
    private turnEnded;
    private finish;
    private requireSettled;
    private cleanupAllowed;
    private releaseStep;
    private releaseAllowed;
    private armStopDeadline;
    private exportManualCases;
    private save;
    private emergency;
    dispose(): void;
    shutdown(): Promise<void>;
}
