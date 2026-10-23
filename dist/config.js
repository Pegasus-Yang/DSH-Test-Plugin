/** 测试配置与默认值。 */
import { resolve } from "node:path";
import z from "@deepseek-ai/schemastery";
import { previewPreferenceDefaults, } from "./preview-preferences.js";
import { browserPreferenceDefaults, } from "./browser-preferences.js";
export const defaults = {
    workspace: process.cwd(),
    outputRoot: resolve("artifacts/runs"),
    stepTimeoutMs: 180000,
    cleanupTimeoutMs: 60000,
    cancelGraceMs: 10000,
    maxRevisions: 10,
};
const BrowserSchema = z.object({
    backend: z
        .union([z.const("playwright"), z.const("runbridge")])
        .default("playwright"),
    accessFile: z.string().default(""),
    connectionSource: z
        .union([z.const("access-file"), z.const("hub")])
        .default("access-file"),
    hubFile: z.string().default(""),
    nodeId: z.string().default(""),
    nodeLeaseSeconds: z.number().step(1).min(1),
    resourceId: z.string().default(browserPreferenceDefaults.resourceId),
    leaseSeconds: z
        .number()
        .step(1)
        .min(1)
        .max(3600)
        .default(browserPreferenceDefaults.leaseSeconds),
    previewEnabled: z.boolean().default(true),
});
delete BrowserSchema.meta.default;
const PreviewSchema = z.object({
    workDir: z.string().required(),
    browscreenUrl: z.string().required(),
    browscreenExecutable: z
        .string()
        .default(previewPreferenceDefaults.browscreenExecutable),
    previewEnabled: z.boolean().default(true),
    recordingEnabled: z.boolean().default(false),
});
const PreferencesSchema = z.object({
    enabled: z.boolean().default(false),
    recordingEnabled: z.boolean().default(false),
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
/** 浏览器连接与画面偏好可原子保存；下次测试读取，不重载执行中的插件。 */
export const Config = z.object({
    workspace: z.string().default(defaults.workspace),
    outputRoot: z.string().default(defaults.outputRoot),
    stepTimeoutMs: z.number().default(defaults.stepTimeoutMs),
    cleanupTimeoutMs: z.number().default(defaults.cleanupTimeoutMs),
    cancelGraceMs: z.number().default(defaults.cancelGraceMs),
    maxRevisions: z.number().default(defaults.maxRevisions),
    preview: PreviewSchema,
    browser: BrowserSchema,
    browserConnection: BrowserSchema.volatile(),
    browserPreview: PreferencesSchema.volatile(),
});
