import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** 测试插件设置提供环境处置、预览及录像偏好；MCP 接入留到下一次测试开始。 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { previewPreferenceDefaults, browscreenVersionRange, videoInstallHint, } from "../preview-preferences.js";
import { RecoveryPanel } from "./recovery-panel.js";
import { ReportSettings } from "./report-controls.js";
export function PreviewSettingsPage({ forms, rebuildReport, ...recovery }) {
    const [info, setInfo] = useState();
    const [error, setError] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        void fetch("/test-preview-settings", {
            signal: controller.signal,
            cache: "no-store",
        })
            .then(async (response) => {
            if (!response.ok)
                throw new Error("无法读取配置，请确认已登录且测试插件正常加载。");
            setInfo((await response.json()));
        })
            .catch((error) => {
            if (!controller.signal.aborted)
                setError(String(error));
        });
        return () => controller.abort();
    }, []);
    return (_jsxs("section", { className: "dsh-test-settings", "data-test-preview-settings": true, children: [_jsx("h2", { children: "\u6D4B\u8BD5\u73AF\u5883" }), _jsx("p", { children: "\u6D4B\u8BD5\u63D0\u793A\u73AF\u5883\u672A\u91CA\u653E\u65F6\uFF0C\u8BF7\u5148\u5728\u8FD9\u91CC\u5904\u7406\uFF0C\u5B8C\u6210\u540E\u91CD\u65B0\u6267\u884C\u6D4B\u8BD5\u547D\u4EE4\u3002" }), _jsx(RecoveryPanel, { ...recovery }), _jsx(ReportSettings, { rebuildReport: rebuildReport }), _jsx("h2", { children: "\u6D4F\u89C8\u5668\u9884\u89C8\u4E0E\u5F55\u50CF" }), _jsx("p", { children: "\u5B9E\u65F6\u67E5\u770B\u6D4B\u8BD5\u7F51\u9875\uFF0C\u6216\u5728\u62A5\u544A\u4E2D\u56DE\u770B\u64CD\u4F5C\u5F55\u50CF\u3002\u63A5\u53E3\u6D4B\u8BD5\u6216\u6CA1\u6709\u6D4F\u89C8\u5668\u753B\u9762\u65F6\uFF0C\u4E0D\u4F1A\u6253\u5F00\u6D6E\u7A97\u3002" }), error && _jsx("p", { role: "alert", children: error }), info ? (_jsx(PreferencesForm, { info: info, form: forms.get(info.namespace) })) : (!error && _jsx("p", { children: "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026" }))] }));
}
function PreferencesForm({ info, form, }) {
    const state = useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form));
    const [draft, setDraft] = useState(previewPreferenceDefaults);
    const [portText, setPortText] = useState(String(previewPreferenceDefaults.port));
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [editRevision, setEditRevision] = useState();
    const [checking, setChecking] = useState(false);
    const [detected, setDetected] = useState();
    const checker = useRef();
    useEffect(() => () => {
        checker.current?.abort();
        checker.current = undefined;
    }, []);
    useEffect(() => {
        if (dirty || state.status !== "ready")
            return;
        const value = {
            ...previewPreferenceDefaults,
            ...state.value?.browserPreview,
        };
        setDraft(value);
        setPortText(String(value.port));
        checker.current?.abort();
        checker.current = undefined;
        setChecking(false);
        setDetected(undefined);
    }, [state.value, state.status, dirty]);
    const edit = (value) => {
        if (value.browscreenExecutable !== undefined) {
            checker.current?.abort();
            checker.current = undefined;
            setChecking(false);
            setDetected(undefined);
        }
        if (!dirty)
            setEditRevision(state.revision);
        setDraft((current) => ({ ...current, ...value }));
        setDirty(true);
        setMessage("");
    };
    const check = async () => {
        const controller = new AbortController();
        checker.current = controller;
        setChecking(true);
        setDetected(undefined);
        try {
            const response = await fetch("/test-preview-settings/check", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    browscreenExecutable: draft.browscreenExecutable.trim() || "browscreen",
                }),
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
            });
            if (!response.ok)
                throw new Error("检测请求失败，请确认宿主和测试插件正常运行。");
            const result = (await response.json());
            if (!controller.signal.aborted)
                setDetected(result);
        }
        catch (error) {
            if (!controller.signal.aborted)
                setDetected({
                    ok: false,
                    message: `安装检测失败：${error instanceof Error ? error.message : String(error)}`,
                });
        }
        finally {
            if (checker.current === controller) {
                checker.current = undefined;
                setChecking(false);
            }
        }
    };
    const save = async () => {
        const port = Number(portText);
        const executable = draft.browscreenExecutable.trim() || "browscreen";
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            setMessage("端口请填写 1 到 65535 之间的整数，例如 13390。");
            return;
        }
        if ((draft.enabled || draft.recordingEnabled) && !draft.mcpId) {
            setMessage("请先选择用于测试的 Playwright 浏览器。");
            return;
        }
        if (executable !== "browscreen" &&
            !/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(executable)) {
            setMessage("请填写 browscreen 或可执行文件的完整路径，不要混入启动参数。");
            return;
        }
        setSaving(true);
        setMessage("");
        try {
            const accepted = await form.mutate([
                {
                    op: "set",
                    path: ["browserPreview"],
                    value: {
                        enabled: draft.enabled,
                        recordingEnabled: !!draft.recordingEnabled,
                        mcpId: draft.mcpId,
                        browscreenExecutable: executable,
                        port,
                    },
                },
            ], editRevision);
            if (accepted) {
                setDirty(false);
                setMessage("已保存。下一次测试会使用这些设置，无需重启 DSH。");
            }
            else
                setMessage("没有保存成功，可能配置已被修改或被启动 patch 覆盖。请重新读取设置后再试。");
        }
        catch (error) {
            setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            setSaving(false);
        }
    };
    if (state.status === "loading")
        return _jsx("p", { children: "\u6B63\u5728\u8BFB\u53D6\u4FDD\u5B58\u7684\u914D\u7F6E\u2026" });
    if (!state.writable || state.status === "unavailable")
        return (_jsx("p", { role: "alert", children: "\u5F53\u524D\u8FDE\u63A5\u4E0D\u80FD\u4FDD\u5B58\u5BBF\u4E3B\u8BBE\u7F6E\u3002\u8BF7\u4ECE\u672C\u673A DSH \u9875\u9762\u6253\u5F00\uFF1B\u81EA\u5B9A\u4E49\u90E8\u7F72\u9700\u63D0\u4F9B settings \u548C config-editor \u670D\u52A1\u3002" }));
    return (_jsxs("form", { onSubmit: (event) => {
            event.preventDefault();
            void save();
        }, children: [_jsxs("label", { className: "dsh-test-setting-switch", children: [_jsx("input", { type: "checkbox", checked: draft.enabled, disabled: saving, onChange: (event) => edit({ enabled: event.target.checked }) }), "\u542F\u7528\u6D4F\u89C8\u5668\u5B9E\u65F6\u9884\u89C8"] }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u5F00\u542F\u540E\u4E5F\u4F1A\u7B49\u5F85\u6D4F\u89C8\u5668\u753B\u9762\u5C31\u7EEA\uFF0C\u4E0D\u4F1A\u63D0\u524D\u6253\u5F00\u7A7A\u7A97\u53E3\u3002" }), _jsxs("label", { className: "dsh-test-setting-switch", children: [_jsx("input", { type: "checkbox", checked: !!draft.recordingEnabled, disabled: saving, onChange: (event) => edit({ recordingEnabled: event.target.checked }) }), "\u5F55\u5236\u6D4F\u89C8\u5668\u64CD\u4F5C\u89C6\u9891"] }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u5F55\u50CF\u5F00\u5173\u72EC\u7ACB\u4E8E\u5B9E\u65F6\u9884\u89C8\uFF0C\u9ED8\u8BA4\u5173\u95ED\u3002\u4EC5\u5B9E\u9645\u6D4F\u89C8\u5668\u7528\u4F8B\u5F55\u5236\uFF1B\u9690\u85CF\u6D6E\u7A97\u6216\u5173\u95ED\u9875\u9762\u540E\u4ECD\u7EE7\u7EED\u5F55\u5236\uFF0C\u7ED3\u675F\u540E\u5728\u6D4B\u8BD5\u62A5\u544A\u67E5\u770B\u3002" }), draft.recordingEnabled && (_jsxs("p", { className: "dsh-test-setting-hint", children: [videoInstallHint, "\u201C\u68C0\u6D4B\u5B89\u88C5\u201D\u53EA\u68C0\u67E5\u547D\u4EE4\u53CA\u7248\u672C\uFF0C\u4E0D\u80FD\u8BC1\u660E\u89C6\u9891\u4F9D\u8D56\u5DF2\u5B89\u88C5\u3002"] })), _jsxs("p", { className: "dsh-test-setting-hint", children: ["\u8BF7\u5148\u5728 DSH \u6240\u5728\u7535\u8111\u5B89\u88C5 Browscreen\uFF08Python \u22653.14\uFF09\u3002\u652F\u6301\u7A33\u5B9A\u7248\u672C", " ", browscreenVersionRange, "\uFF0C\u5EFA\u8BAE\u4F7F\u7528 0.3.0\u3002 \u9ED8\u8BA4\u4ECE\u5BBF\u4E3B PATH \u67E5\u627E browscreen\uFF0C\u65E0\u9700\u4E0B\u8F7D\u6E90\u7801\u6216\u63D0\u524D\u542F\u52A8\u670D\u52A1\u3002"] }), _jsx("div", { className: "dsh-test-setting-actions", children: _jsx("button", { type: "button", disabled: saving || checking, onClick: () => void check(), children: checking ? "正在检测…" : "检测安装" }) }), detected && (_jsxs("div", { className: "dsh-test-command-check", "data-test-browscreen-check": true, role: detected.ok ? "status" : "alert", children: [_jsx("p", { children: detected.message }), detected.executable && (_jsxs("p", { children: ["\u547D\u4EE4\u4F4D\u7F6E\uFF1A", _jsx("code", { children: detected.executable })] })), detected.version && _jsxs("p", { children: ["\u68C0\u6D4B\u7248\u672C\uFF1A", detected.version] })] })), _jsxs("fieldset", { disabled: saving, children: [_jsxs("details", { className: "dsh-test-command-advanced", children: [_jsx("summary", { children: "\u9AD8\u7EA7\u8BBE\u7F6E\uFF1ABrowscreen \u547D\u4EE4\u8DEF\u5F84" }), _jsx("label", { htmlFor: "dsh-test-browscreen-executable", children: "Browscreen \u53EF\u6267\u884C\u6587\u4EF6" }), _jsx("input", { id: "dsh-test-browscreen-executable", type: "text", value: draft.browscreenExecutable, placeholder: "browscreen \u6216\u5B8C\u6574\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84", onChange: (event) => edit({ browscreenExecutable: event.target.value }) }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u7EC8\u7AEF\u80FD\u8FD0\u884C\u4F46\u68C0\u6D4B\u627E\u4E0D\u5230\u65F6\uFF0C\u6267\u884C uv tool dir --bin\uFF0C\u5C06\u8BE5\u76EE\u5F55\u4E2D\u7684 browscreen \u5B8C\u6574\u8DEF\u5F84\u586B\u5728\u8FD9\u91CC\uFF1B\u4E0D\u662F\u9879\u76EE\u6587\u4EF6\u5939\uFF0C\u4E5F\u4E0D\u586B\u5199\u989D\u5916\u53C2\u6570\u3002" })] }), _jsx("label", { htmlFor: "dsh-test-browscreen-port", children: "\u91C7\u96C6\u670D\u52A1\u7AEF\u53E3" }), _jsx("input", { id: "dsh-test-browscreen-port", type: "number", min: "1", max: "65535", value: portText, onChange: (event) => {
                            if (!dirty)
                                setEditRevision(state.revision);
                            setPortText(event.target.value);
                            setDirty(true);
                            setMessage("");
                        } }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u901A\u5E38\u4FDD\u7559 13390\u3002\u5982\u679C\u5B83\u5DF2\u88AB\u522B\u7684\u7A0B\u5E8F\u5360\u7528\uFF0C\u6362\u4E00\u4E2A\u7A7A\u95F2\u7AEF\u53E3\u3002" }), _jsx("label", { htmlFor: "dsh-test-preview-mcp", children: "Playwright \u6D4F\u89C8\u5668" }), _jsxs("select", { id: "dsh-test-preview-mcp", value: draft.mcpId, onChange: (event) => edit({ mcpId: event.target.value }), children: [_jsx("option", { value: "", children: "\u8BF7\u9009\u62E9\u6D4F\u89C8\u5668" }), info.mcpInstances.map((instance) => (_jsxs("option", { value: instance.id, disabled: !instance.compatible, children: [instance.label, instance.compatible ? "" : "（暂不支持此接入）"] }, instance.id)))] }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u9009\u62E9\u7528\u4E8E\u672C\u63D2\u4EF6\u6D4B\u8BD5\u7684 Playwright\u3002\u6CA1\u6709\u53EF\u9009\u9879\u65F6\uFF0C\u5148\u6309\u6307\u5357\u6DFB\u52A0\u672C\u673A Playwright MCP\u3002" })] }), _jsx("p", { children: "\u4FDD\u5B58\u540E\u4E0B\u4E00\u6B21\u6D4B\u8BD5\u751F\u6548\u3002\u9996\u6B21\u63A5\u5165\u4F1A\u91CD\u65B0\u8FDE\u63A5\u9009\u4E2D\u7684 MCP\uFF0C\u8BF7\u52FF\u4E0E\u5176\u4ED6\u4F1A\u8BDD\u5171\u4EAB\u64CD\u4F5C\u8BE5\u6D4F\u89C8\u5668\u3002" }), _jsxs("div", { className: "dsh-test-setting-actions", children: [_jsx("button", { type: "submit", disabled: !dirty || saving || checking, children: saving ? "正在保存…" : "保存设置" }), _jsx("button", { type: "button", disabled: !dirty || saving, onClick: () => {
                            setDirty(false);
                            setMessage("");
                        }, children: "\u653E\u5F03\u4FEE\u6539" })] }), message && _jsx("p", { role: "status", children: message }), _jsx("p", { className: "dsh-test-setting-hint", children: info.message })] }));
}
