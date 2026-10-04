/** 会话进度与只读画面组件；所有业务状态来自服务端快照。 */
import { useEffect, useRef, useState } from "react";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {
  ProgressCase,
  ProgressSnapshot,
  ProgressStep,
} from "../progress-model.js";
import { RecoveryPanel, type RecoveryActions } from "./recovery-panel.js";

export interface ProgressActions extends RecoveryActions {
  read: (signal: AbortSignal) => Promise<ProgressSnapshot | null>;
  openDetails: () => void;
  openPreview: (state: ProgressSnapshot) => void;
  followPreview: (state: ProgressSnapshot) => void;
}
const phaseLabels = {
  planning: "正在规划",
  reviewing: "等待计划审核",
  executing: "执行中",
  stopping: "正在停止",
  cleanup: "正在清理",
  finished: "已结束",
  interrupted: "已中断",
};
const statusLabels: Record<string, string> = {
  PENDING: "待执行",
  RUNNING: "运行中",
  SUCCEEDED: "已完成",
  PASS: "通过",
  FAIL: "失败",
  ERROR: "错误",
  BLOCKED: "阻塞",
  SKIPPED: "跳过",
  CANCELLED: "取消",
  INCONCLUSIVE: "结论不足",
};
export function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}
function elapsed(step: ProgressStep, now: number): number {
  return step.started_at && !step.finished_at && step.status === "RUNNING"
    ? Math.max(0, now - Date.parse(step.started_at))
    : step.duration_ms;
}
function tone(status: string): string {
  return status === "RUNNING"
    ? "running"
    : ["PASS", "SUCCEEDED"].includes(status)
      ? "pass"
      : ["FAIL", "ERROR", "INCONCLUSIVE"].includes(status)
        ? "error"
        : "muted";
}
function useProgress(actions: ProgressActions, visible = true) {
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>();
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const received = useRef(0);
  useEffect(() => {
    if (!visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (stopped || document.hidden) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5000);
      try {
        const next = await actions.read(controller.signal);
        if (!stopped) {
          received.current = performance.now();
          setSnapshot(next);
          setFailed(false);
        }
      } catch {
        if (!stopped) setFailed(true);
      } finally {
        clearTimeout(timeout);
        controller = undefined;
        if (!stopped) timer = setTimeout(poll, 1000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else if (!controller) void poll();
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
    if (!visible || !snapshot || snapshot.finished_at || failed) return;
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
function selectedInstance(
  snapshot: ProgressSnapshot,
): ProgressCase | undefined {
  return (
    snapshot.instances.find(
      (instance) => instance.id === snapshot.current_instance_id,
    ) ??
    snapshot.instances.find((instance) => instance.status === "RUNNING") ??
    snapshot.instances[0]
  );
}
function StepFlow({
  steps,
  now,
  details = false,
}: {
  steps: ProgressStep[];
  now: number;
  details?: boolean;
}) {
  return (
    <ol className="dsh-test-flow" aria-label="测试业务步骤">
      {steps.map((step, index) => (
        <li
          className={`dsh-test-${tone(step.status)}`}
          key={step.id}
          data-test-step={step.id}
          data-step-status={step.status}
          aria-current={step.status === "RUNNING" ? "step" : undefined}
        >
          <span className="dsh-test-node" aria-hidden="true">
            {["PASS", "SUCCEEDED"].includes(step.status)
              ? "✓"
              : ["FAIL", "ERROR"].includes(step.status)
                ? "!"
                : index + 1}
          </span>
          <span className="dsh-test-step-name">{step.description}</span>
          <span className="dsh-test-step-time">
            {statusLabels[step.status] ?? step.status}
            {step.started_at ? ` · ${duration(elapsed(step, now))}` : ""}
          </span>
          {details && step.checks.length > 0 && (
            <ul className="dsh-test-checks">
              {step.checks.map((check, i) => (
                <li key={i}>
                  {check.text} · {statusLabels[check.status] ?? check.status}
                </li>
              ))}
            </ul>
          )}
          {details && step.reason && (
            <div className="dsh-test-reason">{step.reason}</div>
          )}
        </li>
      ))}
    </ol>
  );
}
function Heading({
  state,
  now,
  failed,
}: {
  state: ProgressSnapshot;
  now: number;
  failed: boolean;
}) {
  const total = Math.max(
    0,
    Date.parse(state.finished_at ?? new Date(now).toISOString()) -
      Date.parse(state.created_at),
  );
  return (
    <div className="dsh-test-heading">
      <strong className="dsh-test-phase">
        {failed ? "连接暂不可用" : phaseLabels[state.phase]}
      </strong>
      <span>
        {state.settled_steps} / {state.total_steps} 步已结算
      </span>
      <span className="dsh-test-time">已用 {duration(total)}</span>
    </div>
  );
}

export function ProgressDock(
  props: PropsRuntime<"conversation.input.dock"> & InjectFace<ProgressActions>,
) {
  const { snapshot, failed, now } = useProgress(props);
  useEffect(() => {
    if (snapshot && !failed) props.followPreview(snapshot);
  }, [snapshot, failed, props.followPreview]);
  const instance = snapshot ? selectedInstance(snapshot) : undefined;
  return (
    <>
      <RecoveryPanel
        readRecovery={props.readRecovery}
        recover={props.recover}
      />
      {snapshot && (
        <section
          className="dsh-test-dock"
          data-test-progress
          data-run-id={snapshot.run_id}
          aria-label="测试执行进度"
        >
          <Heading state={snapshot} now={now} failed={failed} />
          <div className="dsh-test-title" title={snapshot.title}>
            {snapshot.title}
            {snapshot.instances.length > 1 && instance
              ? ` · 用例 ${snapshot.instances.indexOf(instance) + 1} / ${snapshot.instances.length}`
              : ""}
          </div>
          {instance?.steps.length ? (
            <StepFlow steps={instance.steps} now={now} />
          ) : (
            <span className="dsh-test-muted">正在拆分测试步骤</span>
          )}
          <div className="dsh-test-actions">
            <button type="button" onClick={props.openDetails}>
              查看步骤
            </button>
            {snapshot.preview.ready && !failed && (
              <button type="button" onClick={() => props.openPreview(snapshot)}>
                实时画面
              </button>
            )}
            {snapshot.report_url && (
              <a href={snapshot.report_url} target="_blank" rel="noreferrer">
                测试报告
              </a>
            )}
            <small>时间包含等待</small>
          </div>
        </section>
      )}
    </>
  );
}

/** 原生审核接管输入区时，标题旁的入口仍可查看步骤和持续观察状态。 */
export function ProgressHeader(
  props: PropsRuntime<"conversation.session.header.actions"> &
    InjectFace<ProgressActions>,
) {
  const { snapshot, failed } = useProgress(props);
  useEffect(() => {
    if (snapshot && !failed) props.followPreview(snapshot);
  }, [snapshot, failed, props.followPreview]);
  if (!snapshot) return null;
  return (
    <button
      type="button"
      className="dsh-test-header"
      aria-label="查看测试进度"
      onClick={props.openDetails}
      title={
        failed
          ? "连接暂不可用"
          : `${phaseLabels[snapshot.phase]} · ${snapshot.settled_steps}/${snapshot.total_steps} 步已结算`
      }
      data-test-progress-header
    >
      测试进度{" "}
      <span>
        {snapshot.settled_steps}/{snapshot.total_steps}
      </span>
    </button>
  );
}
export function ProgressDetails(
  props: PropsRuntime<"sidebar.right.pane.tab"> & InjectFace<ProgressActions>,
) {
  const info = props.useTabInfo();
  const { snapshot, failed, now } = useProgress(props, info.tab.visible);
  const [selected, setSelected] = useState<string>();
  useEffect(() => setSelected(undefined), [snapshot?.run_id]);
  if (!snapshot)
    return <p className="dsh-test-preview-message">当前会话还没有测试计划</p>;
  const instance =
    snapshot.instances.find((entry) => entry.id === selected) ??
    selectedInstance(snapshot);
  return (
    <section className="dsh-test-details" aria-label="测试步骤详情">
      <h2>{snapshot.title}</h2>
      <Heading state={snapshot} now={now} failed={failed} />
      {snapshot.rationale && (
        <p className="dsh-test-muted">{snapshot.rationale}</p>
      )}
      {snapshot.instances.length > 1 && (
        <select
          aria-label="查看测试实例"
          value={instance?.id ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {snapshot.instances.map((entry, i) => (
            <option key={entry.id} value={entry.id}>
              {i + 1}. {entry.name} · {entry.data_id} ·{" "}
              {statusLabels[entry.status] ?? entry.status}
            </option>
          ))}
        </select>
      )}
      {instance && (
        <>
          <StepFlow steps={instance.steps} now={now} details />
          {(["setup", "cleanup"] as const).map(
            (phase) =>
              instance[phase].length > 0 && (
                <details key={phase}>
                  <summary>
                    {phase === "setup" ? "环境准备" : "资源清理"}
                  </summary>
                  {instance[phase].map((step) => (
                    <p key={step.id}>
                      {step.description} ·{" "}
                      {statusLabels[step.status] ?? step.status} ·{" "}
                      {duration(elapsed(step, now))}
                    </p>
                  ))}
                </details>
              ),
          )}
        </>
      )}
      <div className="dsh-test-actions">
        {snapshot.preview.ready && (
          <button type="button" onClick={() => props.openPreview(snapshot)}>
            查看实时画面
          </button>
        )}
        {snapshot.report_url && (
          <a href={snapshot.report_url} target="_blank" rel="noreferrer">
            查看测试报告
          </a>
        )}
        <small>时间包含等待</small>
      </div>
    </section>
  );
}
export function PreviewPanel(
  props: PropsRuntime<"sidebar.right.pane.tab"> & InjectFace<ProgressActions>,
) {
  const info = props.useTabInfo();
  const { snapshot, failed } = useProgress(props, info.tab.visible);
  useEffect(() => {
    if (snapshot?.phase === "finished" || snapshot === null)
      info.tab.actions.close();
  }, [snapshot?.phase, snapshot === null, info.tab.actions]);
  return (
    <section
      className="dsh-test-preview"
      data-test-browser-preview
      aria-label="浏览器实时画面"
    >
      {snapshot?.preview.ready && snapshot.preview.src && !failed ? (
        <iframe
          title="浏览器实时画面"
          src={snapshot.preview.src}
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <p className="dsh-test-preview-message">
          {failed
            ? "画面连接暂不可用"
            : (snapshot?.preview.reason ?? "正在连接当前浏览器画面")}
        </p>
      )}
    </section>
  );
}
