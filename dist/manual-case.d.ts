import type { SuiteRun } from "./contracts.js";
import { type ActualCase } from "./actual-operations.js";
import { type ManualSourceData } from "./manual-source.js";
export declare function actualStepsDocument(run: SuiteRun): {
    cases: ActualCase[];
    finished_at?: string | undefined;
    format: string;
    schema_version: string;
    suite_run_id: string;
    name: string;
    created_at: string;
};
export declare function manualCaseFilename(index?: number, rebuilt?: boolean): string;
export declare function manualCasesMarkdown(run: SuiteRun, caseRunId?: string, data?: ManualSourceData): string;
export declare function writeManualCases(directory: string, run: SuiteRun, rebuilt?: boolean): void;
