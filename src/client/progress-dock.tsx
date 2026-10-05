/** 当前步骤优先的底部面板；完整业务步骤只在用户展开时渲染。 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  IconBrowseOutlineRegular,
  IconCheckCircleOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconClockOutlineRegular,
  IconInfoOutlineRegular,
  IconFlatListOutlineRegular,
  IconLoadingOutlineRegular,
  IconWarningOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ProgressSnapshot } from "../progress-model.js";
import type { ProgressActions } from "./components.js";
import { RebuildReport } from "./report-controls.js";
import {
  duration,
  elapsed,
  focusStep,
  phaseLabels,
  progressTone,
  statusLabels,
  stepRows,
  tone,
} from "./progress-view.js";

export function ProgressCard({
  snapshot,
  now,
  failed,
  actions,
}: {
  snapshot: ProgressSnapshot;
  now: number;
  failed: boolean;
  actions: ProgressActions;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [inspection, setInspection] = useState<string>();
  const [textExpanded, setTextExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const previewVisible = useSyncExternalStore(
    actions.previewVisible.subscribe,
    actions.previewVisible.getSnapshot,
    actions.previewVisible.getSnapshot,
  );
  const description = useRef<HTMLParagraphElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const listId = useId();
  const descriptionId = useId();
  const rows = stepRows(snapshot);
  const focus = focusStep(snapshot, rows);
  const activeKey = focus.row?.key;
  const currentInstance = focus.row?.instance;
  const stateTone = progressTone(snapshot, failed);
  const StateIcon =
    stateTone === "error"
      ? IconWarningOutlineRegular
      : stateTone === "muted"
        ? IconInfoOutlineRegular
        : snapshot.phase === "finished"
          ? IconCheckCircleOutlineRegular
          : IconLoadingOutlineRegular;
  const total = Math.max(
    0,
    Date.parse(snapshot.finished_at ?? new Date(now).toISOString()) -
      Date.parse(snapshot.created_at),
  );
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
    if (!element || textExpanded || collapsed) return;
    const measure = () =>
      setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [focus.description, textExpanded, collapsed]);
  useEffect(() => {
    if (!expanded || inspection || !activeKey) return;
    const container = list.current;
    const target = container?.querySelector<HTMLElement>(
      '[aria-current="step"]',
    );
    if (!container || !target) return;
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
  return (
    <section
      className={`dsh-test-card dsh-test-card-${stateTone}`}
      data-test-progress
      data-run-id={snapshot.run_id}
      aria-label="测试执行进度"
    >
      <div className="dsh-test-card-heading">
        <span className="dsh-test-card-phase">
          <StateIcon
            size={18}
            className={stateTone === "running" ? "dsh-test-spin" : undefined}
          />
          {failed ? "连接暂不可用" : phaseLabels[snapshot.phase]}
        </span>
        <span className="dsh-test-card-title" title={snapshot.title}>
          {snapshot.title}
        </span>
        <span className="dsh-test-card-time">
          <IconClockOutlineRegular size={16} />
          已用 {duration(total)}
        </span>
        <button
          className="dsh-test-fold"
          type="button"
          aria-label={collapsed ? "展开测试进度" : "收起测试进度"}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <IconChevronUpOutlineRegular size={18} />
          ) : (
            <IconChevronDownOutlineRegular size={18} />
          )}
        </button>
      </div>
      <div
        className="dsh-test-meter"
        role="progressbar"
        aria-label="业务步骤结算进度"
        aria-valuemin={0}
        aria-valuemax={snapshot.total_steps || 100}
        aria-valuenow={
          snapshot.total_steps ? snapshot.settled_steps : undefined
        }
      >
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="dsh-test-card-count">
        {snapshot.total_steps
          ? `${snapshot.settled_steps} / ${snapshot.total_steps} 步已结算`
          : "业务步骤尚未确定"}
        {failed && <span>连接恢复后更新进度与耗时</span>}
      </div>
      <div id={bodyId} className="dsh-test-card-body" hidden={collapsed}>
        <div className="dsh-test-focus">
          <div className="dsh-test-focus-marker">
            <span className="dsh-test-focus-number" aria-hidden="true">
              {focus.row ? (
                String(focus.row.number).padStart(2, "0")
              ) : (
                <StateIcon size={23} />
              )}
            </span>
            <span className="dsh-test-focus-label">
              {focus.label}
              {snapshot.instances.length > 1 && currentInstance && (
                <small>
                  用例 {snapshot.instances.indexOf(currentInstance) + 1} /{" "}
                  {snapshot.instances.length}
                </small>
              )}
            </span>
          </div>
          <div className="dsh-test-focus-content">
            <p
              ref={description}
              id={descriptionId}
              className="dsh-test-focus-description"
              data-expanded={textExpanded}
              tabIndex={textExpanded ? 0 : undefined}
            >
              {focus.description}
            </p>
            {(clipped || textExpanded) && (
              <button
                type="button"
                className="dsh-test-text-toggle"
                aria-expanded={textExpanded}
                aria-controls={descriptionId}
                onClick={() => setTextExpanded(!textExpanded)}
              >
                {textExpanded ? "收起文字" : "展开完整文字"}
              </button>
            )}
            <div className="dsh-test-focus-meta">
              {focus.step && (
                <span>
                  <IconClockOutlineRegular size={14} />
                  {statusLabels[focus.step.status] ?? focus.step.status}
                  {focus.step.started_at
                    ? ` · 本步 ${duration(elapsed(focus.step, now))}`
                    : ""}
                </span>
              )}
              {focus.next && (
                <span
                  className="dsh-test-focus-next"
                  title={focus.next.description}
                >
                  下一步：{focus.next.description}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="dsh-test-card-actions">
          {rows.length > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded(!expanded)}
            >
              <IconFlatListOutlineRegular size={17} />
              {expanded ? "收起完整步骤" : `查看全部步骤（${rows.length}）`}
            </button>
          )}
          {snapshot.preview.ready &&
            !failed &&
            snapshot.phase !== "finished" && (
              <button
                type="button"
                aria-pressed={previewVisible}
                onClick={() => actions.openPreview(snapshot)}
              >
                <IconBrowseOutlineRegular size={17} />
                {previewVisible ? "隐藏实时画面" : "显示实时画面"}
              </button>
            )}
          {snapshot.report_url && (
            <a href={snapshot.report_url} target="_blank" rel="noreferrer">
              <IconFlatListOutlineRegular size={17} />
              测试报告
            </a>
          )}
          {snapshot.phase === "finished" && (
            <RebuildReport
              rebuildReport={actions.rebuildReport}
              runId={snapshot.run_id}
            />
          )}
          <small>时间包含等待</small>
        </div>
        {snapshot.preview.failed &&
          !failed &&
          snapshot.phase !== "finished" && (
            <p
              className="dsh-test-preview-note"
              data-test-preview-error
              role="status"
            >
              实时画面未启用：{snapshot.preview.reason}
              <span>
                请进入“设置 → 测试插件 →
                浏览器实时预览”检测安装或调整配置；业务测试继续执行。
              </span>
            </p>
          )}
        {expanded && (
          <div
            className="dsh-test-step-list"
            id={listId}
            ref={list}
            role="region"
            aria-label="完整业务步骤"
            tabIndex={0}
          >
            <ol>
              {rows.map((row) => {
                const selected = inspection === row.key;
                const StepIcon =
                  tone(row.step.status) === "error"
                    ? IconWarningOutlineRegular
                    : ["PASS", "SUCCEEDED"].includes(row.step.status)
                      ? IconCheckCircleOutlineRegular
                      : row.step.status === "RUNNING"
                        ? IconLoadingOutlineRegular
                        : undefined;
                return (
                  <li
                    key={row.key}
                    data-test-step={row.step.id}
                    data-step-status={row.step.status}
                    data-tone={tone(row.step.status)}
                  >
                    <button
                      type="button"
                      className="dsh-test-step-row"
                      aria-current={activeKey === row.key ? "step" : undefined}
                      aria-expanded={selected}
                      onClick={() =>
                        setInspection(selected ? undefined : row.key)
                      }
                    >
                      <span className="dsh-test-step-position">
                        {StepIcon && (
                          <StepIcon
                            size={16}
                            className={
                              row.step.status === "RUNNING"
                                ? "dsh-test-spin"
                                : undefined
                            }
                          />
                        )}
                        {row.number}
                      </span>
                      <span className="dsh-test-step-copy">
                        {snapshot.instances.length > 1 && (
                          <small>
                            {row.instance.name} · {row.instance.data_id}
                          </small>
                        )}
                        <span>{row.step.description}</span>
                      </span>
                      <span className="dsh-test-step-result">
                        {statusLabels[row.step.status] ?? row.step.status}
                        {row.step.started_at && (
                          <small>{duration(elapsed(row.step, now))}</small>
                        )}
                      </span>
                    </button>
                    {selected && (
                      <div className="dsh-test-step-inspection">
                        <p>{row.step.description}</p>
                        {row.step.reason && <p>{row.step.reason}</p>}
                        {row.step.checks.length > 0 ? (
                          <ul>
                            {row.step.checks.map((check, index) => (
                              <li key={index}>
                                {check.text} ·{" "}
                                {statusLabels[check.status] ?? check.status}
                                {check.reason && ` · ${check.reason}`}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>本步骤没有附加检查点。</p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <button
              className="dsh-test-more-details"
              type="button"
              onClick={actions.openDetails}
            >
              查看准备、清理及完整详情
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
