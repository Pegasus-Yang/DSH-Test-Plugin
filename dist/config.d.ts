import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { type PreviewPreferences } from "./preview-preferences.js";
export interface PreviewConfig {
    workDir: string;
    browscreenUrl: string;
    browscreenExecutable?: string;
}
export interface TestConfig {
    workspace: string;
    outputRoot: string;
    stepTimeoutMs: number;
    cleanupTimeoutMs: number;
    cancelGraceMs: number;
    maxRevisions: number;
    preview?: PreviewConfig;
}
export declare const defaults: TestConfig;
export interface PluginConfig extends Partial<TestConfig> {
    browserPreview?: Volatile<PreviewPreferences | undefined>;
}
/** 只有预览偏好可即时保存；下一次测试读取它，不重载执行中的插件。 */
export declare const Config: z<Partial<TestConfig> & {
    browserPreview?: PreviewPreferences;
}, PluginConfig>;
