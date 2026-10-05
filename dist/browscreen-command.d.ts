import { type BrowscreenCheck } from "./preview-preferences.js";
export declare function normalizeBrowscreenExecutable(value?: string): string;
export declare function checkBrowscreen(value?: string, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
}): Promise<BrowscreenCheck>;
