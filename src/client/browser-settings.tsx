/** 连接与画面分别保存，草稿跨设置页保留；凭据内容不进入客户端。 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  browserPreferenceDefaults,
  runbridgeEnabled,
  type BrowserPreferences,
} from "../browser-preferences.js";
import {
  previewPreferenceDefaults,
  effectivePreviewPreferences,
  type PreviewPreferences,
  type PreviewSettingsInfo,
} from "../preview-preferences.js";
import type { RunBridgeSettingsResult } from "../runbridge-settings.js";
import { RunBridgeConnection } from "./runbridge-connection.js";
import { LocalPreviewSettings } from "./local-preview-settings.js";
export interface BrowserSettingsFields {
  browser?: BrowserPreferences;
  browserConnection?: BrowserPreferences;
  browserPreview?: PreviewPreferences;
}
interface Draft {
  browser: BrowserPreferences;
  preview: PreviewPreferences;
}
const drafts = new WeakMap<
  ConfigForm<BrowserSettingsFields>,
  { draft: Draft; base: Draft; revision?: number }
>();
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const values = (
  v: BrowserSettingsFields | undefined,
  info: PreviewSettingsInfo,
): Draft => {
  const old = v?.browserConnection ?? v?.browser ?? info.browserConnection;
  return {
    browser: {
      ...browserPreferenceDefaults,
      ...old,
      backend: "auto",
      runbridgeEnabled: runbridgeEnabled(old),
    },
    preview: {
      ...previewPreferenceDefaults,
      ...effectivePreviewPreferences(old, v?.browserPreview),
    },
  };
};
export function BrowserSettings({
  form,
  info,
  refresh,
  view = "connections",
  tryPreview,
  stopPreview,
}: {
  form: ConfigForm<BrowserSettingsFields>;
  info: PreviewSettingsInfo;
  refresh: () => Promise<void>;
  view?: "connections" | "media";
  tryPreview?: () => Promise<string>;
  stopPreview?: () => Promise<string>;
}) {
  const state = useSyncExternalStore(
    form.subscribe.bind(form),
    form.getSnapshot.bind(form),
  );
  const cached = drafts.get(form);
  const [base, setBase] = useState(
    () => cached?.base ?? values(state.value, info),
  );
  const [draft, setDraft] = useState(
    () => cached?.draft ?? values(state.value, info),
  );
  const [revision, setRevision] = useState(cached?.revision ?? state.revision);
  const [notice, setNotice] = useState(
    cached ? "上次未保存的修改已保留。" : "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RunBridgeSettingsResult>();
  const [checking, setChecking] = useState(false);
  const [details, setDetails] = useState(false);
  const [probing, setProbing] = useState(false);
  const request = useRef<AbortController>();
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = !same(base, draft);
  const sectionDirty =
    view === "connections"
      ? !same(base.browser, draft.browser)
      : !same(base.preview, draft.preview);
  const browser = draft.browser;
  const connectionKey = JSON.stringify(browser);
  const keyRef = useRef(connectionKey);
  keyRef.current = connectionKey;
  useEffect(() => {
    if (!dirty && state.status === "ready") {
      const next = values(state.value, info);
      setBase(next);
      setDraft(next);
      setRevision(state.revision);
    }
  }, [state.value, state.revision, state.status, dirty, info]);
  useEffect(() => {
    if (dirty) drafts.set(form, { draft, base, revision });
    else drafts.delete(form);
  }, [draft, base, revision, dirty, form]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    request.current?.abort();
    setResult(undefined);
    setChecking(false);
    return () => request.current?.abort();
  }, [connectionKey]);
  const edit = (part: Partial<Draft>) => {
    if (!dirty) setRevision(state.revision);
    setDraft((current) => ({ ...current, ...part }));
    setErrors({});
    setNotice("");
  };
  const inspect = async (
    connect: boolean,
  ): Promise<RunBridgeSettingsResult | undefined> => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const key = connectionKey;
    setChecking(true);
    try {
      const response = await fetch("/test-preview-settings/runbridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: connect ? "connect" : "read",
          connectionSource: browser.connectionSource ?? "access-file",
          accessFile: browser.accessFile.trim(),
          hubFile: browser.hubFile?.trim(),
          nodeId: browser.nodeId?.trim(),
          resourceId: browser.resourceId.trim(),
        }),
        signal: controller.signal,
      });
      const next = (await response.json()) as RunBridgeSettingsResult;
      if (!controller.signal.aborted && keyRef.current === key) {
        setResult(next);
        return next;
      }
    } catch {
      if (!controller.signal.aborted)
        setResult({
          ok: false,
          code: "CHECK_FAILED",
          message: "检测失败，请核对私有文件与宿主连接。",
        });
    } finally {
      if (request.current === controller) setChecking(false);
    }
  };
  const focusError = (key: string) => {
    const ids: Record<string, string> = {
      accessFile: "dsh-test-runbridge-access",
      hubFile: "dsh-test-runbridge-hub",
      nodeId: "dsh-test-runbridge-node",
      nodeLeaseSeconds: "dsh-test-runbridge-node-lease",
      resourceId: "dsh-test-runbridge-resource",
      leaseSeconds: "dsh-test-runbridge-lease",
      port: "dsh-test-browscreen-port",
      browscreenExecutable: "dsh-test-browscreen-executable",
    };
    const el = formRef.current?.querySelector<HTMLElement>("#" + ids[key]);
    for (let parent = el?.parentElement; parent; parent = parent.parentElement)
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    el?.focus();
  };
  const save = async () => {
    const invalid: Record<string, string> = {};
    if (view === "connections" && runbridgeEnabled(browser)) {
      const hub = browser.connectionSource === "hub";
      if (!(hub ? browser.hubFile : browser.accessFile)?.trim())
        invalid[hub ? "hubFile" : "accessFile"] =
          "请填写 DSH 运行机器上的私有 YAML 或 JSON 文件路径。";
      if (
        hub &&
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.nodeId?.trim() ?? "")
      )
        invalid.nodeId = "请填写有效的 Node ID。";
      if (
        hub &&
        browser.nodeLeaseSeconds !== undefined &&
        (!Number.isInteger(browser.nodeLeaseSeconds) ||
          browser.nodeLeaseSeconds < 1)
      )
        invalid.nodeLeaseSeconds = "Node 租期须为正整数秒，或留空。";
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.resourceId.trim()))
        invalid.resourceId = "请填写有效的浏览器资源 ID。";
      if (
        !Number.isInteger(browser.leaseSeconds) ||
        browser.leaseSeconds < 1 ||
        browser.leaseSeconds > 3600
      )
        invalid.leaseSeconds = "会话租期须为 1～3600 秒的整数。";
    }
    if (
      view === "media" &&
      (draft.preview.enabled || draft.preview.recordingEnabled)
    ) {
      if (
        !Number.isInteger(draft.preview.port) ||
        draft.preview.port < 1 ||
        draft.preview.port > 65535
      )
        invalid.port = "采集服务端口须为 1～65535 的整数。";
      const command = draft.preview.browscreenExecutable.trim();
      if (
        command &&
        command !== "browscreen" &&
        !/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(command)
      )
        invalid.browscreenExecutable =
          "请填写 browscreen 或完整命令路径，不填写额外参数。";
    }
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      setDetails(true);
      requestAnimationFrame(() => focusError(Object.keys(invalid)[0]!));
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      if (
        view === "connections" &&
        runbridgeEnabled(browser) &&
        !(await inspect(false))?.ok
      ) {
        setErrors({ save: "私有配置尚未读取成功，请先核对连接详情。" });
        setDetails(true);
        return;
      }
      const normalized =
        view === "connections"
          ? {
              ...browser,
              backend: "auto" as const,
              previewEnabled: base.preview.enabled,
              accessFile: browser.accessFile.trim(),
              hubFile: browser.hubFile?.trim(),
              nodeId: browser.nodeId?.trim(),
              resourceId: browser.resourceId.trim(),
            }
          : {
              ...draft.preview,
              schemaVersion: 2,
              browscreenExecutable:
                draft.preview.browscreenExecutable.trim() || "browscreen",
            };
      const path =
        view === "connections" ? "browserConnection" : "browserPreview";
      if (
        await form.mutate(
          [
            {
              op: "set",
              path: [path],
              value: JSON.parse(JSON.stringify(normalized)),
            },
          ],
          revision,
        )
      ) {
        const next =
          view === "connections"
            ? { ...draft, browser: normalized as BrowserPreferences }
            : { ...draft, preview: normalized as PreviewPreferences };
        setDraft(next);
        setBase((current) =>
          view === "connections"
            ? { ...current, browser: next.browser }
            : { ...current, preview: next.preview },
        );
        setRevision(form.getSnapshot().revision);
        setNotice(
          "已保存，下次测试生效；当前测试继续使用原连接。保存不代表连接已验证。",
        );
        await refresh();
      } else
        setErrors({
          save: state.writable
            ? "设置已被其他窗口修改，未覆盖现有值。请放弃草稿后重新读取。"
            : "当前设置由启动配置固定，无法保存。",
        });
    } catch {
      setErrors({ save: "保存失败，草稿仍保留，请检查宿主连接。" });
    } finally {
      setSaving(false);
    }
  };
  const action = async (fn?: () => Promise<string>) => {
    if (!fn) return;
    setProbing(true);
    try {
      setNotice(await fn());
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "请求失败");
    } finally {
      setProbing(false);
    }
  };
  const checkConnection = async (id: string) => {
    setChecking(true);
    try {
      const response = await fetch("/test-preview-settings/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await response.json();
      setNotice(result.message ?? "已读取宿主连接状态");
      await refresh();
    } catch {
      setNotice("无法读取宿主连接状态，请检查 DSH 连接。");
    } finally {
      setChecking(false);
    }
  };
  if (state.status === "loading")
    return <p role="status">正在读取保存的配置…</p>;
  const writable = state.writable && state.status === "ready";
  return (
    <form
      ref={formRef}
      noValidate
      data-test-browser-connection
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="dsh-test-config-state" role="status">
        {sectionDirty
          ? "当前页有未保存修改；切换页签或关闭设置会保留草稿。"
          : "当前页配置已保存"}
      </p>
      {!writable && (
        <p role="alert">当前配置只读，请在可编辑的 DSH profile 中调整。</p>
      )}
      {!!Object.keys(errors).length && (
        <div role="alert">
          {Object.entries(errors).map(([key, message]) => (
            <p key={key}>
              {message}
              {key !== "save" && (
                <button
                  type="button"
                  className="dsh-test-inline-action"
                  onClick={() => focusError(key)}
                >
                  定位字段
                </button>
              )}
            </p>
          ))}
        </div>
      )}
      <fieldset disabled={saving || !writable}>
        {view === "connections" ? (
          <>
            <p className="dsh-test-setting-hint">
              连接登记不限定运行工具。Agent
              按当前对话权限和用例目标选择，多个来源可以协作。
            </p>
            <div className="dsh-test-connections">
              {!!info.nativeTools?.length && (
                <div className="dsh-test-connection">
                  <div>
                    <strong>其他宿主工具</strong>
                    <span className="dsh-test-setting-hint">
                      {info.nativeTools.length} 个工具
                    </span>
                  </div>
                  <p className="dsh-test-setting-hint">
                    {info.agentVisible
                      ? "按当前对话权限可见"
                      : "运行时确认对话权限"}
                    ，与 MCP 工具一起参与规划。
                  </p>
                  <details>
                    <summary>查看工具</summary>
                    <ul>
                      {info.nativeTools.map((name) => (
                        <li key={name}>
                          <code>{name}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
              {info.mcpInstances.map((source) => (
                <div className="dsh-test-connection" key={source.id}>
                  <div>
                    <strong>{source.label}</strong>
                    <span className="dsh-test-setting-hint">
                      {source.enabled === false
                        ? "未启用"
                        : source.tools?.length
                          ? "工具已加载"
                          : "已登记"}
                    </span>
                  </div>
                  <p className="dsh-test-setting-hint">
                    {source.tools?.length ?? 0} 个已加载工具 ·{" "}
                    {source.visible === undefined
                      ? "运行时确认对话权限"
                      : source.visible
                        ? "当前对话可见"
                        : "当前对话不可见"}{" "}
                    ·{" "}
                    {source.compatible
                      ? "可主动接入画面"
                      : "可让 Agent 尝试画面"}
                  </p>
                  <div className="dsh-test-setting-actions">
                    <button
                      type="button"
                      disabled={checking}
                      onClick={() => void checkConnection(source.id)}
                    >
                      检测连接
                    </button>
                    <details>
                      <summary>查看工具</summary>
                      {source.tools?.length ? (
                        <ul>
                          {source.tools.map((name) => (
                            <li key={name}>
                              <code>{name}</code>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="dsh-test-setting-hint">
                          尚无可见工具，请在 DSH 中启用连接并检查当前对话权限。
                        </p>
                      )}
                    </details>
                  </div>
                </div>
              ))}
              <div className="dsh-test-connection">
                <div>
                  <strong>RunBridge</strong>
                  <span className="dsh-test-setting-hint">
                    {runbridgeEnabled(browser) ? "已登记连接" : "未登记"}
                  </span>
                </div>
                <p className="dsh-test-setting-hint">
                  只读检测不领取设备，实际使用时管理原租约。
                </p>
                <button
                  type="button"
                  className="dsh-test-inline-action"
                  onClick={() => setDetails((current) => !current)}
                >
                  {details ? "收起连接详情" : "配置连接"}
                </button>
              </div>
            </div>
            {details && (
              <section className="dsh-test-connection-detail">
                <h3>RunBridge 连接详情</h3>
                <label className="dsh-test-setting-switch">
                  <input
                    type="checkbox"
                    checked={runbridgeEnabled(browser)}
                    onChange={(event) =>
                      edit({
                        browser: {
                          ...browser,
                          runbridgeEnabled: event.target.checked,
                        },
                      })
                    }
                  />
                  登记此连接供 Agent 使用
                </label>
                <RunBridgeConnection
                  value={browser}
                  edit={(next) => edit({ browser: { ...browser, ...next } })}
                  result={result}
                  checking={checking}
                  read={(connect) => void inspect(connect)}
                  cancel={() => {
                    request.current?.abort();
                    setChecking(false);
                    setNotice("检测已取消");
                  }}
                  errors={errors}
                />
              </section>
            )}
            <details className="dsh-test-command-advanced">
              <summary>添加其他工具连接</summary>
              <p>
                在 DSH 设置的“内置插件”中添加 MCP 客户端，填写服务提供的 stdio
                启动命令或 HTTP 地址；在当前 Agent 中启用相应工具。
              </p>
              <p>
                Playwright MCP
                也使用同一入口，连接名称可自定义。以下启动参数仅帮助配置，执行时与其他工具平等。
              </p>
              <pre>
                {
                  'transport: stdio\nserverName: web-browser\ncommand: npx\nargs: ["-y", "@playwright/mcp@0.0.68", "--isolated"]'
                }
              </pre>
              <p className="dsh-test-setting-hint">
                注册后点击“刷新连接列表”；RunBridge
                的私有文件在上方连接详情配置。
              </p>
            </details>
            <button
              type="button"
              className="dsh-test-inline-action"
              onClick={() => void refresh()}
            >
              刷新连接列表
            </button>
          </>
        ) : (
          <>
            <p className="dsh-test-setting-hint">
              来源：跟随测试实际操作的页面。先尝试已有画面适配，再由 Agent
              尝试当前工具的能力。
            </p>
            <LocalPreviewSettings
              value={draft.preview}
              edit={(next) => edit({ preview: { ...draft.preview, ...next } })}
              info={info}
              refresh={refresh}
              errors={errors}
            />
            <div className="dsh-test-command-check" role="status">
              <strong>
                {info.activeMedia?.reason ?? "等待测试打开实际页面"}
              </strong>
              {info.activeMedia?.source && (
                <p className="dsh-test-setting-hint">
                  当前来源：
                  {info.mcpInstances.find(
                    (source) => source.id === info.activeMedia!.source,
                  )?.label ?? info.activeMedia.source}{" "}
                  {info.activeMedia.frames > 0
                    ? ` · 已验证 ${info.activeMedia.frames} 帧`
                    : ""}
                </p>
              )}
              <p className="dsh-test-setting-hint">
                持续画面、定时截图和单次截图分别验证；画面缺失仍可执行用例并输出报告。
              </p>
              <div className="dsh-test-setting-actions">
                <button
                  type="button"
                  disabled={probing || !tryPreview}
                  onClick={() => void action(tryPreview)}
                >
                  {probing ? "正在提交…" : "让 Agent 尝试接入"}
                </button>
                <button
                  type="button"
                  disabled={probing || !stopPreview}
                  onClick={() => void action(stopPreview)}
                >
                  停止尝试
                </button>
              </div>
            </div>
          </>
        )}
      </fieldset>
      <div className="dsh-test-settings-save dsh-test-setting-actions">
        <button
          type="submit"
          disabled={!writable || !sectionDirty || saving || checking}
        >
          {saving
            ? "正在保存…"
            : view === "connections"
              ? "保存连接"
              : "保存画面偏好"}
        </button>
        <button
          type="button"
          disabled={!sectionDirty || saving}
          onClick={() => {
            request.current?.abort();
            const next = values(state.value, info);
            setDraft((current) =>
              view === "connections"
                ? { ...current, browser: next.browser }
                : { ...current, preview: next.preview },
            );
            setBase((current) =>
              view === "connections"
                ? { ...current, browser: next.browser }
                : { ...current, preview: next.preview },
            );
            setRevision(state.revision);
            setErrors({});
            setNotice("已放弃当前页修改，恢复已保存配置。");
          }}
        >
          放弃当前页修改
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
