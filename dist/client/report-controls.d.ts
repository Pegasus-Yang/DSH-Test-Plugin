import type { ReportResult } from "../test-ui-access.js";
export interface ReportActions {
    rebuildReport: (runId?: string) => Promise<ReportResult>;
}
export declare function RebuildReport({ rebuildReport, runId, }: ReportActions & {
    runId?: string;
}): import("react/jsx-runtime").JSX.Element;
export declare function ReportSettings(actions: ReportActions): import("react/jsx-runtime").JSX.Element;
