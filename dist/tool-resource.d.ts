import { type ToolExtract } from "./tool-results.js";
import type { Step } from "./contracts.js";
export interface ToolRequest {
    tool_name: string;
    arguments?: Record<string, unknown>;
    arguments_json?: string;
}
export interface ToolResourceConfig {
    scope: "connection" | "resource";
    start: ToolRequest;
    close: ToolRequest;
    identity?: ToolExtract;
    identity_argument?: string;
    released: ToolExtract;
}
export declare function validateToolResource(input: ToolResourceConfig): void;
export declare function toolResourceStep(config: ToolResourceConfig, close?: boolean): Step;
