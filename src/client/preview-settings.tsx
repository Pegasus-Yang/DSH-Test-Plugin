/** 设置入口优先展示连接；资源处置与报告维护保持独立。 */
import { useCallback, useEffect, useState } from "react";
import type { ConfigForms } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { PreviewSettingsInfo } from "../preview-preferences.js";
import { RecoveryPanel, type RecoveryActions } from "./recovery-panel.js";
import { ReportSettings, type ReportActions } from "./report-controls.js";
import {
  BrowserSettings,
  type BrowserSettingsFields,
} from "./browser-settings.js";
export function PreviewSettingsPage({
  forms,
  rebuildReport,
  describeReport,
  tryPreview,
  stopPreview,
  currentSession,
  ...recovery
}: {
  forms: ConfigForms;
  tryPreview?: () => Promise<string>;
  stopPreview?: () => Promise<string>;
  currentSession?: () => string | undefined;
} & RecoveryActions &
  ReportActions) {
  const [tab, setTab] = useState<"connections" | "media" | "environment">(
    "connections",
  );
  const [info, setInfo] = useState<PreviewSettingsInfo>();
  const [error, setError] = useState("");
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        "/test-preview-settings" +
          (currentSession?.()
            ? "?session_id=" + encodeURIComponent(currentSession()!)
            : ""),
        {
          signal,
          cache: "no-store",
        },
      );
      if (!response.ok)
        throw new Error("无法读取设置，请确认已登录且测试插件正常加载。");
      setInfo((await response.json()) as PreviewSettingsInfo);
      setError("");
    },
    [currentSession],
  );
  useEffect(() => {
    const c = new AbortController();
    void refresh(c.signal).catch((e) => {
      if (!c.signal.aborted) setError((e as Error).message);
    });
    return () => c.abort();
  }, [refresh]);
  useEffect(() => {
    if (tab !== "media") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh(controller.signal);
      } catch {
        if (!controller.signal.aborted)
          setError("画面状态读取失败，请检查宿主连接。");
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [tab, refresh]);
  return (
    <section
      className="dsh-test-settings"
      data-test-preview-settings
      data-settings-tab={tab}
    >
      <h2>工具与实时画面</h2>
      <p className="dsh-test-setting-hint">
        Agent 按用例选择当前对话可用的工具；此处管理连接、画面与测试环境。
      </p>
      {error && <p role="alert">{error}</p>}
      <div
        className="dsh-test-settings-tabs"
        role="tablist"
        aria-label="测试插件设置"
      >
        {(
          [
            ["connections", "工具接入"],
            ["media", "实时画面"],
            ["environment", "环境与报告"],
          ] as const
        ).map(([id, label], index) => (
          <button
            type="button"
            key={id}
            id={"dsh-test-tab-" + id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={"dsh-test-panel-" + id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const ids = ["connections", "media", "environment"] as const;
              const next =
                event.key === "ArrowRight"
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
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab !== "environment" && info ? (
        <div
          role="tabpanel"
          id={"dsh-test-panel-" + tab}
          aria-labelledby={"dsh-test-tab-" + tab}
        >
          <BrowserSettings
            form={forms.get<BrowserSettingsFields>(info.namespace)}
            info={info}
            refresh={refresh}
            view={tab}
            tryPreview={tryPreview}
            stopPreview={stopPreview}
          />
        </div>
      ) : (
        !info && !error && <p role="status">正在读取设置…</p>
      )}
      <RecoveryPanel
        {...recovery}
        compact={tab !== "environment"}
        onOpen={() => setTab("environment")}
      />
      <div
        hidden={tab !== "environment"}
        role="tabpanel"
        id="dsh-test-panel-environment"
        aria-labelledby="dsh-test-tab-environment"
      >
        <ReportSettings
          rebuildReport={rebuildReport}
          describeReport={describeReport}
        />
      </div>
    </section>
  );
}
