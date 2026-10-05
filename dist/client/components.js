import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** 会话进度与只读画面组件；所有业务状态来自服务端快照。 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { duration, elapsed, phaseLabels, selectedInstance, statusLabels, tone, } from "./progress-view.js";
import { ProgressCard } from "./progress-dock.js";
import { IconCheckOutlineRegular, IconWarningOutlineRegular, } from "@deepseek-ai/dsh-client-ui-primitives";
function useProgress(actions, visible = true) {
    const [snapshot, setSnapshot] = useState();
    const [failed, setFailed] = useState(false);
    const [tick, setTick] = useState(0);
    const received = useRef(0);
    useEffect(() => {
        if (!visible)
            return;
        let stopped = false;
        let timer;
        let controller;
        const poll = async () => {
            if (stopped || document.hidden)
                return;
            controller = new AbortController();
            const timeout = setTimeout(() => controller?.abort(), 5000);
            try {
                const next = await actions.read(controller.signal);
                if (!stopped) {
                    received.current = performance.now();
                    setSnapshot(next);
                    setFailed(false);
                }
            }
            catch {
                if (!stopped)
                    setFailed(true);
            }
            finally {
                clearTimeout(timeout);
                controller = undefined;
                if (!stopped)
                    timer = setTimeout(poll, 1000);
            }
        };
        const visibility = () => {
            clearTimeout(timer);
            if (document.hidden)
                controller?.abort();
            else if (!controller)
                void poll();
        };
        document.addEventListener("visibilitychange", visibility);
        void poll();
        return () => {
            stopped = true;
            clearTimeout(timer);
            controller?.abort();
            document.removeEventListener("visibilitychange", visibility);
        };
    }, [actions.read, visible]);
    useEffect(() => {
        if (!visible || !snapshot || snapshot.finished_at || failed)
            return;
        const timer = setInterval(() => setTick((value) => value + 1), 1000);
        return () => clearInterval(timer);
    }, [snapshot?.run_id, snapshot?.finished_at, visible, failed]);
    void tick;
    const now = snapshot
        ? Date.parse(snapshot.server_now) +
            (failed || snapshot.finished_at
                ? 0
                : performance.now() - received.current)
        : Date.now();
    return { snapshot, failed, now };
}
function StepFlow({ steps, now, details = false, }) {
    return (_jsx("ol", { className: "dsh-test-flow", "aria-label": "\u6D4B\u8BD5\u4E1A\u52A1\u6B65\u9AA4", children: steps.map((step, index) => (_jsxs("li", { className: `dsh-test-${tone(step.status)}`, "data-test-step": step.id, "data-step-status": step.status, "aria-current": step.status === "RUNNING" ? "step" : undefined, children: [_jsx("span", { className: "dsh-test-node", "aria-hidden": "true", children: ["PASS", "SUCCEEDED"].includes(step.status) ? (_jsx(IconCheckOutlineRegular, { size: 16 })) : ["FAIL", "ERROR", "BLOCKED", "INCONCLUSIVE"].includes(step.status) ? (_jsx(IconWarningOutlineRegular, { size: 16 })) : (index + 1) }), _jsx("span", { className: "dsh-test-step-name", children: step.description }), _jsxs("span", { className: "dsh-test-step-time", children: [statusLabels[step.status] ?? step.status, step.started_at ? ` · ${duration(elapsed(step, now))}` : ""] }), details && step.checks.length > 0 && (_jsx("ul", { className: "dsh-test-checks", children: step.checks.map((check, i) => (_jsxs("li", { children: [check.text, " \u00B7 ", statusLabels[check.status] ?? check.status] }, i))) })), details && step.reason && (_jsx("div", { className: "dsh-test-reason", children: step.reason }))] }, step.id))) }));
}
function Heading({ state, now, failed, }) {
    const total = Math.max(0, Date.parse(state.finished_at ?? new Date(now).toISOString()) -
        Date.parse(state.created_at));
    return (_jsxs("div", { className: "dsh-test-heading", children: [_jsx("strong", { className: "dsh-test-phase", children: failed ? "连接暂不可用" : phaseLabels[state.phase] }), _jsxs("span", { children: [state.settled_steps, " / ", state.total_steps, " \u6B65\u5DF2\u7ED3\u7B97"] }), _jsxs("span", { className: "dsh-test-time", children: ["\u5DF2\u7528 ", duration(total)] })] }));
}
export function ProgressDock(props) {
    const notice = useSyncExternalStore(props.notice.subscribe, props.notice.getSnapshot);
    const { snapshot, failed, now } = useProgress(props);
    useEffect(() => {
        if (snapshot && !failed)
            props.followPreview(snapshot);
    }, [snapshot, failed, props.followPreview]);
    return (_jsxs(_Fragment, { children: [notice && (_jsxs("section", { className: "dsh-test-command-notice", "data-test-command-notice": true, "aria-label": "\u6D4B\u8BD5\u547D\u4EE4\u63D0\u793A", children: [_jsx("p", { role: "alert", children: notice }), _jsx("div", { className: "dsh-test-actions", children: _jsx("button", { type: "button", onClick: props.notice.dismiss, children: "\u5173\u95ED\u63D0\u793A" }) })] })), snapshot && (_jsx(ProgressCard, { snapshot: snapshot, now: now, failed: failed, actions: props }))] }));
}
/** 原生审核接管输入区时，标题旁的入口仍可查看步骤和持续观察状态。 */
export function ProgressHeader(props) {
    const { snapshot, failed } = useProgress(props);
    useEffect(() => {
        if (snapshot && !failed)
            props.followPreview(snapshot);
    }, [snapshot, failed, props.followPreview]);
    if (!snapshot)
        return null;
    return (_jsxs("button", { type: "button", className: "dsh-test-header", "aria-label": "\u67E5\u770B\u6D4B\u8BD5\u8FDB\u5EA6", onClick: props.openDetails, title: failed
            ? "连接暂不可用"
            : `${phaseLabels[snapshot.phase]} · ${snapshot.settled_steps}/${snapshot.total_steps} 步已结算`, "data-test-progress-header": true, children: ["\u6D4B\u8BD5\u8FDB\u5EA6", " ", _jsxs("span", { children: [snapshot.settled_steps, "/", snapshot.total_steps] })] }));
}
export function ProgressDetails(props) {
    const info = props.useTabInfo();
    const { snapshot, failed, now } = useProgress(props, info.tab.visible);
    const [selected, setSelected] = useState();
    useEffect(() => setSelected(undefined), [snapshot?.run_id]);
    if (!snapshot)
        return _jsx("p", { className: "dsh-test-preview-message", children: "\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u6D4B\u8BD5\u8BA1\u5212" });
    const instance = snapshot.instances.find((entry) => entry.id === selected) ??
        selectedInstance(snapshot);
    return (_jsxs("section", { className: "dsh-test-details", "aria-label": "\u6D4B\u8BD5\u6B65\u9AA4\u8BE6\u60C5", children: [_jsx("h2", { children: snapshot.title }), _jsx(Heading, { state: snapshot, now: now, failed: failed }), snapshot.rationale && (_jsx("p", { className: "dsh-test-muted", children: snapshot.rationale })), snapshot.instances.length > 1 && (_jsx("select", { "aria-label": "\u67E5\u770B\u6D4B\u8BD5\u5B9E\u4F8B", value: instance?.id ?? "", onChange: (event) => setSelected(event.target.value), children: snapshot.instances.map((entry, i) => (_jsxs("option", { value: entry.id, children: [i + 1, ". ", entry.name, " \u00B7 ", entry.data_id, " \u00B7", " ", statusLabels[entry.status] ?? entry.status] }, entry.id))) })), instance && (_jsxs(_Fragment, { children: [_jsx(StepFlow, { steps: instance.steps, now: now, details: true }), ["setup", "cleanup"].map((phase) => instance[phase].length > 0 && (_jsxs("details", { children: [_jsx("summary", { children: phase === "setup" ? "环境准备" : "资源清理" }), instance[phase].map((step) => (_jsxs("p", { children: [step.description, " \u00B7", " ", statusLabels[step.status] ?? step.status, " \u00B7", " ", duration(elapsed(step, now))] }, step.id)))] }, phase)))] })), _jsxs("div", { className: "dsh-test-actions", children: [snapshot.preview.ready && (_jsx("button", { type: "button", onClick: () => props.openPreview(snapshot), children: "\u67E5\u770B\u5B9E\u65F6\u753B\u9762" })), snapshot.report_url && (_jsx("a", { href: snapshot.report_url, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u6D4B\u8BD5\u62A5\u544A" })), _jsx("small", { children: "\u65F6\u95F4\u5305\u542B\u7B49\u5F85" })] })] }));
}
export function PreviewPanel(props) {
    const info = props.useTabInfo();
    const { snapshot, failed } = useProgress(props, info.tab.visible);
    useEffect(() => {
        if (snapshot?.phase === "finished" || snapshot === null)
            info.tab.actions.close();
    }, [snapshot?.phase, snapshot === null, info.tab.actions]);
    return (_jsx("section", { className: "dsh-test-preview", "data-test-browser-preview": true, "aria-label": "\u6D4F\u89C8\u5668\u5B9E\u65F6\u753B\u9762", children: snapshot?.preview.ready && snapshot.preview.src && !failed ? (_jsx("iframe", { title: "\u6D4F\u89C8\u5668\u5B9E\u65F6\u753B\u9762", src: snapshot.preview.src, sandbox: "allow-scripts allow-same-origin" })) : (_jsx("p", { className: "dsh-test-preview-message", children: failed
                ? "画面连接暂不可用"
                : (snapshot?.preview.reason ?? "正在连接当前浏览器画面") })) }));
}
