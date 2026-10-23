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
  ...recovery
}: { forms: ConfigForms } & RecoveryActions & ReportActions) {
  const [info, setInfo] = useState<PreviewSettingsInfo>();
  const [error, setError] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/test-preview-settings", {
      signal,
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error("无法读取设置，请确认已登录且测试插件正常加载。");
    setInfo((await response.json()) as PreviewSettingsInfo);
    setError("");
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void refresh(c.signal).catch((e) => {
      if (!c.signal.aborted) setError((e as Error).message);
    });
    return () => c.abort();
  }, [refresh]);
  return (
    <section className="dsh-test-settings" data-test-preview-settings>
      <h2>浏览器设置</h2>
      <p className="dsh-test-setting-hint">
        选择测试浏览器的位置，再配置连接和画面。接口测试无需浏览器。
      </p>
      {error && <p role="alert">{error}</p>}
      {info ? (
        <BrowserSettings
          form={forms.get<BrowserSettingsFields>(info.namespace)}
          info={info}
          refresh={refresh}
        />
      ) : (
        !error && <p role="status">正在读取设置…</p>
      )}
      <RecoveryPanel {...recovery} />
      <ReportSettings
        rebuildReport={rebuildReport}
        describeReport={describeReport}
      />
    </section>
  );
}
