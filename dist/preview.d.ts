import type { PreviewConfig } from "./config.js";
import type { SuiteRun } from "./contracts.js";
import type { PreviewOwner } from "./cdp-publisher.js";
import type { PreviewState } from "./progress-model.js";
import type { RunBridge } from "./runbridge.js";
import type { ToolPreviewFrame } from "./tool-preview.js";
import { type RecordingContext } from "./recording.js";
interface Frame {
    bytes: Buffer;
    id: string;
    capturedAt: string;
    mime?: string;
}
export declare class PreviewManager {
    private toolFrame?;
    private toolMessage?;
    private viewerUntil;
    private agentCdpOwner?;
    private candidateCdp?;
    private captureFailed;
    private remote?;
    private owner?;
    private generation;
    private target?;
    private frame?;
    private reason;
    private checkedAt;
    private pending?;
    private child?;
    private childReady;
    private setupError?;
    private failure?;
    private commandAbort?;
    private startupTimer?;
    private startupDeadline?;
    private cleanup;
    private serviceUrl?;
    private recordingContext?;
    private polling?;
    private recordingNotice?;
    private captures;
    config?: PreviewConfig;
    constructor(config?: PreviewConfig);
    private initialize;
    /** 运行前应用已保存设置，保持进度路由持有的管理器对象不变。 */
    configure(config?: PreviewConfig): Promise<void>;
    unavailable(reason: string): void;
    /** 只有当前运行实际持有浏览器上下文时才交付页面归属。 */
    sync(run: SuiteRun, recordingContext?: RecordingContext, actualOwner?: PreviewOwner | false): void;
    setToolFrame(runId: string, caseId: string, frame: ToolPreviewFrame, mode: "once" | "poll"): void;
    clearTool(runId: string): void;
    toolNotice(runId: string, reason: string): void;
    viewing(runId: string): boolean;
    private readCandidate;
    adoptCdp(run: SuiteRun, caseId: string, targetId: unknown, callId: string): Promise<boolean>;
    invalidateCdpSelection(runId: string): void;
    attachCdp(run: SuiteRun, caseId: string, value: unknown): Promise<void>;
    private pollRecording;
    sealRecordings(runId: string, reason: string): void;
    finishRun(run: SuiteRun): Promise<void>;
    drain(runId: string): Promise<void>;
    private stopChild;
    private cancelStartup;
    private fail;
    private current;
    private checkPort;
    private metadata;
    private ensureService;
    private launch;
    private refresh;
    private readCapture;
    summary(runId: string): PreviewState;
    state(runId: string): Promise<PreviewState>;
    screenshot(runId: string): Promise<Frame | undefined>;
    shutdown(): Promise<void>;
    /** 远程后端复用展示接口，不启动本机 Browscreen。 */
    syncRemote(run: SuiteRun, browser: RunBridge): void;
}
export {};
