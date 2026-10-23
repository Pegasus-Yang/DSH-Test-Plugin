import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** 设置入口优先展示连接；资源处置与报告维护保持独立。 */
import { useCallback, useEffect, useState } from "react";
import { RecoveryPanel } from "./recovery-panel.js";
import { ReportSettings } from "./report-controls.js";
import { BrowserSettings, } from "./browser-settings.js";
export function PreviewSettingsPage({ forms, rebuildReport, describeReport, ...recovery }) {
    const [info, setInfo] = useState();
    const [error, setError] = useState("");
    const refresh = useCallback(async (signal) => {
        const response = await fetch("/test-preview-settings", {
            signal,
            cache: "no-store",
        });
        if (!response.ok)
            throw new Error("无法读取设置，请确认已登录且测试插件正常加载。");
        setInfo((await response.json()));
        setError("");
    }, []);
    useEffect(() => {
        const c = new AbortController();
        void refresh(c.signal).catch((e) => {
            if (!c.signal.aborted)
                setError(e.message);
        });
        return () => c.abort();
    }, [refresh]);
    return (_jsxs("section", { className: "dsh-test-settings", "data-test-preview-settings": true, children: [_jsx("h2", { children: "\u6D4F\u89C8\u5668\u8BBE\u7F6E" }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u9009\u62E9\u6D4B\u8BD5\u6D4F\u89C8\u5668\u7684\u4F4D\u7F6E\uFF0C\u518D\u914D\u7F6E\u8FDE\u63A5\u548C\u753B\u9762\u3002\u63A5\u53E3\u6D4B\u8BD5\u65E0\u9700\u6D4F\u89C8\u5668\u3002" }), error && _jsx("p", { role: "alert", children: error }), info ? (_jsx(BrowserSettings, { form: forms.get(info.namespace), info: info, refresh: refresh })) : (!error && _jsx("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026" })), _jsx(RecoveryPanel, { ...recovery }), _jsx(ReportSettings, { rebuildReport: rebuildReport, describeReport: describeReport })] }));
}
