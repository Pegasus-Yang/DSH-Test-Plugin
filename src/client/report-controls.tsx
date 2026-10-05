/** 结束后的报告按原始记录重建；设置页允许指定历史运行。 */
import { useEffect, useState } from "react";
import type { ReportResult } from "../test-ui-access.js";

export interface ReportActions {
  rebuildReport: (runId?: string) => Promise<ReportResult>;
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
  return (
    <section data-test-report-settings>
      <h2>测试报告</h2>
      <p>
        报告缺失或需要重新生成时，可根据已结束或中断测试的原始记录重建，不会重新执行用例。
      </p>
      <label htmlFor="dsh-test-report-run">运行 ID（可选）</label>
      <input
        id="dsh-test-report-run"
        value={runId}
        placeholder="run-…；留空使用当前对话的报告"
        onChange={(event) => setRunId(event.target.value)}
      />
      <p className="dsh-test-setting-hint">
        运行 ID
        可在测试报告或结果目录中找到。仍在执行的测试不能重建；中断记录会明确标记结果不完整。
      </p>
      <div className="dsh-test-setting-actions">
        <RebuildReport {...actions} runId={runId.trim()} />
      </div>
    </section>
  );
}
