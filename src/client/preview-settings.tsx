/** 设置页只编辑本插件偏好；MCP 接入留到下一次测试开始。 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  ConfigForms,
  ConfigForm,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  previewPreferenceDefaults,
  type PreviewPreferences,
  type PreviewSettingsInfo,
} from "../preview-preferences.js";

type Fields = { browserPreview?: PreviewPreferences };

export function PreviewSettingsPage({ forms }: { forms: ConfigForms }) {
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
  useEffect(() => {
    if (dirty || state.status !== "ready") return;
    const value = state.value?.browserPreview ?? previewPreferenceDefaults;
    setDraft(value);
    setPortText(String(value.port));
  }, [state.value, state.status, dirty]);
  const edit = (value: Partial<PreviewPreferences>) => {
    if (!dirty) setEditRevision(state.revision);
    setDraft((current) => ({ ...current, ...value }));
    setDirty(true);
    setMessage("");
  };
  const save = async () => {
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setMessage("端口请填写 1 到 65535 之间的整数，例如 13390。");
      return;
    }
    if (
      draft.enabled &&
      (!draft.browscreenProject.trim().startsWith("/") || !draft.mcpId)
    ) {
      setMessage("请先填写 Browscreen 完整目录，并选择 Playwright 浏览器。");
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
              ...draft,
              browscreenProject: draft.browscreenProject.trim(),
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
      <fieldset disabled={saving}>
        <label htmlFor="dsh-test-browscreen-project">Browscreen 项目目录</label>
        <input
          id="dsh-test-browscreen-project"
          type="text"
          value={draft.browscreenProject}
          placeholder="例如 /Users/你的名字/Projects/Browscreen"
          onChange={(event) => edit({ browscreenProject: event.target.value })}
        />
        <p className="dsh-test-setting-hint">
          填包含 pyproject.toml 和 .venv
          的文件夹；不是其中某个文件。首次使用需按指南准备依赖。
        </p>
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
        <button type="submit" disabled={!dirty || saving}>
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
