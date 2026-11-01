/** 对真实返回执行确定性提取，不接受模型填写实际值或任意转换脚本。 */
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import type { Json } from "./contracts.js";
export interface ToolExtract {
    from: "structured" | "value" | "json" | "text" | "playwright-result";
    pointer?: string;
    block?: number;
    type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
    between?: {
        after: string;
        before: string;
    };
}
export declare const toolExtractSchema: {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
        from: {
            enum: string[];
            description: string;
        };
        pointer: {
            type: string;
            pattern: string;
        };
        block: {
            type: string;
            minimum: number;
        };
        type: {
            description: string;
            enum: string[];
        };
        between: {
            type: string;
            required: string[];
            additionalProperties: boolean;
            properties: {
                after: {
                    type: string;
                    minLength: number;
                };
                before: {
                    type: string;
                    minLength: number;
                };
            };
        };
    };
};
export declare function toolResultError(result: ToolExecutionResult): boolean;
/** 只走自有字段；JSON Pointer 不支持通配符或表达式。 */
export declare function jsonPointer(value: unknown, pointer?: string): unknown;
export declare function extractToolResult(result: ToolExecutionResult, extract: ToolExtract): Json;
