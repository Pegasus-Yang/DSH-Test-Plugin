import type { ToolRuntime } from "@deepseek-ai/dsh-tools";
import type { Context } from "@deepseek-ai/cordis";
export interface ToolConnection {
    id: string;
    prefix: string;
    digest: string;
}
/** 连接配置只保存摘要；地址、启动环境及凭据均不复制到目录。 */
export declare function toolConnections(ctx: Context): ToolConnection[];
export declare function businessTool(name: string): boolean;
export declare class TestToolCatalog {
    private readonly tools;
    private readonly connections;
    private readonly scope?;
    private readonly entries;
    constructor(tools: ToolRuntime, reserved?: string[], connections?: ToolConnection[], scope?: Parameters<ToolRuntime["schemas"]>[0]);
    names(): string[];
    snapshot(): {
        connection?: ToolConnection | undefined;
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        digest: string;
    }[];
    has(name: string): boolean;
    assert(name: string): void;
}
/** 参数只按 JSON 解释；复杂数组可通过字符串绕开旧宿主的对象转换。 */
export declare function toolArguments(input: {
    arguments?: unknown;
    arguments_json?: string;
}): Record<string, unknown>;
