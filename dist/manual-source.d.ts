import { type ActualOperation, type Json, type SuiteRun } from "./contracts.js";
export interface ManualCaseSource {
    name: string;
    original_case: string;
    preconditions: {
        step_id: string;
        description: string;
        expected?: {
            operator: string;
            value: Json;
        };
    }[];
    cleanup: ManualCaseSource["preconditions"];
    checks: Record<string, {
        description: string;
        operator: string;
        value: Json;
    }>;
}
export interface ManualSourceData {
    schema_version: "1";
    suite_run_id: string;
    cases: Record<string, ManualCaseSource>;
    operations: Record<string, {
        description: string;
        name: string;
        inputs: Record<string, Json>;
    }>;
}
export declare function manualCaseSource(run: SuiteRun): ManualSourceData["cases"];
export declare class ManualSource {
    private readonly directory;
    private lastSaved?;
    private readonly data;
    constructor(directory: string, runId: string);
    record(operation: ActualOperation, name: string, args: unknown, description: string): void;
    save(run: SuiteRun): void;
}
export declare function readManualSource(directory: string, runId: string): ManualSourceData | undefined;
