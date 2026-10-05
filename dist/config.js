/** 测试配置与默认值。 */
import { resolve } from "node:path";
import z from "@deepseek-ai/schemastery";
import { previewPreferenceDefaults, } from "./preview-preferences.js";
export const defaults = {
    workspace: process.cwd(),
    outputRoot: resolve("artifacts/runs"),
    stepTimeoutMs: 180000,
    cleanupTimeoutMs: 60000,
    cancelGraceMs: 10000,
    maxRevisions: 10,
};
const PreviewSchema = z.object({
    workDir: z.string().required(),
    browscreenUrl: z.string().required(),
    browscreenExecutable: z
        .string()
        .default(previewPreferenceDefaults.browscreenExecutable),
});
const PreferencesSchema = z.object({
    enabled: z.boolean().default(false),
    browscreenExecutable: z
        .string()
        .default(previewPreferenceDefaults.browscreenExecutable),
    port: z
        .number()
        .step(1)
        .min(1)
        .max(65535)
        .default(previewPreferenceDefaults.port),
    mcpId: z.string().default(""),
});
// 对象 schema 默认补成 {}；保留“没有保存新偏好”与“明确关闭”的区别。
delete PreviewSchema.meta.default;
delete PreferencesSchema.meta.default;
/** 只有预览偏好可即时保存；下一次测试读取它，不重载执行中的插件。 */
export const Config = z.object({
    workspace: z.string().default(defaults.workspace),
    outputRoot: z.string().default(defaults.outputRoot),
    stepTimeoutMs: z.number().default(defaults.stepTimeoutMs),
    cleanupTimeoutMs: z.number().default(defaults.cleanupTimeoutMs),
    cancelGraceMs: z.number().default(defaults.cancelGraceMs),
    maxRevisions: z.number().default(defaults.maxRevisions),
    preview: PreviewSchema,
    browserPreview: PreferencesSchema.volatile(),
});
