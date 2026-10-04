/** 仅在测试插件设置页读取环境状态，用户确认后才执行资源恢复。 */
import { useEffect, useState } from "react";
import type { RecoverySnapshot } from "../recovery.js";

export interface RecoveryActions {
  readRecovery: (signal: AbortSignal) => Promise<RecoverySnapshot>;
  recover: (token: string) => Promise<string>;
}
function elapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

export function RecoveryPanel({ readRecovery, recover }: RecoveryActions) {
  const [state, setState] = useState<RecoverySnapshot>();
  const [failed, setFailed] = useState(false);
  const [confirmation, setConfirmation] = useState<string>();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await readRecovery(
          AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        );
        if (controller.signal.aborted) return;
        setState(next);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [readRecovery]);
  const quarantine = state?.quarantine;
  useEffect(() => {
    if (confirmation !== quarantine?.token) {
      setConfirmation(undefined);
      setChecked(false);
    }
  }, [quarantine?.token, confirmation]);
  const release = async () => {
    if (!checked || !quarantine?.can_recover || pending || failed) return;
    setPending(true);
    setMessage("正在关闭测试专用浏览器并停止预览，请留意宿主的工具审批。");
    setError(false);
    try {
      setMessage(await recover(quarantine.token));
      setConfirmation(undefined);
      setChecked(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      className="dsh-test-recovery"
      data-test-recovery
      data-state={quarantine || failed ? "blocked" : "ready"}
      aria-label="测试环境处置"
    >
      {!state && !failed && <p>正在读取测试环境状态…</p>}
      {state && !quarantine && !failed && !message && (
        <p role="status">测试环境已就绪，无需释放。</p>
      )}
      {failed && <p role="alert">无法读取测试环境状态，请检查连接后重试。</p>}
      {quarantine && (
        <>
          <div role="alert">
            <strong>
              {quarantine.overdue ? "测试环境可能异常卡住" : "测试环境需要处理"}
            </strong>
            <p>{quarantine.reason}</p>
            <p>
              {quarantine.elapsed_ms === undefined
                ? "隔离开始时间无法确认。"
                : `隔离已持续 ${elapsed(quarantine.elapsed_ms)}；清理超时阈值为 ${elapsed(quarantine.timeout_ms)}。`}
              {quarantine.overdue && " 已超过阈值，请确认是否处理并释放。"}
            </p>
          </div>
          {quarantine.run_id && (
            <details>
              <summary>查看遗留测试</summary>
              <code>{quarantine.run_id}</code>
            </details>
          )}
          {quarantine.unavailable_reason && (
            <p>{quarantine.unavailable_reason}</p>
          )}
          {state?.last_error && !message && (
            <p role="alert">{state.last_error}</p>
          )}
          {confirmation === quarantine.token ? (
            <div
              className="dsh-test-recovery-confirm"
              role="group"
              aria-label="释放隔离确认"
            >
              <strong>是否关闭测试专用浏览器并释放隔离？</strong>
              <p>
                这会关闭专用 Playwright
                浏览器和预览。旧测试的错误与报告会保留；成功后需要重新发送用例。
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={pending}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                我已确认旧测试及其他外部操作已停止，允许关闭测试专用浏览器。
              </label>
              <div className="dsh-test-actions">
                <button
                  type="button"
                  disabled={
                    !checked || pending || failed || !quarantine.can_recover
                  }
                  onClick={() => void release()}
                >
                  确认关闭并释放
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirmation(undefined);
                    setChecked(false);
                  }}
                >
                  暂不释放
                </button>
              </div>
            </div>
          ) : (
            <div className="dsh-test-actions">
              <button
                type="button"
                disabled={failed || !quarantine.can_recover}
                onClick={() => {
                  setConfirmation(quarantine.token);
                  setChecked(false);
                  setMessage("");
                }}
              >
                处理并释放
              </button>
            </div>
          )}
        </>
      )}
      {message && <p role={error ? "alert" : "status"}>{message}</p>}
    </section>
  );
}
