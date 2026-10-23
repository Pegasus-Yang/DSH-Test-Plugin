/** 结束后的报告按原始记录重建；设置页允许指定历史运行。 */
import { useEffect, useRef, useState } from "react";
import type { ReportResult, ReportTarget } from "../test-ui-access.js";

export interface ReportActions {
  rebuildReport: (runId?: string) => Promise<ReportResult>;
  describeReport?: (runId?: string) => Promise<ReportTarget>;
}

export function RebuildReport({
  rebuildReport,
  runId,
}: ReportActions & { runId?: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ReportResult>();
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
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="dsh-test-report-control">
      <button type="button" disabled={pending} onClick={() => void rebuild()}>
        {pending ? "正在重建…" : "重建报告"}
      </button>
      {result && (
        <a
          href={result.url}
          target="_blank"
          rel="noreferrer"
          title={result.path}
        >
          查看重建报告
        </a>
      )}
      {error && <span role="alert">{error}</span>}
    </span>
  );
}

export function ReportSettings(actions: ReportActions) {
  const [runId, setRunId] = useState("");
  const [target, setTarget] = useState<ReportTarget>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  return (
    <details data-test-report-settings className="dsh-test-report-maintenance">
      <summary>报告维护：重建历史报告</summary>
      <p>
        报告缺失或需要重新生成时，可根据已结束或中断测试的原始记录重建，不会重新执行用例。
      </p>
      <label htmlFor="dsh-test-report-run">运行 ID（可选）</label>
      <input
        id="dsh-test-report-run"
        value={runId}
        placeholder="run-…；留空使用当前对话的报告"
        onChange={(event) => {
          generation.current++;
          setRunId(event.target.value);
          setTarget(undefined);
          setError("");
          setPending(false);
        }}
      />
      <p className="dsh-test-setting-hint">
        运行 ID
        可在测试报告或结果目录中找到。仍在执行的测试不能重建；中断记录会明确标记结果不完整。
      </p>
      <div className="dsh-test-setting-actions">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const current = ++generation.current;
            setPending(true);
            setError("");
            setTarget(undefined);
            void actions
              .describeReport?.(runId.trim() || undefined)
              .then((value) => {
                if (current === generation.current) setTarget(value);
              })
              .catch((error) => {
                if (current === generation.current)
                  setError((error as Error).message);
              })
              .finally(() => {
                if (current === generation.current) setPending(false);
              });
          }}
        >
          {pending ? "正在读取…" : "读取目标运行"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {target && (
        <div className="dsh-test-command-check" role="status">
          <strong>将重建：{target.name}</strong>
          <p>运行 ID：{target.run_id}</p>
          <p>记录状态：{target.lifecycle}</p>
          {target.can_rebuild ? (
            <RebuildReport {...actions} runId={target.run_id} />
          ) : (
            <p>该测试仍在执行，结束或中断后才能重建。</p>
          )}
        </div>
      )}
    </details>
  );
}
