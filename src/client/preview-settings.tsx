/** 测试插件设置提供环境处置和预览偏好；MCP 接入留到下一次测试开始。 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  ConfigForms,
  ConfigForm,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  previewPreferenceDefaults,
  browscreenVersionRange,
  type BrowscreenCheck,
  type PreviewPreferences,
  type PreviewSettingsInfo,
} from "../preview-preferences.js";
import { RecoveryPanel, type RecoveryActions } from "./recovery-panel.js";

type Fields = { browserPreview?: PreviewPreferences };

export function PreviewSettingsPage({
  forms,
  ...recovery
}: { forms: ConfigForms } & RecoveryActions) {
  const [info, setInfo] = useState<PreviewSettingsInfo>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/test-preview-settings", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("无法读取配置，请确认已登录且测试插件正常加载。");
        setInfo((await response.json()) as PreviewSettingsInfo);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="dsh-test-settings" data-test-preview-settings>
      <h2>测试环境</h2>
      <p>测试提示环境未释放时，请先在这里处理，完成后重新执行测试命令。</p>
      <RecoveryPanel {...recovery} />
      <h2>浏览器实时预览</h2>
      <p>
        让你看到测试正在操作的网页。接口测试或没有浏览器画面时，不会打开浮窗。
      </p>
      {error && <p role="alert">{error}</p>}
      {info ? (
        <PreferencesForm info={info} form={forms.get<Fields>(info.namespace)} />
      ) : (
        !error && <p>正在读取设置…</p>
      )}
    </section>
  );
}

function PreferencesForm({
  info,
  form,
}: {
  info: PreviewSettingsInfo;
  form: ConfigForm<Fields>;
}) {
  const state = useSyncExternalStore(
    form.subscribe.bind(form),
    form.getSnapshot.bind(form),
  );
  const [draft, setDraft] = useState(previewPreferenceDefaults);
  const [portText, setPortText] = useState(
    String(previewPreferenceDefaults.port),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editRevision, setEditRevision] = useState<number>();
  const [checking, setChecking] = useState(false);
  const [detected, setDetected] = useState<BrowscreenCheck>();
  const checker = useRef<AbortController>();
  useEffect(
    () => () => {
      checker.current?.abort();
      checker.current = undefined;
    },
    [],
  );
  useEffect(() => {
    if (dirty || state.status !== "ready") return;
    const value = {
      ...previewPreferenceDefaults,
      ...state.value?.browserPreview,
    };
    setDraft(value);
    setPortText(String(value.port));
    checker.current?.abort();
    checker.current = undefined;
    setChecking(false);
    setDetected(undefined);
  }, [state.value, state.status, dirty]);
  const edit = (value: Partial<PreviewPreferences>) => {
    if (value.browscreenExecutable !== undefined) {
      checker.current?.abort();
      checker.current = undefined;
      setChecking(false);
      setDetected(undefined);
    }
    if (!dirty) setEditRevision(state.revision);
    setDraft((current) => ({ ...current, ...value }));
    setDirty(true);
    setMessage("");
  };
  const check = async () => {
    const controller = new AbortController();
    checker.current = controller;
    setChecking(true);
    setDetected(undefined);
    try {
      const response = await fetch("/test-preview-settings/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browscreenExecutable:
            draft.browscreenExecutable.trim() || "browscreen",
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok)
        throw new Error("检测请求失败，请确认宿主和测试插件正常运行。");
      const result = (await response.json()) as BrowscreenCheck;
      if (!controller.signal.aborted) setDetected(result);
    } catch (error) {
      if (!controller.signal.aborted)
        setDetected({
          ok: false,
          message: `安装检测失败：${error instanceof Error ? error.message : String(error)}`,
        });
    } finally {
      if (checker.current === controller) {
        checker.current = undefined;
        setChecking(false);
      }
    }
  };
  const save = async () => {
    const port = Number(portText);
    const executable = draft.browscreenExecutable.trim() || "browscreen";
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setMessage("端口请填写 1 到 65535 之间的整数，例如 13390。");
      return;
    }
    if (draft.enabled && !draft.mcpId) {
      setMessage("请先选择用于测试的 Playwright 浏览器。");
      return;
    }
    if (
      executable !== "browscreen" &&
      !/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(executable)
    ) {
      setMessage(
        "请填写 browscreen 或可执行文件的完整路径，不要混入启动参数。",
      );
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const accepted = await form.mutate(
        [
          {
            op: "set",
            path: ["browserPreview"],
            value: {
              enabled: draft.enabled,
              mcpId: draft.mcpId,
              browscreenExecutable: executable,
              port,
            },
          },
        ],
        editRevision,
      );
      if (accepted) {
        setDirty(false);
        setMessage(
          "已保存。下一次 /test 或 /test-plan 会使用这些设置，无需重启 DSH。",
        );
      } else
        setMessage(
          "没有保存成功，可能配置已被修改或被启动 patch 覆盖。请重新读取设置后再试。",
        );
    } catch (error) {
      setMessage(
        `保存失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSaving(false);
    }
  };
  if (state.status === "loading") return <p>正在读取保存的配置…</p>;
  if (!state.writable || state.status === "unavailable")
    return (
      <p role="alert">
        当前连接不能保存宿主设置。请从本机 DSH 页面打开；自定义部署需提供
        settings 和 config-editor 服务。
      </p>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="dsh-test-setting-switch">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={saving}
          onChange={(event) => edit({ enabled: event.target.checked })}
        />
        启用浏览器实时预览
      </label>
      <p className="dsh-test-setting-hint">
        开启后也会等待浏览器画面就绪，不会提前打开空窗口。
      </p>
      <p className="dsh-test-setting-hint">
        请先在 DSH 所在电脑安装 Browscreen（Python ≥3.14）。支持稳定版本{" "}
        {browscreenVersionRange}，建议使用 0.2.1。 默认从宿主 PATH 查找
        browscreen，无需下载源码或提前启动服务。
      </p>
      <div className="dsh-test-setting-actions">
        <button
          type="button"
          disabled={saving || checking}
          onClick={() => void check()}
        >
          {checking ? "正在检测…" : "检测安装"}
        </button>
      </div>
      {detected && (
        <div
          className="dsh-test-command-check"
          data-test-browscreen-check
          role={detected.ok ? "status" : "alert"}
        >
          <p>{detected.message}</p>
          {detected.executable && (
            <p>
              命令位置：<code>{detected.executable}</code>
            </p>
          )}
          {detected.version && <p>检测版本：{detected.version}</p>}
        </div>
      )}
      <fieldset disabled={saving}>
        <details className="dsh-test-command-advanced">
          <summary>高级设置：Browscreen 命令路径</summary>
          <label htmlFor="dsh-test-browscreen-executable">
            Browscreen 可执行文件
          </label>
          <input
            id="dsh-test-browscreen-executable"
            type="text"
            value={draft.browscreenExecutable}
            placeholder="browscreen 或完整可执行文件路径"
            onChange={(event) =>
              edit({ browscreenExecutable: event.target.value })
            }
          />
          <p className="dsh-test-setting-hint">
            终端能运行但检测找不到时，执行 uv tool dir --bin，将该目录中的
            browscreen 完整路径填在这里；不是项目文件夹，也不填写额外参数。
          </p>
        </details>
        <label htmlFor="dsh-test-browscreen-port">采集服务端口</label>
        <input
          id="dsh-test-browscreen-port"
          type="number"
          min="1"
          max="65535"
          value={portText}
          onChange={(event) => {
            if (!dirty) setEditRevision(state.revision);
            setPortText(event.target.value);
            setDirty(true);
            setMessage("");
          }}
        />
        <p className="dsh-test-setting-hint">
          通常保留 13390。如果它已被别的程序占用，换一个空闲端口。
        </p>
        <label htmlFor="dsh-test-preview-mcp">Playwright 浏览器</label>
        <select
          id="dsh-test-preview-mcp"
          value={draft.mcpId}
          onChange={(event) => edit({ mcpId: event.target.value })}
        >
          <option value="">请选择浏览器</option>
          {info.mcpInstances.map((instance) => (
            <option
              key={instance.id}
              value={instance.id}
              disabled={!instance.compatible}
            >
              {instance.label}
              {instance.compatible ? "" : "（暂不支持此接入）"}
            </option>
          ))}
        </select>
        <p className="dsh-test-setting-hint">
          选择用于本插件测试的 Playwright。没有可选项时，先按指南添加本机
          Playwright MCP。
        </p>
      </fieldset>
      <p>
        保存后下一次测试生效。首次接入会重新连接选中的
        MCP，请勿与其他会话共享操作该浏览器。
      </p>
      <div className="dsh-test-setting-actions">
        <button type="submit" disabled={!dirty || saving || checking}>
          {saving ? "正在保存…" : "保存设置"}
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            setDirty(false);
            setMessage("");
          }}
        >
          放弃修改
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      <p className="dsh-test-setting-hint">{info.message}</p>
    </form>
  );
}
