/** 隔离提示与用户确认后的资源恢复；时间超限只说明可能卡住。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SuiteRun } from "./contracts.js";
export interface QuarantineState {
    token: string;
    run_id?: string;
    reason: string;
    created_at?: string;
    elapsed_ms?: number;
    timeout_ms: number;
    overdue: boolean;
    can_recover: boolean;
    unavailable_reason?: string;
}
export interface RecoverySnapshot {
    quarantine: QuarantineState | null;
    recovering: boolean;
    last_error?: string;
}
export declare class RecoveryManager {
    private readonly outputRoot;
    private readonly timeoutMs;
    private readonly active;
    private readonly stopPreview;
    busy: boolean;
    private lastError?;
    private cancelPending?;
    private readonly path;
    constructor(outputRoot: string, timeoutMs: number, active: () => boolean, stopPreview: () => Promise<void>);
    private read;
    private token;
    status(now?: number): RecoverySnapshot;
    mark(run: SuiteRun, reason: string): void;
    private ensureIdle;
    cancel(): void;
    private commit;
    release(evidenceFile: string, token?: string): void;
    recover(agent: Agent, token: string, signal: AbortSignal): Promise<string>;
}
