/** 同一个插件包的浏览器端入口，使用 DSH 官方插槽与浮窗。 */
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "harness-test-ui";
export declare const inject: readonly ["slots", "sidebarRightTabs", "sidebarRight", "remote", "remote.commands"];
export declare function apply(ctx: Context): void;
