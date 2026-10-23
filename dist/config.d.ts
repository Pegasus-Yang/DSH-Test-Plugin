import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { type PreviewPreferences } from "./preview-preferences.js";
import { type BrowserPreferences } from "./browser-preferences.js";
export interface PreviewConfig {
    workDir: string;
    browscreenUrl: string;
    browscreenExecutable?: string;
    previewEnabled?: boolean;
    recordingEnabled?: boolean;
}
export interface TestConfig {
    workspace: string;
    outputRoot: string;
    stepTimeoutMs: number;
    cleanupTimeoutMs: number;
    cancelGraceMs: number;
    maxRevisions: number;
    preview?: PreviewConfig;
    browser?: BrowserPreferences;
}
export declare const defaults: TestConfig;
export interface PluginConfig extends Partial<TestConfig> {
    browserPreview?: Volatile<PreviewPreferences | undefined>;
    browserConnection?: Volatile<BrowserPreferences | undefined>;
}
/** 浏览器连接与画面偏好可原子保存；下次测试读取，不重载执行中的插件。 */
export declare const Config: z<Partial<TestConfig> & {
    browserPreview?: PreviewPreferences;
    browserConnection?: BrowserPreferences;
}, PluginConfig>;
