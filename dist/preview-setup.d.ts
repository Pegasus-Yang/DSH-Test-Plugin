/** 将预览参数限于 MCP 的运行配置，不持久修改用户的浏览器条目。 */
import { type Context } from "@deepseek-ai/cordis";
import type { PreviewConfig, TestConfig } from "./config.js";
import type { PreviewPreferences, PreviewSettingsInfo } from "./preview-preferences.js";
interface McpConfig {
    serverName?: string;
    transport?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
}
/** 保留用户的 JSON 配置、初始化脚本和 CLI 参数，补充本插件的 CDP 交付。 */
export declare function prepareMcpPreview(config: McpConfig, workDir: string, initializer: string): Pick<McpConfig, "args" | "env">;
export declare class PreviewSetup {
    private readonly ctx;
    private readonly preferences;
    private readonly config;
    private readonly initializer;
    private target?;
    private detach?;
    private message;
    constructor(ctx: Context, preferences: () => PreviewPreferences | undefined, config: Partial<TestConfig>, initializer?: string);
    private attach;
    private restore;
    /** 停用或卸载时解除运行配置接入，仍在运行的 MCP 恢复原始配置。 */
    dispose(): Promise<void>;
    describe(): PreviewSettingsInfo;
    prepare(): Promise<PreviewConfig | undefined>;
    failed(error: unknown): string;
}
export {};
