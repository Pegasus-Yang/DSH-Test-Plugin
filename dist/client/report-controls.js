import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** 结束后的报告按原始记录重建；设置页允许指定历史运行。 */
import { useEffect, useRef, useState } from "react";
export function RebuildReport({ rebuildReport, runId, }) {
    const [pending, setPending] = useState(false);
    const [result, setResult] = useState();
    const [error, setError] = useState("");
    useEffect(() => {
        setResult(undefined);
        setError("");
    }, [runId]);
    const rebuild = async () => {
        setPending(true);
        setError("");
        setResult(undefined);
        try {
            setResult(await rebuildReport(runId));
        }
        catch (error) {
            setError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setPending(false);
        }
    };
    return (_jsxs("span", { className: "dsh-test-report-control", children: [_jsx("button", { type: "button", disabled: pending, onClick: () => void rebuild(), children: pending ? "正在重建…" : "重建报告" }), result && (_jsx("a", { href: result.url, target: "_blank", rel: "noreferrer", title: result.path, children: "\u67E5\u770B\u91CD\u5EFA\u62A5\u544A" })), error && _jsx("span", { role: "alert", children: error })] }));
}
export function ReportSettings(actions) {
    const [runId, setRunId] = useState("");
    const [target, setTarget] = useState();
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const generation = useRef(0);
    useEffect(() => () => {
        generation.current++;
    }, []);
    return (_jsxs("details", { "data-test-report-settings": true, className: "dsh-test-report-maintenance", children: [_jsx("summary", { children: "\u62A5\u544A\u7EF4\u62A4\uFF1A\u91CD\u5EFA\u5386\u53F2\u62A5\u544A" }), _jsx("p", { children: "\u62A5\u544A\u7F3A\u5931\u6216\u9700\u8981\u91CD\u65B0\u751F\u6210\u65F6\uFF0C\u53EF\u6839\u636E\u5DF2\u7ED3\u675F\u6216\u4E2D\u65AD\u6D4B\u8BD5\u7684\u539F\u59CB\u8BB0\u5F55\u91CD\u5EFA\uFF0C\u4E0D\u4F1A\u91CD\u65B0\u6267\u884C\u7528\u4F8B\u3002" }), _jsx("label", { htmlFor: "dsh-test-report-run", children: "\u8FD0\u884C ID\uFF08\u53EF\u9009\uFF09" }), _jsx("input", { id: "dsh-test-report-run", value: runId, placeholder: "run-\u2026\uFF1B\u7559\u7A7A\u4F7F\u7528\u5F53\u524D\u5BF9\u8BDD\u7684\u62A5\u544A", onChange: (event) => {
                    generation.current++;
                    setRunId(event.target.value);
                    setTarget(undefined);
                    setError("");
                    setPending(false);
                } }), _jsx("p", { className: "dsh-test-setting-hint", children: "\u8FD0\u884C ID \u53EF\u5728\u6D4B\u8BD5\u62A5\u544A\u6216\u7ED3\u679C\u76EE\u5F55\u4E2D\u627E\u5230\u3002\u4ECD\u5728\u6267\u884C\u7684\u6D4B\u8BD5\u4E0D\u80FD\u91CD\u5EFA\uFF1B\u4E2D\u65AD\u8BB0\u5F55\u4F1A\u660E\u786E\u6807\u8BB0\u7ED3\u679C\u4E0D\u5B8C\u6574\u3002" }), _jsx("div", { className: "dsh-test-setting-actions", children: _jsx("button", { type: "button", disabled: pending, onClick: () => {
                        const current = ++generation.current;
                        setPending(true);
                        setError("");
                        setTarget(undefined);
                        void actions
                            .describeReport?.(runId.trim() || undefined)
                            .then((value) => {
                            if (current === generation.current)
                                setTarget(value);
                        })
                            .catch((error) => {
                            if (current === generation.current)
                                setError(error.message);
                        })
                            .finally(() => {
                            if (current === generation.current)
                                setPending(false);
                        });
                    }, children: pending ? "正在读取…" : "读取目标运行" }) }), error && _jsx("p", { role: "alert", children: error }), target && (_jsxs("div", { className: "dsh-test-command-check", role: "status", children: [_jsxs("strong", { children: ["\u5C06\u91CD\u5EFA\uFF1A", target.name] }), _jsxs("p", { children: ["\u8FD0\u884C ID\uFF1A", target.run_id] }), _jsxs("p", { children: ["\u8BB0\u5F55\u72B6\u6001\uFF1A", target.lifecycle] }), target.can_rebuild ? (_jsx(RebuildReport, { ...actions, runId: target.run_id })) : (_jsx("p", { children: "\u8BE5\u6D4B\u8BD5\u4ECD\u5728\u6267\u884C\uFF0C\u7ED3\u675F\u6216\u4E2D\u65AD\u540E\u624D\u80FD\u91CD\u5EFA\u3002" }))] }))] }));
}
