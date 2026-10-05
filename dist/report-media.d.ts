import type { CaseRun, SuiteRun } from "./contracts.js";
export declare function recordingMedia(directory: string, run: SuiteRun, instance: CaseRun): {
    videos: string;
    notice: string;
};
