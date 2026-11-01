import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** 连接与画面分别保存，草稿跨设置页保留；凭据内容不进入客户端。 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { browserPreferenceDefaults, runbridgeEnabled, } from "../browser-preferences.js";
import { previewPreferenceDefaults, effectivePreviewPreferences, } from "../preview-preferences.js";
import { RunBridgeConnection } from "./runbridge-connection.js";
import { LocalPreviewSettings } from "./local-preview-settings.js";
const drafts = new WeakMap();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const values = (v, info) => {
    const old = v?.browserConnection ?? v?.browser ?? info.browserConnection;
    return {
        browser: {
            ...browserPreferenceDefaults,
            ...old,
            backend: "auto",
            runbridgeEnabled: runbridgeEnabled(old),
        },
        preview: {
            ...previewPreferenceDefaults,
            ...effectivePreviewPreferences(old, v?.browserPreview),
        },
    };
};
export function BrowserSettings({ form, info, refresh, view = "connections", tryPreview, stopPreview, }) {
    const state = useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form));
    const cached = drafts.get(form);
    const [base, setBase] = useState(() => cached?.base ?? values(state.value, info));
    const [draft, setDraft] = useState(() => cached?.draft ?? values(state.value, info));
    const [revision, setRevision] = useState(cached?.revision ?? state.revision);
    const [notice, setNotice] = useState(cached ? "上次未保存的修改已保留。" : "");
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState();
    const [checking, setChecking] = useState(false);
    const [details, setDetails] = useState(false);
    const [probing, setProbing] = useState(false);
    const request = useRef();
    const formRef = useRef(null);
    const dirty = !same(base, draft);
    const sectionDirty = view === "connections"
        ? !same(base.browser, draft.browser)
        : !same(base.preview, draft.preview);
    const browser = draft.browser;
    const connectionKey = JSON.stringify(browser);
    const keyRef = useRef(connectionKey);
    keyRef.current = connectionKey;
    useEffect(() => {
        if (!dirty && state.status === "ready") {
            const next = values(state.value, info);
            setBase(next);
            setDraft(next);
            setRevision(state.revision);
        }
    }, [state.value, state.revision, state.status, dirty, info]);
    useEffect(() => {
        if (dirty)
            drafts.set(form, { draft, base, revision });
        else
            drafts.delete(form);
    }, [draft, base, revision, dirty, form]);
    useEffect(() => {
        const warn = (event) => {
            if (dirty) {
                event.preventDefault();
                event.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    useEffect(() => {
        request.current?.abort();
        setResult(undefined);
        setChecking(false);
        return () => request.current?.abort();
    }, [connectionKey]);
    const edit = (part) => {
        if (!dirty)
            setRevision(state.revision);
        setDraft((current) => ({ ...current, ...part }));
        setErrors({});
        setNotice("");
    };
    const inspect = async (connect) => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        const key = connectionKey;
        setChecking(true);
        try {
            const response = await fetch("/test-preview-settings/runbridge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: connect ? "connect" : "read",
                    connectionSource: browser.connectionSource ?? "access-file",
                    accessFile: browser.accessFile.trim(),
                    hubFile: browser.hubFile?.trim(),
                    nodeId: browser.nodeId?.trim(),
                    resourceId: browser.resourceId.trim(),
                }),
                signal: controller.signal,
            });
            const next = (await response.json());
            if (!controller.signal.aborted && keyRef.current === key) {
                setResult(next);
                return next;
            }
        }
        catch {
            if (!controller.signal.aborted)
                setResult({
                    ok: false,
                    code: "CHECK_FAILED",
                    message: "检测失败，请核对私有文件与宿主连接。",
                });
        }
        finally {
            if (request.current === controller)
                setChecking(false);
        }
    };
    const focusError = (key) => {
        const ids = {
            accessFile: "dsh-test-runbridge-access",
            hubFile: "dsh-test-runbridge-hub",
            nodeId: "dsh-test-runbridge-node",
            nodeLeaseSeconds: "dsh-test-runbridge-node-lease",
            resourceId: "dsh-test-runbridge-resource",
            leaseSeconds: "dsh-test-runbridge-lease",
            port: "dsh-test-browscreen-port",
            browscreenExecutable: "dsh-test-browscreen-executable",
        };
        const el = formRef.current?.querySelector("#" + ids[key]);
        for (let parent = el?.parentElement; parent; parent = parent.parentElement)
            if (parent instanceof HTMLDetailsElement)
                parent.open = true;
        el?.focus();
    };
    const save = async () => {
        const invalid = {};
        if (view === "connections" && runbridgeEnabled(browser)) {
            const hub = browser.connectionSource === "hub";
            if (!(hub ? browser.hubFile : browser.accessFile)?.trim())
                invalid[hub ? "hubFile" : "accessFile"] =
                    "请填写 DSH 运行机器上的私有 YAML 或 JSON 文件路径。";
            if (hub &&
                !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.nodeId?.trim() ?? ""))
                invalid.nodeId = "请填写有效的 Node ID。";
            if (hub &&
                browser.nodeLeaseSeconds !== undefined &&
                (!Number.isInteger(browser.nodeLeaseSeconds) ||
                    browser.nodeLeaseSeconds < 1))
                invalid.nodeLeaseSeconds = "Node 租期须为正整数秒，或留空。";
            if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.resourceId.trim()))
                invalid.resourceId = "请填写有效的浏览器资源 ID。";
            if (!Number.isInteger(browser.leaseSeconds) ||
                browser.leaseSeconds < 1 ||
                browser.leaseSeconds > 3600)
                invalid.leaseSeconds = "会话租期须为 1～3600 秒的整数。";
        }
        if (view === "media" &&
            (draft.preview.enabled || draft.preview.recordingEnabled)) {
            if (!Number.isInteger(draft.preview.port) ||
                draft.preview.port < 1 ||
                draft.preview.port > 65535)
                invalid.port = "采集服务端口须为 1～65535 的整数。";
            const command = draft.preview.browscreenExecutable.trim();
            if (command &&
                command !== "browscreen" &&
                !/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(command))
                invalid.browscreenExecutable =
                    "请填写 browscreen 或完整命令路径，不填写额外参数。";
        }
        if (Object.keys(invalid).length) {
            setErrors(invalid);
            setDetails(true);
            requestAnimationFrame(() => focusError(Object.keys(invalid)[0]));
            return;
        }
        setSaving(true);
        setNotice("");
        try {
            if (view === "connections" &&
                runbridgeEnabled(browser) &&
                !(await inspect(false))?.ok) {
                setErrors({ save: "私有配置尚未读取成功，请先核对连接详情。" });
                setDetails(true);
                return;
            }
            const normalized = view === "connections"
                ? {
                    ...browser,
                    backend: "auto",
                    previewEnabled: base.preview.enabled,
                    accessFile: browser.accessFile.trim(),
                    hubFile: browser.hubFile?.trim(),
                    nodeId: browser.nodeId?.trim(),
                    resourceId: browser.resourceId.trim(),
                }
                : {
                    ...draft.preview,
                    schemaVersion: 2,
                    browscreenExecutable: draft.preview.browscreenExecutable.trim() || "browscreen",
                };
            const path = view === "connections" ? "browserConnection" : "browserPreview";
            if (await form.mutate([
                {
                    op: "set",
                    path: [path],
                    value: JSON.parse(JSON.stringify(normalized)),
                },
            ], revision)) {
                const next = view === "connections"
                    ? { ...draft, browser: normalized }
                    : { ...draft, preview: normalized };
                setDraft(next);
                setBase((current) => view === "connections"
                    ? { ...current, browser: next.browser }
                    : { ...current, preview: next.preview });
                setRevision(form.getSnapshot().revision);
                setNotice("已保存，下次测试生效；当前测试继续使用原连接。保存不代表连接已验证。");
                await refresh();
            }
            else
                setErrors({
                    save: state.writable
                        ? "设置已被其他窗口修改，未覆盖现有值。请放弃草稿后重新读取。"
                        : "当前设置由启动配置固定，无法保存。",
                });
        }
        catch {
            setErrors({ save: "保存失败，草稿仍保留，请检查宿主连接。" });
        }
        finally {
            setSaving(false);
        }
    };
    const action = async (fn) => {
        if (!fn)
            return;
        setProbing(true);
        try {
            setNotice(await fn());
            await refresh();
        }
        catch (error) {
            setNotice(error instanceof Error ? error.message : "请求失败");
        }
        finally {
            setProbing(false);
        }
    };
    const checkConnection = async (id) => {
        setChecking(true);
        try {
            const response = await fetch("/test-preview-settings/connection", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            const result = await response.json();
            setNotice(result.message ?? "已读取宿主连接状态");
            await refresh();
        }
        catch {
            setNotice("无法读取宿主连接状态，请检查 DSH 连接。");
        }
        finally {
            setChecking(false);
        }
    };
    if (state.status === "loading")
        return _jsx("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u4FDD\u5B58\u7684\u914D\u7F6E\u2026" });
    const writable = state.writable && state.status === "ready";
    return (_jsxs("form", { ref: formRef, noValidate: true, "data-test-browser-connection": true, onSubmit: (event) => {
            event.preventDefault();
            void save();
        }, children: [_jsx("p", { className: "dsh-test-config-state", role: "status", children: sectionDirty
                    ? "当前页有未保存修改；切换页签或关闭设置会保留草稿。"
                    : "当前页配置已保存" }), !writable && (_jsx("p", { role: "alert", children: "\u5F53\u524D\u914D\u7F6E\u53EA\u8BFB\uFF0C\u8BF7\u5728\u53EF\u7F16\u8F91\u7684 DSH profile \u4E2D\u8C03\u6574\u3002" })), !!Object.keys(errors).length && (_jsx("div", { role: "alert", children: Object.entries(errors).map(([key, message]) => (_jsxs("p", { children: [message, key !== "save" && (_jsx("button", { type: "button", className: "dsh-test-inline-action", onClick: () => focusError(key), children: "\u5B9A\u4F4D\u5B57\u6BB5" }))] }, key))) })), _jsx("fieldset", { disabled: saving || !writable, children: view === "connections" ? (_jsxs(_Fragment, { children: [_jsx("p", { className: "dsh-test-setting-hint", children: "\u8FDE\u63A5\u767B\u8BB0\u4E0D\u9650\u5B9A\u8FD0\u884C\u5DE5\u5177\u3002Agent \u6309\u5F53\u524D\u5BF9\u8BDD\u6743\u9650\u548C\u7528\u4F8B\u76EE\u6807\u9009\u62E9\uFF0C\u591A\u4E2A\u6765\u6E90\u53EF\u4EE5\u534F\u4F5C\u3002" }), _jsxs("div", { className: "dsh-test-connections", children: [!!info.nativeTools?.length && (_jsxs("div", { className: "dsh-test-connection", children: [_jsxs("div", { children: [_jsx("strong", { children: "\u5176\u4ED6\u5BBF\u4E3B\u5DE5\u5177" }), _jsxs("span", { className: "dsh-test-setting-hint", children: [info.nativeTools.length, " \u4E2A\u5DE5\u5177"] })] }), _jsxs("p", { className: "dsh-test-setting-hint", children: [info.agentVisible
                                                    ? "按当前对话权限可见"
                                                    : "运行时确认对话权限", "\uFF0C\u4E0E MCP \u5DE5\u5177\u4E00\u8D77\u53C2\u4E0E\u89C4\u5212\u3002"] }), _jsxs("details", { children: [_jsx("summary", { children: "\u67E5\u770B\u5DE5\u5177" }), _jsx("ul", { children: info.nativeTools.map((name) => (_jsx("li", { children: _jsx("code", { children: name }) }, name))) })] })] })), info.mcpInstances.map((source) => (_jsxs("div", { className: "dsh-test-connection", children: [_jsxs("div", { children: [_jsx("strong", { children: source.label }), _jsx("span", { className: "dsh-test-setting-hint", children: source.enabled === false
                                                        ? "未启用"
                                                        : source.tools?.length
                                                            ? "工具已加载"
                                                            : "已登记" })] }), _jsxs("p", { className: "dsh-test-setting-hint", children: [source.tools?.length ?? 0, " \u4E2A\u5DF2\u52A0\u8F7D\u5DE5\u5177 \u00B7", " ", source.visible === undefined
                                                    ? "运行时确认对话权限"
                                                    : source.visible
                                                        ? "当前对话可见"
                                                        : "当前对话不可见", " ", "\u00B7", " ", source.compatible
                                                    ? "可主动接入画面"
                                                    : "可让 Agent 尝试画面"] }), _jsxs("div", { className: "dsh-test-setting-actions", children: [_jsx("button", { type: "button", disabled: checking, onClick: () => void checkConnection(source.id), children: "\u68C0\u6D4B\u8FDE\u63A5" }), _jsxs("details", { children: [_jsx("summary", { children: "\u67E5\u770B\u5DE5\u5177" }), source.tools?.length ? (_jsx("ul", { children: source.tools.map((name) => (_jsx("li", { children: _jsx("code", { children: name }) }, name))) })) : (_jsx("p", { className: "dsh-test-setting-hint", children: "\u5C1A\u65E0\u53EF\u89C1\u5DE5\u5177\uFF0C\u8BF7\u5728 DSH \u4E2D\u542F\u7528\u8FDE\u63A5\u5E76\u68C0\u67E5\u5F53\u524D\u5BF9\u8BDD\u6743\u9650\u3002" }))] })] })] }, source.id))), _jsxs("div", { className: "dsh-test-connection", children: [_jsxs("div", { children: [_jsx("strong", { children: "RunBridge" }), _jsx("span", { className: "dsh-test-setting-hint", children: runbridgeEnabled(browser) ? "已登记连接" : "未登记" })] }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u53EA\u8BFB\u68C0\u6D4B\u4E0D\u9886\u53D6\u8BBE\u5907\uFF0C\u5B9E\u9645\u4F7F\u7528\u65F6\u7BA1\u7406\u539F\u79DF\u7EA6\u3002" }), _jsx("button", { type: "button", className: "dsh-test-inline-action", onClick: () => setDetails((current) => !current), children: details ? "收起连接详情" : "配置连接" })] })] }), details && (_jsxs("section", { className: "dsh-test-connection-detail", children: [_jsx("h3", { children: "RunBridge \u8FDE\u63A5\u8BE6\u60C5" }), _jsxs("label", { className: "dsh-test-setting-switch", children: [_jsx("input", { type: "checkbox", checked: runbridgeEnabled(browser), onChange: (event) => edit({
                                                browser: {
                                                    ...browser,
                                                    runbridgeEnabled: event.target.checked,
                                                },
                                            }) }), "\u767B\u8BB0\u6B64\u8FDE\u63A5\u4F9B Agent \u4F7F\u7528"] }), _jsx(RunBridgeConnection, { value: browser, edit: (next) => edit({ browser: { ...browser, ...next } }), result: result, checking: checking, read: (connect) => void inspect(connect), cancel: () => {
                                        request.current?.abort();
                                        setChecking(false);
                                        setNotice("检测已取消");
                                    }, errors: errors })] })), _jsxs("details", { className: "dsh-test-command-advanced", children: [_jsx("summary", { children: "\u6DFB\u52A0\u5176\u4ED6\u5DE5\u5177\u8FDE\u63A5" }), _jsx("p", { children: "\u5728 DSH \u8BBE\u7F6E\u7684\u201C\u5185\u7F6E\u63D2\u4EF6\u201D\u4E2D\u6DFB\u52A0 MCP \u5BA2\u6237\u7AEF\uFF0C\u586B\u5199\u670D\u52A1\u63D0\u4F9B\u7684 stdio \u542F\u52A8\u547D\u4EE4\u6216 HTTP \u5730\u5740\uFF1B\u5728\u5F53\u524D Agent \u4E2D\u542F\u7528\u76F8\u5E94\u5DE5\u5177\u3002" }), _jsx("p", { children: "Playwright MCP \u4E5F\u4F7F\u7528\u540C\u4E00\u5165\u53E3\uFF0C\u8FDE\u63A5\u540D\u79F0\u53EF\u81EA\u5B9A\u4E49\u3002\u4EE5\u4E0B\u542F\u52A8\u53C2\u6570\u4EC5\u5E2E\u52A9\u914D\u7F6E\uFF0C\u6267\u884C\u65F6\u4E0E\u5176\u4ED6\u5DE5\u5177\u5E73\u7B49\u3002" }), _jsx("pre", { children: 'transport: stdio\nserverName: web-browser\ncommand: npx\nargs: ["-y", "@playwright/mcp@0.0.68", "--isolated"]' }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u6CE8\u518C\u540E\u70B9\u51FB\u201C\u5237\u65B0\u8FDE\u63A5\u5217\u8868\u201D\uFF1BRunBridge \u7684\u79C1\u6709\u6587\u4EF6\u5728\u4E0A\u65B9\u8FDE\u63A5\u8BE6\u60C5\u914D\u7F6E\u3002" })] }), _jsx("button", { type: "button", className: "dsh-test-inline-action", onClick: () => void refresh(), children: "\u5237\u65B0\u8FDE\u63A5\u5217\u8868" })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "dsh-test-setting-hint", children: "\u6765\u6E90\uFF1A\u8DDF\u968F\u6D4B\u8BD5\u5B9E\u9645\u64CD\u4F5C\u7684\u9875\u9762\u3002\u5148\u5C1D\u8BD5\u5DF2\u6709\u753B\u9762\u9002\u914D\uFF0C\u518D\u7531 Agent \u5C1D\u8BD5\u5F53\u524D\u5DE5\u5177\u7684\u80FD\u529B\u3002" }), _jsx(LocalPreviewSettings, { value: draft.preview, edit: (next) => edit({ preview: { ...draft.preview, ...next } }), info: info, refresh: refresh, errors: errors }), _jsxs("div", { className: "dsh-test-command-check", role: "status", children: [_jsx("strong", { children: info.activeMedia?.reason ?? "等待测试打开实际页面" }), info.activeMedia?.source && (_jsxs("p", { className: "dsh-test-setting-hint", children: ["\u5F53\u524D\u6765\u6E90\uFF1A", info.mcpInstances.find((source) => source.id === info.activeMedia.source)?.label ?? info.activeMedia.source, " ", info.activeMedia.frames > 0
                                            ? ` · 已验证 ${info.activeMedia.frames} 帧`
                                            : ""] })), _jsx("p", { className: "dsh-test-setting-hint", children: "\u6301\u7EED\u753B\u9762\u3001\u5B9A\u65F6\u622A\u56FE\u548C\u5355\u6B21\u622A\u56FE\u5206\u522B\u9A8C\u8BC1\uFF1B\u753B\u9762\u7F3A\u5931\u4ECD\u53EF\u6267\u884C\u7528\u4F8B\u5E76\u8F93\u51FA\u62A5\u544A\u3002" }), _jsxs("div", { className: "dsh-test-setting-actions", children: [_jsx("button", { type: "button", disabled: probing || !tryPreview, onClick: () => void action(tryPreview), children: probing ? "正在提交…" : "让 Agent 尝试接入" }), _jsx("button", { type: "button", disabled: probing || !stopPreview, onClick: () => void action(stopPreview), children: "\u505C\u6B62\u5C1D\u8BD5" })] })] })] })) }), _jsxs("div", { className: "dsh-test-settings-save dsh-test-setting-actions", children: [_jsx("button", { type: "submit", disabled: !writable || !sectionDirty || saving || checking, children: saving
                            ? "正在保存…"
                            : view === "connections"
                                ? "保存连接"
                                : "保存画面偏好" }), _jsx("button", { type: "button", disabled: !sectionDirty || saving, onClick: () => {
                            request.current?.abort();
                            const next = values(state.value, info);
                            setDraft((current) => view === "connections"
                                ? { ...current, browser: next.browser }
                                : { ...current, preview: next.preview });
                            setBase((current) => view === "connections"
                                ? { ...current, browser: next.browser }
                                : { ...current, preview: next.preview });
                            setRevision(state.revision);
                            setErrors({});
                            setNotice("已放弃当前页修改，恢复已保存配置。");
                        }, children: "\u653E\u5F03\u5F53\u524D\u9875\u4FEE\u6539" })] }), notice && _jsx("p", { role: "status", children: notice })] }));
}
