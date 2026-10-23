import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** 关闭画面选项时收起采集依赖；保持录像与预览独立。 */
import { useEffect, useRef, useState } from "react";
import { browscreenVersionRange, videoInstallHint, } from "../preview-preferences.js";
export const localGuide = "https://github.com/Pegasus-Yang/DSH-Test-Plugin/blob/main/doc/user-guide/浏览器实时预览一步一步配置.md";
export function LocalPreviewSettings({ value, edit, info, refresh, errors, }) {
    const [check, setCheck] = useState();
    const [checking, setChecking] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const controller = useRef();
    useEffect(() => {
        controller.current?.abort();
        setCheck(undefined);
        setChecking(false);
        return () => controller.current?.abort();
    }, [value.browscreenExecutable]);
    const inspect = async () => {
        controller.current?.abort();
        const current = new AbortController();
        controller.current = current;
        setChecking(true);
        setCheck(undefined);
        try {
            const r = await fetch("/test-preview-settings/check", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    browscreenExecutable: value.browscreenExecutable.trim() || "browscreen",
                }),
                signal: AbortSignal.any([current.signal, AbortSignal.timeout(8000)]),
            });
            if (!r.ok)
                throw new Error();
            const next = (await r.json());
            if (!current.signal.aborted)
                setCheck(next);
        }
        catch {
            if (!current.signal.aborted)
                setCheck({
                    ok: false,
                    message: "命令检测失败，请核对路径和宿主连接。",
                });
        }
        finally {
            if (controller.current === current)
                setChecking(false);
        }
    };
    return (_jsxs(_Fragment, { children: [_jsxs("label", { className: "dsh-test-setting-switch", children: [_jsx("input", { type: "checkbox", checked: value.enabled, onChange: (e) => edit({ enabled: e.target.checked }) }), "\u663E\u793A\u5B9E\u65F6\u753B\u9762"] }), _jsxs("label", { className: "dsh-test-setting-switch", children: [_jsx("input", { type: "checkbox", checked: !!value.recordingEnabled, onChange: (e) => edit({ recordingEnabled: e.target.checked }) }), "\u5F55\u5236\u6D4F\u89C8\u5668\u64CD\u4F5C\u89C6\u9891"] }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u9884\u89C8\u7B49\u5F85\u9996\u5E27\u540E\u663E\u793A\uFF1B\u5F55\u50CF\u4E0E\u9884\u89C8\u72EC\u7ACB\uFF0C\u5173\u95ED\u6D6E\u7A97\u4E0D\u4F1A\u505C\u6B62\u5F55\u50CF\uFF0C\u7ED3\u675F\u540E\u5728\u62A5\u544A\u67E5\u770B\u3002" }), value.enabled || value.recordingEnabled ? (_jsxs(_Fragment, { children: [_jsx("label", { htmlFor: "dsh-test-preview-mcp", children: "Playwright \u6D4F\u89C8\u5668" }), _jsxs("select", { id: "dsh-test-preview-mcp", value: value.mcpId, "aria-describedby": "dsh-test-mcp-help dsh-test-mcp-error", "aria-invalid": !!errors.mcpId, onChange: (e) => edit({ mcpId: e.target.value }), children: [_jsx("option", { value: "", children: "\u8BF7\u9009\u62E9\u6D4F\u89C8\u5668" }), info.mcpInstances.map((m) => (_jsxs("option", { value: m.id, disabled: !m.compatible, children: [m.label, m.compatible ? "" : "（暂不支持此接入）"] }, m.id)))] }), _jsx("p", { id: "dsh-test-mcp-help", className: "dsh-test-setting-hint", children: "\u9009\u62E9\u6D4B\u8BD5\u4E13\u7528\u7684\u672C\u673A Playwright MCP\uFF0C\u4E0D\u4E0E\u5176\u4ED6\u5BF9\u8BDD\u5171\u4EAB\u64CD\u4F5C\u3002" }), errors.mcpId && (_jsx("p", { id: "dsh-test-mcp-error", role: "alert", children: errors.mcpId })), !info.mcpInstances.some((m) => m.compatible) && (_jsxs("p", { role: "status", children: ["\u672A\u627E\u5230\u53EF\u7528\u7684\u672C\u673A Playwright MCP\u3002", _jsx("a", { href: localGuide, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u914D\u7F6E\u6307\u5357" }), "\uFF0C\u914D\u7F6E\u540E\u91CD\u65B0\u8BFB\u53D6\u5217\u8868\u3002"] })), _jsx("div", { className: "dsh-test-setting-actions", children: _jsx("button", { type: "button", disabled: refreshing, onClick: () => {
                                setRefreshing(true);
                                void refresh()
                                    .catch(() => setCheck({
                                    ok: false,
                                    message: "无法重新读取 MCP 列表，请检查宿主连接。",
                                }))
                                    .finally(() => setRefreshing(false));
                            }, children: refreshing ? "正在读取…" : "重新读取 MCP 列表" }) }), _jsxs("p", { className: "dsh-test-setting-hint", children: ["DSH \u8FD0\u884C\u673A\u5668\u9700\u8981 Browscreen\uFF08Python \u22653.14\uFF09\uFF0C\u652F\u6301\u7A33\u5B9A\u7248", " ", browscreenVersionRange, "\u3002\u65E0\u9700\u63D0\u524D\u542F\u52A8\u91C7\u96C6\u670D\u52A1\u3002", _jsx("a", { href: localGuide, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u5B89\u88C5\u4E0E\u914D\u7F6E\u6B65\u9AA4" })] }), _jsx("div", { className: "dsh-test-setting-actions", children: _jsx("button", { type: "button", disabled: checking, onClick: () => void inspect(), children: checking ? "正在检测…" : "检测命令与版本" }) }), check && (_jsxs("div", { className: "dsh-test-command-check", "data-test-browscreen-check": true, role: check.ok ? "status" : "alert", children: [_jsx("p", { children: check.message }), check.executable && _jsxs("p", { children: ["\u547D\u4EE4\u4F4D\u7F6E\uFF1A", check.executable] }), check.version && _jsxs("p", { children: ["\u7248\u672C\uFF1A", check.version] }), _jsx("p", { children: "\u6B64\u9879\u4EC5\u68C0\u6D4B\u547D\u4EE4\u548C\u7248\u672C\uFF0C\u4E0D\u8BC1\u660E\u5F55\u50CF\u4F9D\u8D56\u6216\u5B9E\u9645\u91C7\u96C6\u5DF2\u53EF\u7528\u3002" })] })), value.recordingEnabled && (_jsxs("details", { children: [_jsx("summary", { children: "\u5F55\u50CF\u4F9D\u8D56\u51C6\u5907" }), _jsx("p", { children: videoInstallHint }), _jsx("p", { children: "\u547D\u4EE4\u68C0\u6D4B\u4E0D\u9A8C\u8BC1 PyAV\uFF0C\u5B9E\u9645\u5F55\u5236\u7ED3\u679C\u5728\u6D4B\u8BD5\u65F6\u786E\u8BA4\u3002" })] })), _jsxs("details", { className: "dsh-test-command-advanced", children: [_jsx("summary", { children: "\u9AD8\u7EA7\u8BBE\u7F6E\uFF1A\u547D\u4EE4\u8DEF\u5F84\u4E0E\u91C7\u96C6\u7AEF\u53E3" }), _jsx("label", { htmlFor: "dsh-test-browscreen-executable", children: "Browscreen \u53EF\u6267\u884C\u6587\u4EF6" }), _jsx("input", { id: "dsh-test-browscreen-executable", value: value.browscreenExecutable, "aria-describedby": "dsh-test-command-help dsh-test-command-error", "aria-invalid": !!errors.browscreenExecutable, onChange: (e) => edit({ browscreenExecutable: e.target.value }) }), _jsx("p", { id: "dsh-test-command-help", className: "dsh-test-setting-hint", children: "\u9ED8\u8BA4 browscreen\u3002\u627E\u4E0D\u5230\u547D\u4EE4\u65F6\u586B\u5199\u5B8C\u6574\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\uFF0C\u4E0D\u586B\u76EE\u5F55\u6216\u989D\u5916\u53C2\u6570\u3002" }), errors.browscreenExecutable && (_jsx("p", { id: "dsh-test-command-error", role: "alert", children: errors.browscreenExecutable })), _jsx("label", { htmlFor: "dsh-test-browscreen-port", children: "\u91C7\u96C6\u670D\u52A1\u7AEF\u53E3" }), _jsx("input", { id: "dsh-test-browscreen-port", type: "number", min: 1, max: 65535, value: Number.isFinite(value.port) ? value.port : "", "aria-describedby": "dsh-test-port-help dsh-test-port-error", "aria-invalid": !!errors.port, onChange: (e) => edit({
                                    port: e.target.value === "" ? NaN : Number(e.target.value),
                                }) }), _jsx("p", { id: "dsh-test-port-help", className: "dsh-test-setting-hint", children: "\u901A\u5E38\u4FDD\u7559 13390\uFF1B\u88AB\u5360\u7528\u65F6\u6362\u4E3A\u7A7A\u95F2\u7AEF\u53E3\u3002\u5B83\u4E0D\u662F DSH \u6216\u6D4F\u89C8\u5668 CDP \u7AEF\u53E3\u3002" }), errors.port && (_jsx("p", { id: "dsh-test-port-error", role: "alert", children: errors.port }))] })] })) : (_jsxs("p", { className: "dsh-test-setting-hint", children: ["\u753B\u9762\u4E0E\u5F55\u50CF\u5747\u5DF2\u5173\u95ED\uFF0C\u4E0D\u9700\u8981\u914D\u7F6E Browscreen\u3002\u6D4F\u89C8\u5668\u7528\u4F8B\u4ECD\u9700\u5DF2\u6CE8\u518C\u7684\u672C\u673A Playwright MCP\u3002", _jsx("a", { href: localGuide, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u914D\u7F6E\u6307\u5357" })] }))] }));
}
