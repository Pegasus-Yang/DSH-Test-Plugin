import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** 一份草稿原子保存连接与画面偏好；不保存凭据内容。 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { browserPreferenceDefaults, } from "../browser-preferences.js";
import { previewPreferenceDefaults, } from "../preview-preferences.js";
import { RunBridgeConnection, remoteGuide } from "./runbridge-connection.js";
import { LocalPreviewSettings, localGuide } from "./local-preview-settings.js";
// 宿主未提供离开拦截 API，按表单保留草稿；成功保存或明确放弃后清除。
const drafts = new WeakMap();
const values = (v, info) => ({
    browser: {
        ...browserPreferenceDefaults,
        ...(v?.browserConnection ?? v?.browser ?? info.browserConnection),
    },
    preview: { ...previewPreferenceDefaults, ...v?.browserPreview },
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function BrowserSettings({ form, info, refresh, }) {
    const state = useSyncExternalStore(form.subscribe.bind(form), form.getSnapshot.bind(form));
    const cached = drafts.get(form);
    const [base, setBase] = useState(() => cached?.base ?? values(state.value, info));
    const [draft, setDraft] = useState(() => cached?.draft ?? values(state.value, info));
    const [revision, setRevision] = useState(cached?.revision ?? state.revision);
    const [notice, setNotice] = useState(cached ? "上次未保存的修改已保留。请保存或放弃修改。" : "");
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState();
    const [checking, setChecking] = useState(false);
    const request = useRef();
    const formRef = useRef(null);
    const dirty = !same(base, draft);
    const browser = draft.browser;
    const requestKey = JSON.stringify([
        browser.backend,
        browser.accessFile.trim(),
        browser.resourceId,
        browser.leaseSeconds,
    ]);
    const latestKey = useRef(requestKey);
    latestKey.current = requestKey;
    const resultRef = useRef(result);
    resultRef.current = result;
    useEffect(() => {
        if (!dirty && state.status === "ready") {
            const current = values(state.value, info);
            setBase(current);
            setDraft(current);
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
        const warn = (e) => {
            if (dirty) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    const cancel = () => {
        request.current?.controller.abort();
        request.current = undefined;
        setChecking(false);
    };
    const inspect = async (connect, quiet = false) => {
        if (request.current && quiet)
            return;
        cancel();
        const current = { controller: new AbortController(), key: requestKey };
        request.current = current;
        if (!quiet)
            setChecking(true);
        try {
            const response = await fetch("/test-preview-settings/runbridge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: connect ? "connect" : "read",
                    accessFile: browser.accessFile.trim(),
                    resourceId: browser.resourceId.trim(),
                }),
                signal: current.controller.signal,
            });
            const next = (await response.json());
            if (current.controller.signal.aborted ||
                latestKey.current !== current.key)
                return;
            if (!response.ok)
                throw new Error();
            const previous = resultRef.current;
            setResult(!connect &&
                previous?.checked_at &&
                next.file?.revision === previous.file?.revision
                ? { ...previous, file: next.file }
                : next);
            return next;
        }
        catch {
            if (!current.controller.signal.aborted &&
                latestKey.current === current.key) {
                const failed = {
                    ok: false,
                    code: "SETTINGS_UNAVAILABLE",
                    message: "无法读取连接设置，请核对宿主连接后重试。",
                };
                setResult(failed);
                return failed;
            }
        }
        finally {
            if (request.current === current) {
                request.current = undefined;
                setChecking(false);
            }
        }
    };
    useEffect(() => {
        cancel();
        setResult(undefined);
        if (browser.backend !== "runbridge" ||
            !browser.accessFile.trim() ||
            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.resourceId))
            return;
        const timer = setTimeout(() => void inspect(false), 450);
        return () => {
            clearTimeout(timer);
            request.current?.controller.abort();
        };
    }, [browser.backend, requestKey]);
    useEffect(() => {
        if (browser.backend !== "runbridge" || !result?.file)
            return;
        const check = () => {
            if (document.visibilityState === "visible")
                void inspect(false, true);
        };
        const timer = setInterval(check, 15000);
        window.addEventListener("focus", check);
        return () => {
            clearInterval(timer);
            window.removeEventListener("focus", check);
        };
    }, [browser.backend, requestKey, result?.file?.revision]);
    const edit = (next) => {
        if (!dirty)
            setRevision(state.revision);
        setDraft((v) => ({ ...v, ...next }));
        setErrors({});
        setNotice("");
    };
    const focusError = (key) => {
        const ids = {
            accessFile: "dsh-test-runbridge-access",
            resourceId: "dsh-test-runbridge-resource",
            leaseSeconds: "dsh-test-runbridge-lease",
            mcpId: "dsh-test-preview-mcp",
            port: "dsh-test-browscreen-port",
            browscreenExecutable: "dsh-test-browscreen-executable",
        };
        const element = formRef.current?.querySelector("#" + ids[key]);
        const details = element?.closest("details");
        if (details)
            details.open = true;
        element?.focus();
    };
    const save = async () => {
        const invalid = {};
        if (browser.backend === "runbridge") {
            if (!browser.accessFile.trim())
                invalid.accessFile = "请填写 DSH 运行机器上的访问 JSON 文件路径。";
            if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.resourceId.trim()))
                invalid.resourceId = "请填写有效的受管理浏览器资源 ID。";
            if (!Number.isInteger(browser.leaseSeconds) ||
                browser.leaseSeconds < 1 ||
                browser.leaseSeconds > 3600)
                invalid.leaseSeconds = "会话租期须为 1～3600 秒的整数。";
        }
        else if (draft.preview.enabled || draft.preview.recordingEnabled) {
            if (!draft.preview.mcpId ||
                !info.mcpInstances.some((m) => m.id === draft.preview.mcpId && m.compatible))
                invalid.mcpId = "请先选择可用的测试专用 Playwright MCP。";
            if (!Number.isInteger(draft.preview.port) ||
                draft.preview.port < 1 ||
                draft.preview.port > 65535)
                invalid.port = "采集服务端口须为 1～65535 的整数。";
            const command = draft.preview.browscreenExecutable.trim();
            if (command &&
                command !== "browscreen" &&
                !/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(command))
                invalid.browscreenExecutable =
                    "请填写 browscreen 或完整可执行文件路径，不填写额外参数。";
        }
        if (Object.keys(invalid).length) {
            setErrors(invalid);
            focusError(Object.keys(invalid)[0]);
            return;
        }
        setSaving(true);
        setNotice("");
        try {
            if (browser.backend === "runbridge") {
                const file = await inspect(false);
                if (!file?.ok) {
                    setErrors({
                        accessFile: file?.message ?? "读取配置未完成，请重新检查文件。",
                    });
                    focusError("accessFile");
                    return;
                }
            }
            const normalized = {
                browser: {
                    ...browser,
                    accessFile: browser.accessFile.trim(),
                    resourceId: browser.resourceId.trim(),
                    leaseSeconds: browser.backend === "playwright" &&
                        (!Number.isInteger(browser.leaseSeconds) ||
                            browser.leaseSeconds < 1 ||
                            browser.leaseSeconds > 3600)
                        ? base.browser.leaseSeconds
                        : browser.leaseSeconds,
                },
                preview: {
                    ...draft.preview,
                    browscreenExecutable: draft.preview.browscreenExecutable.trim() || "browscreen",
                    port: (browser.backend === "runbridge" ||
                        (!draft.preview.enabled && !draft.preview.recordingEnabled)) &&
                        (!Number.isInteger(draft.preview.port) ||
                            draft.preview.port < 1 ||
                            draft.preview.port > 65535)
                        ? base.preview.port
                        : draft.preview.port,
                },
            };
            // 隐藏的历史选项原样保留，不因切换后端覆盖另一种后端的偏好。
            if (await form.mutate([
                {
                    op: "set",
                    path: ["browserConnection"],
                    value: { ...normalized.browser },
                },
                {
                    op: "set",
                    path: ["browserPreview"],
                    value: { ...normalized.preview },
                },
            ], revision)) {
                setDraft(normalized);
                setBase(normalized);
                drafts.delete(form);
                setNotice("已保存，下次测试生效；当前测试继续使用原连接。连接检测结果见上方，保存本身不代表连接已验证。");
            }
            else
                setErrors({
                    save: state.writable
                        ? "设置已被其他窗口修改或受启动配置覆盖，未覆盖现有值。请放弃草稿并重新读取后再试。"
                        : "当前设置由启动配置固定，不能在此保存。",
                });
        }
        catch {
            setErrors({ save: "保存失败，请检查宿主连接后重试；当前草稿仍保留。" });
        }
        finally {
            setSaving(false);
        }
    };
    if (state.status === "loading")
        return _jsx("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u4FDD\u5B58\u7684\u914D\u7F6E\u2026" });
    const writable = state.writable && state.status === "ready";
    return (_jsxs("form", { ref: formRef, noValidate: true, "data-test-browser-connection": true, onSubmit: (e) => {
            e.preventDefault();
            void save();
        }, children: [_jsxs("p", { className: "dsh-test-config-state", role: "status", children: [dirty
                        ? "有未保存修改；关闭设置后草稿仍保留，请保存或放弃。"
                        : "当前配置已保存", " ", "\u00B7 \u5DF2\u4FDD\u5B58\u7684\u6D4F\u89C8\u5668\u4F4D\u7F6E\uFF1A", base.browser.backend === "runbridge"
                        ? "远程 RunBridge"
                        : "本机 Playwright"] }), info.activeBrowser && (_jsxs("p", { className: "dsh-test-setting-hint", children: ["\u6253\u5F00\u8BBE\u7F6E\u65F6\uFF0C\u8FD0\u884C\u4E2D\u7684\u6D4B\u8BD5\u7ED1\u5B9A\uFF1A", info.activeBrowser === "runbridge"
                        ? "远程 RunBridge"
                        : "本机 Playwright", "\u3002\u4FDD\u5B58\u4E0D\u4F1A\u5207\u6362\u8BE5\u6D4B\u8BD5\u3002"] })), !writable && (_jsxs("p", { role: "alert", children: ["\u5F53\u524D\u8FDE\u63A5\u4E3A\u53EA\u8BFB\u6216\u914D\u7F6E\u7531\u542F\u52A8 patch \u56FA\u5B9A\u3002\u8BF7\u5728\u53EF\u7F16\u8F91\u7684 DSH profile \u4E2D\u8C03\u6574\uFF0C\u4E0D\u80FD\u901A\u8FC7\u6B64\u9875\u8986\u76D6\u542F\u52A8\u914D\u7F6E\u3002", _jsx("a", { href: browser.backend === "runbridge" ? remoteGuide : localGuide, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u914D\u7F6E\u8BF4\u660E" })] })), !!Object.keys(errors).length && (_jsxs("div", { role: "alert", className: "dsh-test-command-check", children: [_jsx("strong", { children: "\u8BBE\u7F6E\u5C1A\u672A\u4FDD\u5B58" }), Object.entries(errors).map(([key, message]) => (_jsxs("p", { children: [message, key !== "save" && (_jsx("button", { type: "button", className: "dsh-test-inline-action", onClick: () => focusError(key), children: "\u5B9A\u4F4D\u5B57\u6BB5" }))] }, key)))] })), _jsxs("fieldset", { disabled: saving || !writable, children: [_jsx("label", { htmlFor: "dsh-test-browser-backend", children: "\u6D4F\u89C8\u5668\u4F4D\u7F6E" }), _jsxs("select", { id: "dsh-test-browser-backend", value: browser.backend, disabled: !writable, onChange: (e) => edit({
                            browser: {
                                ...browser,
                                backend: e.target.value,
                            },
                        }), children: [_jsx("option", { value: "playwright", children: "\u672C\u673A Playwright MCP" }), _jsx("option", { value: "runbridge", children: "\u8FDC\u7A0B RunBridge MCP" })] }), browser.backend === "runbridge" && (_jsx(RunBridgeConnection, { value: browser, edit: (v) => edit({ browser: { ...browser, ...v } }), result: result, checking: checking, read: (connect) => void inspect(connect), cancel: () => {
                            cancel();
                            setNotice("检测已取消，未保存设置。");
                        }, errors: errors })), _jsx("h3", { children: "\u753B\u9762\u4E0E\u5F55\u50CF" }), browser.backend === "runbridge" ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: "dsh-test-setting-switch", children: [_jsx("input", { type: "checkbox", checked: browser.previewEnabled, disabled: !writable, onChange: (e) => edit({
                                            browser: { ...browser, previewEnabled: e.target.checked },
                                        }) }), "\u663E\u793A\u5B9E\u65F6\u753B\u9762"] }), _jsx("p", { className: "dsh-test-setting-hint", children: "RunBridge \u63D0\u4F9B\u540C\u4E00\u8FDC\u7A0B\u9875\u9762\u7684\u753B\u9762\uFF0C\u65E0\u9700\u672C\u673A Browscreen\uFF1B\u8FDC\u7A0B\u5F55\u50CF\u6682\u4E0D\u652F\u6301\u3002" })] })) : (_jsx(LocalPreviewSettings, { value: draft.preview, edit: (v) => edit({ preview: { ...draft.preview, ...v } }), info: info, refresh: refresh, errors: errors }))] }), _jsxs("div", { className: "dsh-test-settings-save dsh-test-setting-actions", children: [_jsx("button", { type: "submit", disabled: !writable || !dirty || saving || checking, children: saving ? "正在保存…" : "保存浏览器设置" }), _jsx("button", { type: "button", disabled: !dirty || saving, onClick: () => {
                            cancel();
                            const current = values(state.value, info);
                            setDraft(current);
                            setBase(current);
                            setRevision(state.revision);
                            setErrors({});
                            setNotice("已放弃修改，恢复当前已保存的浏览器设置。");
                            drafts.delete(form);
                        }, children: "\u653E\u5F03\u4FEE\u6539" })] }), notice && _jsx("p", { role: "status", children: notice })] }));
}
