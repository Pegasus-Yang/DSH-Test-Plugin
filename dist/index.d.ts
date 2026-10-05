/** 原生对话增强入口；命令只激活当前Agent的测试能力。 */
import type { Context } from "@deepseek-ai/cordis";
import { NativeTests } from "./native-test.js";
import type { PluginConfig } from "./config.js";
export { parsePlan } from "./contracts.js";
export { Config } from "./config.js";
export declare const name = "harness-test";
export declare const inject: readonly ["commands", "tools", "systemPrompt"];
declare module "@deepseek-ai/cordis" {
    interface Context {
        nativeTests: NativeTests;
    }
}
export declare function apply(ctx: Context, config?: PluginConfig): void;
