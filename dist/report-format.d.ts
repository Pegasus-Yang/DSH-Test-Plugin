import { reportIcons } from "./report-icons.js";
import type { AssertionResult } from "./contracts.js";
export declare const escape: (value: unknown) => string;
export declare const json: (value: unknown) => string;
export declare const labels: Record<string, string>;
export declare const badge: (status: string, label?: string) => string;
export declare const icon: (name: keyof typeof reportIcons, className?: string) => string;
export declare const duration: (ms: number) => string;
export declare const checkReason: (result: AssertionResult) => string;
