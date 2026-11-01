import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** 设置入口优先展示连接；资源处置与报告维护保持独立。 */
import { useCallback, useEffect, useState } from "react";
import { RecoveryPanel } from "./recovery-panel.js";
import { ReportSettings } from "./report-controls.js";
import { BrowserSettings, } from "./browser-settings.js";
export function PreviewSettingsPage({ forms, rebuildReport, describeReport, tryPreview, stopPreview, currentSession, ...recovery }) {
    const [tab, setTab] = useState("connections");
    const [info, setInfo] = useState();
    const [error, setError] = useState("");
    const refresh = useCallback(async (signal) => {
        const response = await fetch("/test-preview-settings" +
            (currentSession?.()
                ? "?session_id=" + encodeURIComponent(currentSession())
                : ""), {
            signal,
            cache: "no-store",
        });
        if (!response.ok)
            throw new Error("无法读取设置，请确认已登录且测试插件正常加载。");
        setInfo((await response.json()));
        setError("");
    }, [currentSession]);
    useEffect(() => {
        const c = new AbortController();
        void refresh(c.signal).catch((e) => {
            if (!c.signal.aborted)
                setError(e.message);
        });
        return () => c.abort();
    }, [refresh]);
    useEffect(() => {
        if (tab !== "media")
            return;
        const controller = new AbortController();
        let timer;
        const poll = async () => {
            try {
                await refresh(controller.signal);
            }
            catch {
                if (!controller.signal.aborted)
                    setError("画面状态读取失败，请检查宿主连接。");
            }
            if (!controller.signal.aborted)
                timer = setTimeout(poll, 2000);
        };
        timer = setTimeout(poll, 2000);
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [tab, refresh]);
    return (_jsxs("section", { className: "dsh-test-settings", "data-test-preview-settings": true, "data-settings-tab": tab, children: [_jsx("h2", { children: "\u5DE5\u5177\u4E0E\u5B9E\u65F6\u753B\u9762" }), _jsx("p", { className: "dsh-test-setting-hint", children: "Agent \u6309\u7528\u4F8B\u9009\u62E9\u5F53\u524D\u5BF9\u8BDD\u53EF\u7528\u7684\u5DE5\u5177\uFF1B\u6B64\u5904\u7BA1\u7406\u8FDE\u63A5\u3001\u753B\u9762\u4E0E\u6D4B\u8BD5\u73AF\u5883\u3002" }), error && _jsx("p", { role: "alert", children: error }), _jsx("div", { className: "dsh-test-settings-tabs", role: "tablist", "aria-label": "\u6D4B\u8BD5\u63D2\u4EF6\u8BBE\u7F6E", children: [
                    ["connections", "工具接入"],
                    ["media", "实时画面"],
                    ["environment", "环境与报告"],
                ].map(([id, label], index) => (_jsx("button", { type: "button", id: "dsh-test-tab-" + id, role: "tab", "aria-selected": tab === id, "aria-controls": "dsh-test-panel-" + id, tabIndex: tab === id ? 0 : -1, onClick: () => setTab(id), onKeyDown: (event) => {
                        const ids = ["connections", "media", "environment"];
                        const next = event.key === "ArrowRight"
                            ? ids[(index + 1) % 3]
                            : event.key === "ArrowLeft"
                                ? ids[(index + 2) % 3]
                                : event.key === "Home"
                                    ? ids[0]
                                    : event.key === "End"
                                        ? ids[2]
                                        : undefined;
                        if (next) {
                            event.preventDefault();
                            setTab(next);
                            document.getElementById("dsh-test-tab-" + next)?.focus();
                        }
                    }, children: label }, id))) }), tab !== "environment" && info ? (_jsx("div", { role: "tabpanel", id: "dsh-test-panel-" + tab, "aria-labelledby": "dsh-test-tab-" + tab, children: _jsx(BrowserSettings, { form: forms.get(info.namespace), info: info, refresh: refresh, view: tab, tryPreview: tryPreview, stopPreview: stopPreview }) })) : (!info && !error && _jsx("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026" })), _jsx(RecoveryPanel, { ...recovery, compact: tab !== "environment", onOpen: () => setTab("environment") }), _jsx("div", { hidden: tab !== "environment", role: "tabpanel", id: "dsh-test-panel-environment", "aria-labelledby": "dsh-test-tab-environment", children: _jsx(ReportSettings, { rebuildReport: rebuildReport, describeReport: describeReport }) })] }));
}
