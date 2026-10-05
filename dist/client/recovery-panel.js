import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** 仅在测试插件设置页读取环境状态，用户确认后才执行资源恢复。 */
import { useEffect, useState } from "react";
function elapsed(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60)
        return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes} 分 ${seconds % 60} 秒`;
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
export function RecoveryPanel({ readRecovery, recover, releaseEvidence, }) {
    const [state, setState] = useState();
    const [failed, setFailed] = useState(false);
    const [confirmation, setConfirmation] = useState();
    const [checked, setChecked] = useState(false);
    const [pending, setPending] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState(false);
    const [evidenceFile, setEvidenceFile] = useState("");
    const [evidenceConfirmation, setEvidenceConfirmation] = useState();
    useEffect(() => {
        const controller = new AbortController();
        let timer;
        const poll = async () => {
            try {
                const next = await readRecovery(AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]));
                if (controller.signal.aborted)
                    return;
                setState(next);
                setFailed(false);
            }
            catch {
                if (!controller.signal.aborted)
                    setFailed(true);
            }
            if (!controller.signal.aborted)
                timer = setTimeout(poll, 1000);
        };
        void poll();
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [readRecovery]);
    const quarantine = state?.quarantine;
    useEffect(() => {
        if (quarantine?.token) {
            setMessage("");
            setError(false);
        }
    }, [quarantine?.token]);
    useEffect(() => {
        if (confirmation !== quarantine?.token) {
            setConfirmation(undefined);
            setChecked(false);
        }
    }, [quarantine?.token, confirmation]);
    const release = async () => {
        if (!checked ||
            !quarantine?.can_recover ||
            confirmation !== quarantine.token ||
            pending ||
            failed)
            return;
        setPending(true);
        setMessage("正在关闭测试专用浏览器并停止预览，请留意宿主的工具审批。");
        setError(false);
        try {
            setMessage(await recover(quarantine.token));
            setConfirmation(undefined);
            setChecked(false);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
            setError(true);
        }
        finally {
            setPending(false);
        }
    };
    const submitEvidence = async () => {
        if (!quarantine ||
            evidenceConfirmation !== quarantine.token ||
            !evidenceFile.trim() ||
            pending ||
            failed ||
            state?.recovering)
            return;
        setPending(true);
        setMessage("");
        setError(false);
        try {
            setMessage(await releaseEvidence(evidenceFile.trim(), quarantine.token));
            setEvidenceConfirmation(undefined);
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
            setError(true);
        }
        finally {
            setPending(false);
        }
    };
    return (_jsxs("section", { className: "dsh-test-recovery", "data-test-recovery": true, "data-state": quarantine || failed ? "blocked" : "ready", "aria-label": "\u6D4B\u8BD5\u73AF\u5883\u5904\u7F6E", children: [!state && !failed && _jsx("p", { children: "\u6B63\u5728\u8BFB\u53D6\u6D4B\u8BD5\u73AF\u5883\u72B6\u6001\u2026" }), state && !quarantine && !failed && !message && (_jsx("p", { role: "status", children: "\u6D4B\u8BD5\u73AF\u5883\u5DF2\u5C31\u7EEA\uFF0C\u65E0\u9700\u91CA\u653E\u3002" })), failed && _jsx("p", { role: "alert", children: "\u65E0\u6CD5\u8BFB\u53D6\u6D4B\u8BD5\u73AF\u5883\u72B6\u6001\uFF0C\u8BF7\u68C0\u67E5\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002" }), quarantine && (_jsxs(_Fragment, { children: [_jsxs("div", { role: "alert", children: [_jsx("strong", { children: quarantine.overdue ? "测试环境可能异常卡住" : "测试环境需要处理" }), _jsx("p", { children: quarantine.reason }), _jsxs("p", { children: [quarantine.elapsed_ms === undefined
                                        ? "隔离开始时间无法确认。"
                                        : `隔离已持续 ${elapsed(quarantine.elapsed_ms)}；清理超时阈值为 ${elapsed(quarantine.timeout_ms)}。`, quarantine.overdue && " 已超过阈值，请确认是否处理并释放。"] })] }), quarantine.run_id && (_jsxs("details", { children: [_jsx("summary", { children: "\u67E5\u770B\u9057\u7559\u6D4B\u8BD5" }), _jsx("code", { children: quarantine.run_id })] })), quarantine.unavailable_reason && (_jsx("p", { children: quarantine.unavailable_reason })), state?.last_error && !message && (_jsx("p", { role: "alert", children: state.last_error })), confirmation === quarantine.token ? (_jsxs("div", { className: "dsh-test-recovery-confirm", role: "group", "aria-label": "\u91CA\u653E\u9694\u79BB\u786E\u8BA4", children: [_jsx("strong", { children: "\u662F\u5426\u5173\u95ED\u6D4B\u8BD5\u4E13\u7528\u6D4F\u89C8\u5668\u5E76\u91CA\u653E\u9694\u79BB\uFF1F" }), _jsx("p", { children: "\u8FD9\u4F1A\u5173\u95ED\u4E13\u7528 Playwright \u6D4F\u89C8\u5668\u548C\u9884\u89C8\u3002\u65E7\u6D4B\u8BD5\u7684\u9519\u8BEF\u4E0E\u62A5\u544A\u4F1A\u4FDD\u7559\uFF1B\u6210\u529F\u540E\u9700\u8981\u91CD\u65B0\u53D1\u9001\u7528\u4F8B\u3002" }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: checked, disabled: pending, onChange: (event) => setChecked(event.target.checked) }), "\u6211\u5DF2\u786E\u8BA4\u65E7\u6D4B\u8BD5\u53CA\u5176\u4ED6\u5916\u90E8\u64CD\u4F5C\u5DF2\u505C\u6B62\uFF0C\u5141\u8BB8\u5173\u95ED\u6D4B\u8BD5\u4E13\u7528\u6D4F\u89C8\u5668\u3002"] }), _jsxs("div", { className: "dsh-test-actions", children: [_jsx("button", { type: "button", disabled: !checked || pending || failed || !quarantine.can_recover, onClick: () => void release(), children: "\u786E\u8BA4\u5173\u95ED\u5E76\u91CA\u653E" }), _jsx("button", { type: "button", disabled: pending, onClick: () => {
                                            setConfirmation(undefined);
                                            setChecked(false);
                                        }, children: "\u6682\u4E0D\u91CA\u653E" })] })] })) : (_jsx("div", { className: "dsh-test-actions", children: _jsx("button", { type: "button", disabled: pending || failed || !quarantine.can_recover, onClick: () => {
                                setConfirmation(quarantine.token);
                                setChecked(false);
                                setMessage("");
                            }, children: "\u5904\u7406\u5E76\u91CA\u653E" }) })), _jsxs("details", { className: "dsh-test-command-advanced", children: [_jsx("summary", { children: "\u9AD8\u7EA7\u5904\u7F6E\uFF1A\u63D0\u4EA4\u5B9E\u9645\u5904\u7F6E\u8BC1\u636E" }), _jsx("p", { children: "\u65E0\u6CD5\u81EA\u52A8\u5173\u95ED\u6D4F\u89C8\u5668\u65F6\uFF0C\u5148\u5728\u5916\u90E8\u505C\u6B62\u65E7\u4EFB\u52A1\u5E76\u91CD\u7F6E\u5BF9\u5E94\u73AF\u5883\uFF0C\u518D\u6309\u6545\u969C\u6392\u67E5\u6307\u5357\u51C6\u5907\u8BC1\u636E\u6587\u4EF6\u3002\u63D0\u4EA4\u53EA\u8BB0\u5F55\u4F60\u7684\u5904\u7F6E\u7ED3\u679C\uFF0C\u4E0D\u4F1A\u66FF\u4F60\u5173\u95ED\u7A0B\u5E8F\u3002" }), _jsx("label", { htmlFor: "dsh-test-release-file", children: "\u5DE5\u4F5C\u533A\u5185\u7684\u5904\u7F6E\u8BC1\u636E JSON \u6587\u4EF6" }), _jsx("input", { id: "dsh-test-release-file", value: evidenceFile, disabled: pending, placeholder: "\u4F8B\u5982 recovery-evidence.json", onChange: (event) => {
                                    setEvidenceFile(event.target.value);
                                    setEvidenceConfirmation(undefined);
                                } }), _jsxs("label", { className: "dsh-test-setting-switch", children: [_jsx("input", { type: "checkbox", checked: evidenceConfirmation === quarantine.token, disabled: pending || failed || state?.recovering, onChange: (event) => setEvidenceConfirmation(event.target.checked ? quarantine.token : undefined) }), "\u6211\u5DF2\u505C\u6B62\u65E7\u4EFB\u52A1\u3001\u91CD\u7F6E\u5916\u90E8\u73AF\u5883\uFF0C\u5E76\u586B\u5199\u5B9E\u9645\u5904\u7F6E\u8BC1\u636E\u3002"] }), _jsx("div", { className: "dsh-test-setting-actions", children: _jsx("button", { type: "button", disabled: evidenceConfirmation !== quarantine.token ||
                                        !evidenceFile.trim() ||
                                        pending ||
                                        failed ||
                                        state?.recovering, onClick: () => void submitEvidence(), children: pending ? "正在处理…" : "提交证据并解除隔离" }) })] })] })), message && _jsx("p", { role: error ? "alert" : "status", children: message })] }));
}
