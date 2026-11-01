import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { normalizeBrowscreenExecutable } from "./browscreen-command.js";
import { isPlaywrightMcp } from "./playwright-preview.js";
function compatible(config) {
    const browserIndex = config.args?.indexOf("--browser") ?? -1;
    const browser = browserIndex >= 0
        ? config.args?.[browserIndex + 1]
        : config.args?.find((arg) => arg.startsWith("--browser="))?.slice(10);
    return (config.transport === "stdio" &&
        isPlaywrightMcp(config) &&
        !config.args?.some((arg) => /^(--cdp-endpoint|--extension)(=|$)/.test(arg)) &&
        !["firefox", "webkit"].includes(browser ?? ""));
}
/** 保留用户的 JSON 配置、初始化脚本和 CLI 参数，补充本插件的 CDP 交付。 */
export function prepareMcpPreview(config, workDir, initializer) {
    const args = [];
    const initPages = [];
    let configPath;
    const source = config.args ?? [];
    for (let index = 0; index < source.length; index++) {
        const arg = source[index];
        if (arg === "--config") {
            configPath = source[++index];
            if (!configPath)
                throw new Error("Playwright 的 --config 缺少文件路径");
        }
        else if (arg.startsWith("--config="))
            configPath = arg.slice(9);
        else if (arg === "--init-page") {
            while (source[index + 1] && !source[index + 1].startsWith("--"))
                initPages.push(source[++index]);
        }
        else if (arg.startsWith("--init-page="))
            initPages.push(arg.slice(12));
        else
            args.push(arg);
    }
    const cwd = resolve(config.cwd || process.cwd());
    const path = (value) => isAbsolute(value) ? value : resolve(cwd, value);
    const original = configPath
        ? JSON.parse(readFileSync(path(configPath), "utf8"))
        : {};
    const browser = original.browser ?? {};
    if (["firefox", "webkit"].includes(browser.browserName))
        throw new Error("实时预览需要 Chromium 的 CDP，不能修改 Firefox 或 WebKit 的启动参数");
    const launch = browser.launchOptions ?? {};
    const launchArgs = [
        ...new Set([...(launch.args ?? []), "--enable-automation"]),
    ];
    if (!launchArgs.some((arg) => arg.startsWith("--remote-debugging-port=")))
        launchArgs.push("--remote-debugging-port=0");
    mkdirSync(workDir, { recursive: true });
    // 运行产物保留独立副本，卸载包期间正在退出的 MCP 也能完成初始化。
    const initializerBody = readFileSync(initializer);
    const initializerHash = createHash("sha256")
        .update(initializerBody)
        .digest("hex")
        .slice(0, 12);
    const publishedInitializer = join(workDir, `cdp-publisher-${initializerHash}.cjs`);
    writeFileSync(publishedInitializer, initializerBody, { mode: 0o600 });
    const merged = {
        ...original,
        browser: {
            ...browser,
            initPage: [
                ...new Set([
                    ...(browser.initPage ?? []).map(path),
                    ...initPages.map(path),
                    publishedInitializer,
                ]),
            ],
            launchOptions: {
                ...launch,
                args: launchArgs,
            },
        },
    };
    const body = JSON.stringify(merged, null, 2) + "\n";
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
    const generated = join(workDir, `mcp-preview-${hash}.json`);
    writeFileSync(generated, body, { mode: 0o600 });
    return {
        args: [...args, "--config", generated],
        env: { ...config.env, DSH_TEST_PREVIEW_DIR: workDir },
    };
}
export class PreviewSetup {
    ctx;
    preferences;
    config;
    initializer;
    target;
    detach;
    message = "保存后，在下一次测试开始时按预览和录像开关接入浏览器；仅启用预览且有画面时打开浮窗。";
    constructor(ctx, preferences, config, initializer = fileURLToPath(new URL("./cdp-publisher.cjs", import.meta.url))) {
        this.ctx = ctx;
        this.preferences = preferences;
        this.config = config;
        this.initializer = initializer;
    }
    attach() {
        if (this.detach)
            return;
        const setup = this;
        this.detach = this.ctx.on("internal/config", function (_config, next) {
            const current = next();
            const target = setup.target;
            if (!target || this.entry !== target.entry || !compatible(current))
                return current;
            return {
                ...current,
                ...prepareMcpPreview(current, target.workDir, setup.initializer),
            };
        }, { global: true });
    }
    async restore() {
        const target = this.target;
        this.target = undefined;
        const fiber = target?.entry.fiber;
        if (!fiber ||
            fiber.uid === null ||
            target.entry.disabled ||
            this.ctx.root.fiber.uid === null ||
            this.ctx.root.fiber.state === 5 /* FiberState.UNLOADING */ ||
            this.ctx.root.fiber.state === 4 /* FiberState.DISPOSED */ ||
            fiber.state === 5 /* FiberState.UNLOADING */ ||
            fiber.state === 4 /* FiberState.DISPOSED */ ||
            fiber.config?.env?.DSH_TEST_PREVIEW_DIR !== target.workDir)
            return;
        await fiber.restart();
    }
    /** 停用或卸载时解除运行配置接入，仍在运行的 MCP 恢复原始配置。 */
    async dispose() {
        this.detach?.();
        this.detach = undefined;
        await this.restore();
    }
    describe() {
        const entries = this.ctx.get("configEditor")?.entries() ?? [];
        return {
            namespace: this.ctx.fiber.entry?.options.id ?? "harness-test",
            mcpInstances: entries
                .filter((entry) => entry.options.name === "@deepseek-ai/dsh-mcp-client")
                .map((entry) => {
                const config = entry.options.config;
                return {
                    id: entry.options.id,
                    label: `${config.serverName ?? entry.options.id}（${entry.options.id}）`,
                    compatible: compatible(config),
                    enabled: !entry.disabled,
                };
            }),
            message: this.message,
        };
    }
    async prepare() {
        const preferences = this.preferences();
        if (!preferences) {
            await this.restore();
            const config = this.config.preview;
            if (!config)
                return;
            const matching = (this.ctx.get("configEditor")?.entries() ?? []).filter((entry) => {
                const candidate = entry.fiber?.config;
                return (entry.options.name === "@deepseek-ai/dsh-mcp-client" &&
                    candidate?.env?.DSH_TEST_PREVIEW_DIR &&
                    resolve(candidate.env.DSH_TEST_PREVIEW_DIR) ===
                        resolve(config.workDir));
            });
            return matching.length === 1
                ? {
                    ...config,
                    connectionId: matching[0].options.id,
                    connectionDigest: createHash("sha256")
                        .update(JSON.stringify(matching[0].options.config))
                        .digest("hex"),
                }
                : config;
        }
        if (!preferences.enabled && !preferences.recordingEnabled) {
            await this.restore();
            this.message = "实时预览和录像均已关闭。";
            return;
        }
        const executable = normalizeBrowscreenExecutable(preferences.browscreenExecutable);
        let workDir = join(resolve(this.config.outputRoot ?? "artifacts/runs"), ".browser-preview", this.ctx.fiber.entry?.options.id ?? "harness-test");
        const base = {
            workDir,
            browscreenUrl: `http://127.0.0.1:${preferences.port}`,
            browscreenExecutable: executable,
            previewEnabled: preferences.enabled,
            recordingEnabled: !!preferences.recordingEnabled,
        };
        const candidates = (this.ctx.get("configEditor")?.entries() ?? []).filter((entry) => entry.options.name === "@deepseek-ai/dsh-mcp-client" &&
            !entry.disabled &&
            compatible(entry.options.config));
        const entry = candidates.find((entry) => entry.options.id === preferences.mcpId);
        if (!entry || !existsSync(this.initializer)) {
            await this.restore();
            mkdirSync(workDir, { recursive: true });
            this.message =
                "画面跟随实际来源；默认不重载现有 MCP，可让 Agent 尝试当前工具的画面能力。";
            return base;
        }
        workDir = join(workDir, createHash("sha256").update(entry.options.id).digest("hex").slice(0, 12));
        const current = entry.options.config;
        let next;
        try {
            next = prepareMcpPreview(current, workDir, this.initializer);
        }
        catch {
            await this.restore();
            this.message =
                "已知画面增强不适用于该连接，可让 Agent 尝试其原有调试通道或截图能力。";
            return base;
        }
        if (this.target?.entry !== entry)
            await this.restore();
        this.attach();
        this.target = { entry, workDir };
        this.message =
            "正在接入选中的 Playwright；不会启动 Browscreen，直到当前测试产生 CDP。";
        if (!isDeepStrictEqual(entry.fiber?.config?.args, next.args) ||
            !isDeepStrictEqual(entry.fiber?.config?.env, next.env)) {
            if (!entry.fiber || entry.fiber.uid === null)
                throw new Error("所选 MCP 未启用，请先在插件设置中启用浏览器");
            await entry.fiber.restart();
        }
        this.message =
            "浏览器接入已准备；有当前页面 CDP 后按开关采集，启用预览且有有效画面时自动打开浮窗。";
        return {
            connectionId: entry.options.id,
            connectionDigest: createHash("sha256")
                .update(JSON.stringify(entry.options.config))
                .digest("hex"),
            workDir,
            browscreenUrl: `http://127.0.0.1:${preferences.port}`,
            browscreenExecutable: executable,
            previewEnabled: preferences.enabled,
            recordingEnabled: !!preferences.recordingEnabled,
        };
    }
    failed(error) {
        this.message = `浏览器预览与录像未启用：${error instanceof Error ? error.message : String(error)}`;
        return this.message;
    }
}
