import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** 当前步骤优先的底部面板；完整业务步骤只在用户展开时渲染。 */
import { useEffect, useId, useRef, useState, useSyncExternalStore, } from "react";
import { IconBrowseOutlineRegular, IconCheckCircleOutlineRegular, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconClockOutlineRegular, IconInfoOutlineRegular, IconFlatListOutlineRegular, IconLoadingOutlineRegular, IconWarningOutlineRegular, } from "@deepseek-ai/dsh-client-ui-primitives";
import { RebuildReport } from "./report-controls.js";
import { duration, elapsed, focusStep, phaseLabels, progressTone, statusLabels, stepRows, tone, } from "./progress-view.js";
export function ProgressCard({ snapshot, now, failed, actions, }) {
    const [collapsed, setCollapsed] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [inspection, setInspection] = useState();
    const [textExpanded, setTextExpanded] = useState(false);
    const [clipped, setClipped] = useState(false);
    const previewVisible = useSyncExternalStore(actions.previewVisible.subscribe, actions.previewVisible.getSnapshot, actions.previewVisible.getSnapshot);
    const description = useRef(null);
    const list = useRef(null);
    const bodyId = useId();
    const listId = useId();
    const descriptionId = useId();
    const rows = stepRows(snapshot);
    const focus = focusStep(snapshot, rows);
    const activeKey = focus.row?.key;
    const currentInstance = focus.row?.instance;
    const stateTone = progressTone(snapshot, failed);
    const StateIcon = stateTone === "error"
        ? IconWarningOutlineRegular
        : stateTone === "muted"
            ? IconInfoOutlineRegular
            : snapshot.phase === "finished"
                ? IconCheckCircleOutlineRegular
                : IconLoadingOutlineRegular;
    const total = Math.max(0, Date.parse(snapshot.finished_at ?? new Date(now).toISOString()) -
        Date.parse(snapshot.created_at));
    const ratio = snapshot.total_steps
        ? Math.min(1, snapshot.settled_steps / snapshot.total_steps)
        : 0;
    useEffect(() => {
        setCollapsed(false);
        setExpanded(false);
        setInspection(undefined);
    }, [snapshot.run_id]);
    useEffect(() => {
        setTextExpanded(false);
        setClipped(false);
    }, [focus.description]);
    useEffect(() => {
        const element = description.current;
        if (!element || textExpanded || collapsed)
            return;
        const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [focus.description, textExpanded, collapsed]);
    useEffect(() => {
        if (!expanded || inspection || !activeKey)
            return;
        const container = list.current;
        const target = container?.querySelector('[aria-current="step"]');
        if (!container || !target)
            return;
        const center = () => {
            const rect = target.getBoundingClientRect();
            container.scrollTop +=
                rect.top -
                    container.getBoundingClientRect().top -
                    (container.clientHeight - rect.height) / 2;
        };
        center();
        const observer = new ResizeObserver(center);
        observer.observe(container);
        observer.observe(target);
        return () => observer.disconnect();
    }, [expanded, activeKey, inspection, snapshot.run_id]);
    return (_jsxs("section", { className: `dsh-test-card dsh-test-card-${stateTone}`, "data-test-progress": true, "data-run-id": snapshot.run_id, "aria-label": "\u6D4B\u8BD5\u6267\u884C\u8FDB\u5EA6", children: [_jsxs("div", { className: "dsh-test-card-heading", children: [_jsxs("span", { className: "dsh-test-card-phase", children: [_jsx(StateIcon, { size: 18, className: stateTone === "running" ? "dsh-test-spin" : undefined }), failed ? "连接暂不可用" : phaseLabels[snapshot.phase]] }), _jsx("span", { className: "dsh-test-card-title", title: snapshot.title, children: snapshot.title }), _jsxs("span", { className: "dsh-test-card-time", children: [_jsx(IconClockOutlineRegular, { size: 16 }), "\u5DF2\u7528 ", duration(total)] }), _jsx("button", { className: "dsh-test-fold", type: "button", "aria-label": collapsed ? "展开测试进度" : "收起测试进度", "aria-expanded": !collapsed, "aria-controls": bodyId, onClick: () => setCollapsed(!collapsed), children: collapsed ? (_jsx(IconChevronUpOutlineRegular, { size: 18 })) : (_jsx(IconChevronDownOutlineRegular, { size: 18 })) })] }), _jsx("div", { className: "dsh-test-meter", role: "progressbar", "aria-label": "\u4E1A\u52A1\u6B65\u9AA4\u7ED3\u7B97\u8FDB\u5EA6", "aria-valuemin": 0, "aria-valuemax": snapshot.total_steps || 100, "aria-valuenow": snapshot.total_steps ? snapshot.settled_steps : undefined, children: _jsx("span", { style: { width: `${ratio * 100}%` } }) }), _jsxs("div", { className: "dsh-test-card-count", children: [snapshot.total_steps
                        ? `${snapshot.settled_steps} / ${snapshot.total_steps} 步已结算`
                        : "业务步骤尚未确定", failed && _jsx("span", { children: "\u8FDE\u63A5\u6062\u590D\u540E\u66F4\u65B0\u8FDB\u5EA6\u4E0E\u8017\u65F6" })] }), _jsxs("div", { id: bodyId, className: "dsh-test-card-body", hidden: collapsed, children: [_jsxs("div", { className: "dsh-test-focus", children: [_jsxs("div", { className: "dsh-test-focus-marker", children: [_jsx("span", { className: "dsh-test-focus-number", "aria-hidden": "true", children: focus.row ? (String(focus.row.number).padStart(2, "0")) : (_jsx(StateIcon, { size: 23 })) }), _jsxs("span", { className: "dsh-test-focus-label", children: [focus.label, snapshot.instances.length > 1 && currentInstance && (_jsxs("small", { children: ["\u7528\u4F8B ", snapshot.instances.indexOf(currentInstance) + 1, " /", " ", snapshot.instances.length] }))] })] }), _jsxs("div", { className: "dsh-test-focus-content", children: [_jsx("p", { ref: description, id: descriptionId, className: "dsh-test-focus-description", "data-expanded": textExpanded, tabIndex: textExpanded ? 0 : undefined, children: focus.description }), (clipped || textExpanded) && (_jsx("button", { type: "button", className: "dsh-test-text-toggle", "aria-expanded": textExpanded, "aria-controls": descriptionId, onClick: () => setTextExpanded(!textExpanded), children: textExpanded ? "收起文字" : "展开完整文字" })), _jsxs("div", { className: "dsh-test-focus-meta", children: [focus.step && (_jsxs("span", { children: [_jsx(IconClockOutlineRegular, { size: 14 }), statusLabels[focus.step.status] ?? focus.step.status, focus.step.started_at
                                                        ? ` · 本步 ${duration(elapsed(focus.step, now))}`
                                                        : ""] })), focus.next && (_jsxs("span", { className: "dsh-test-focus-next", title: focus.next.description, children: ["\u4E0B\u4E00\u6B65\uFF1A", focus.next.description] }))] })] })] }), _jsxs("div", { className: "dsh-test-card-actions", children: [rows.length > 0 && (_jsxs("button", { type: "button", "aria-expanded": expanded, "aria-controls": listId, onClick: () => setExpanded(!expanded), children: [_jsx(IconFlatListOutlineRegular, { size: 17 }), expanded ? "收起完整步骤" : `查看全部步骤（${rows.length}）`] })), snapshot.preview.ready &&
                                !failed &&
                                snapshot.phase !== "finished" && (_jsxs("button", { type: "button", "aria-pressed": previewVisible, onClick: () => actions.openPreview(snapshot), children: [_jsx(IconBrowseOutlineRegular, { size: 17 }), previewVisible ? "隐藏实时画面" : "显示实时画面"] })), snapshot.report_url && (_jsxs("a", { href: snapshot.report_url, target: "_blank", rel: "noreferrer", children: [_jsx(IconFlatListOutlineRegular, { size: 17 }), "\u6D4B\u8BD5\u62A5\u544A"] })), snapshot.phase === "finished" && (_jsx(RebuildReport, { rebuildReport: actions.rebuildReport, runId: snapshot.run_id })), _jsx("small", { children: "\u65F6\u95F4\u5305\u542B\u7B49\u5F85" })] }), snapshot.preview.failed &&
                        !failed &&
                        snapshot.phase !== "finished" && (_jsxs("p", { className: "dsh-test-preview-note", "data-test-preview-error": true, role: "status", children: ["\u5B9E\u65F6\u753B\u9762\u672A\u542F\u7528\uFF1A", snapshot.preview.reason, _jsx("span", { children: "\u8BF7\u8FDB\u5165\u201C\u8BBE\u7F6E \u2192 \u6D4B\u8BD5\u63D2\u4EF6 \u2192 \u6D4F\u89C8\u5668\u5B9E\u65F6\u9884\u89C8\u201D\u68C0\u6D4B\u5B89\u88C5\u6216\u8C03\u6574\u914D\u7F6E\uFF1B\u4E1A\u52A1\u6D4B\u8BD5\u7EE7\u7EED\u6267\u884C\u3002" })] })), snapshot.preview.recording_notice &&
                        !failed &&
                        snapshot.phase !== "finished" && (_jsxs("p", { className: "dsh-test-preview-note", "data-test-recording-error": true, role: "status", children: [snapshot.preview.recording_notice, _jsx("span", { children: "\u5F55\u50CF\u5F02\u5E38\u4E0D\u6539\u53D8\u4E1A\u52A1\u65AD\u8A00\uFF1B\u8BF7\u5728\u201C\u8BBE\u7F6E \u2192 \u6D4B\u8BD5\u63D2\u4EF6\u201D\u68C0\u67E5\u5B89\u88C5\u548C\u914D\u7F6E\u3002" })] })), expanded && (_jsxs("div", { className: "dsh-test-step-list", id: listId, ref: list, role: "region", "aria-label": "\u5B8C\u6574\u4E1A\u52A1\u6B65\u9AA4", tabIndex: 0, children: [_jsx("ol", { children: rows.map((row) => {
                                    const selected = inspection === row.key;
                                    const StepIcon = tone(row.step.status) === "error"
                                        ? IconWarningOutlineRegular
                                        : ["PASS", "SUCCEEDED"].includes(row.step.status)
                                            ? IconCheckCircleOutlineRegular
                                            : row.step.status === "RUNNING"
                                                ? IconLoadingOutlineRegular
                                                : undefined;
                                    return (_jsxs("li", { "data-test-step": row.step.id, "data-step-status": row.step.status, "data-tone": tone(row.step.status), children: [_jsxs("button", { type: "button", className: "dsh-test-step-row", "aria-current": activeKey === row.key ? "step" : undefined, "aria-expanded": selected, onClick: () => setInspection(selected ? undefined : row.key), children: [_jsxs("span", { className: "dsh-test-step-position", children: [StepIcon && (_jsx(StepIcon, { size: 16, className: row.step.status === "RUNNING"
                                                                    ? "dsh-test-spin"
                                                                    : undefined })), row.number] }), _jsxs("span", { className: "dsh-test-step-copy", children: [snapshot.instances.length > 1 && (_jsxs("small", { children: [row.instance.name, " \u00B7 ", row.instance.data_id] })), _jsx("span", { children: row.step.description })] }), _jsxs("span", { className: "dsh-test-step-result", children: [statusLabels[row.step.status] ?? row.step.status, row.step.started_at && (_jsx("small", { children: duration(elapsed(row.step, now)) }))] })] }), selected && (_jsxs("div", { className: "dsh-test-step-inspection", children: [_jsx("p", { children: row.step.description }), row.step.reason && _jsx("p", { children: row.step.reason }), row.step.checks.length > 0 ? (_jsx("ul", { children: row.step.checks.map((check, index) => (_jsxs("li", { children: [check.text, " \u00B7", " ", statusLabels[check.status] ?? check.status, check.reason && ` · ${check.reason}`] }, index))) })) : (_jsx("p", { children: "\u672C\u6B65\u9AA4\u6CA1\u6709\u9644\u52A0\u68C0\u67E5\u70B9\u3002" }))] }))] }, row.key));
                                }) }), _jsx("button", { className: "dsh-test-more-details", type: "button", onClick: actions.openDetails, children: "\u67E5\u770B\u51C6\u5907\u3001\u6E05\u7406\u53CA\u5B8C\u6574\u8BE6\u60C5" })] }))] })] }));
}
