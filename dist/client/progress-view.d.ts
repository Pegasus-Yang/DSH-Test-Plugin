/** 只读步骤展示规则；准备、清理和业务步骤保持各自身份。 */
import type { ProgressCase, ProgressSnapshot, ProgressStep } from "../progress-model.js";
export declare const phaseLabels: {
    planning: string;
    reviewing: string;
    executing: string;
    stopping: string;
    cleanup: string;
    finished: string;
    interrupted: string;
};
export declare const statusLabels: Record<string, string>;
export declare function duration(milliseconds: number): string;
export declare function elapsed(step: ProgressStep, now: number): number;
export declare function tone(status: string): string;
export declare function selectedInstance(snapshot: ProgressSnapshot): ProgressCase | undefined;
export interface StepRow {
    key: string;
    number: number;
    instance: ProgressCase;
    step: ProgressStep;
}
export declare function stepRows(snapshot: ProgressSnapshot): StepRow[];
export declare function progressTone(snapshot: ProgressSnapshot, failed?: boolean): string;
export interface FocusStep {
    label: string;
    description: string;
    row?: StepRow;
    step?: ProgressStep;
    next?: ProgressStep;
}
export declare function focusStep(snapshot: ProgressSnapshot, rows?: StepRow[]): FocusStep;
