/** 从已校验计划和运行事实生成只读展示数据；不参与执行和断言。 */
import type { SuiteRun, TestSuite } from "./contracts.js";
export type ProgressPhase = "planning" | "reviewing" | "executing" | "stopping" | "cleanup" | "finished" | "interrupted";
export interface ProgressCheck {
    text: string;
    status: string;
    reason?: string;
}
export interface ProgressStep {
    id: string;
    description: string;
    status: string;
    started_at?: string;
    finished_at?: string;
    duration_ms: number;
    reason?: string;
    checks: ProgressCheck[];
}
export interface ProgressCase {
    id: string;
    name: string;
    data_id: string;
    status: string;
    steps: ProgressStep[];
    setup: ProgressStep[];
    cleanup: ProgressStep[];
}
export interface PreviewState {
    ready: boolean;
    failed?: boolean;
    reason?: string;
    frame_id?: string;
    captured_at?: string;
    src?: string;
}
export interface ProgressSnapshot {
    session_id: string;
    run_id: string;
    title: string;
    rationale?: string;
    phase: ProgressPhase;
    created_at: string;
    finished_at?: string;
    server_now: string;
    current_instance_id?: string;
    current_step_id?: string;
    instances: ProgressCase[];
    total_steps: number;
    settled_steps: number;
    report_url?: string;
    preview: PreviewState;
}
export declare function projectProgress(input: {
    run: SuiteRun;
    plan?: TestSuite;
    phase: ProgressPhase;
    current?: {
        case_run_id: string;
        step_id: string;
    };
    now?: number;
    reportUrl?: string;
}): ProgressSnapshot;
