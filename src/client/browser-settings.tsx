/** 一份草稿原子保存连接与画面偏好；不保存凭据内容。 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import {
  browserPreferenceDefaults,
  type BrowserPreferences,
} from "../browser-preferences.js";
import {
  previewPreferenceDefaults,
  type PreviewPreferences,
  type PreviewSettingsInfo,
} from "../preview-preferences.js";
import type { RunBridgeSettingsResult } from "../runbridge-settings.js";
import { RunBridgeConnection, remoteGuide } from "./runbridge-connection.js";
import { LocalPreviewSettings, localGuide } from "./local-preview-settings.js";
export interface BrowserSettingsFields {
  browser?: BrowserPreferences;
  browserConnection?: BrowserPreferences;
  browserPreview?: PreviewPreferences;
}
interface Draft {
  browser: BrowserPreferences;
  preview: PreviewPreferences;
}
// 宿主未提供离开拦截 API，按表单保留草稿；成功保存或明确放弃后清除。
const drafts = new WeakMap<
  ConfigForm<BrowserSettingsFields>,
  { draft: Draft; base: Draft; revision?: number }
>();
const values = (
  v: BrowserSettingsFields | undefined,
  info: PreviewSettingsInfo,
): Draft => ({
  browser: {
    ...browserPreferenceDefaults,
    ...(v?.browserConnection ?? v?.browser ?? info.browserConnection),
  },
  preview: { ...previewPreferenceDefaults, ...v?.browserPreview },
});
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);
export function BrowserSettings({
  form,
  info,
  refresh,
}: {
  form: ConfigForm<BrowserSettingsFields>;
  info: PreviewSettingsInfo;
  refresh: () => Promise<void>;
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
    cached ? "上次未保存的修改已保留。请保存或放弃修改。" : "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RunBridgeSettingsResult>();
  const [checking, setChecking] = useState(false);
  const request = useRef<{ controller: AbortController; key: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = !same(base, draft);
  const browser = draft.browser;
  const hubSource = browser.connectionSource === "hub";
  const activeFile = hubSource ? (browser.hubFile ?? "") : browser.accessFile;
  const requestKey = JSON.stringify([
    browser.backend,
    browser.accessFile.trim(),
    browser.connectionSource,
    browser.hubFile?.trim(),
    browser.nodeId?.trim(),
    browser.nodeLeaseSeconds,
    browser.resourceId,
    browser.leaseSeconds,
  ]);
  const latestKey = useRef(requestKey);
  latestKey.current = requestKey;
  const resultRef = useRef(result);
  resultRef.current = result;
  useEffect(() => {
    if (!dirty && state.status === "ready") {
      const current = values(state.value, info);
      setBase(current);
      setDraft(current);
      setRevision(state.revision);
    }
  }, [state.value, state.revision, state.status, dirty, info]);
  useEffect(() => {
    if (dirty) drafts.set(form, { draft, base, revision });
    else drafts.delete(form);
  }, [draft, base, revision, dirty, form]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const cancel = () => {
    request.current?.controller.abort();
    request.current = undefined;
    setChecking(false);
  };
  const inspect = async (
    connect: boolean,
    quiet = false,
  ): Promise<RunBridgeSettingsResult | undefined> => {
    if (request.current && quiet) return;
    cancel();
    const current = { controller: new AbortController(), key: requestKey };
    request.current = current;
    if (!quiet) setChecking(true);
    try {
      const response = await fetch("/test-preview-settings/runbridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: connect ? "connect" : "read",
          accessFile: browser.accessFile.trim(),
          connectionSource: browser.connectionSource ?? "access-file",
          hubFile: browser.hubFile?.trim(),
          nodeId: browser.nodeId?.trim(),
          resourceId: browser.resourceId.trim(),
        }),
        signal: current.controller.signal,
      });
      const next = (await response.json()) as RunBridgeSettingsResult;
      if (
        current.controller.signal.aborted ||
        latestKey.current !== current.key
      )
        return;
      if (!response.ok) throw new Error();
      const previous = resultRef.current;
      setResult(
        !connect &&
          previous?.checked_at &&
          next.file?.revision === previous.file?.revision
          ? { ...previous, file: next.file }
          : next,
      );
      return next;
    } catch {
      if (
        !current.controller.signal.aborted &&
        latestKey.current === current.key
      ) {
        const failed = {
          ok: false,
          code: "SETTINGS_UNAVAILABLE",
          message: "无法读取连接设置，请核对宿主连接后重试。",
        };
        setResult(failed);
        return failed;
      }
    } finally {
      if (request.current === current) {
        request.current = undefined;
        setChecking(false);
      }
    }
  };
  useEffect(() => {
    cancel();
    setResult(undefined);
    if (
      browser.backend !== "runbridge" ||
      !activeFile.trim() ||
      (hubSource &&
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.nodeId ?? "")) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.resourceId)
    )
      return;
    const timer = setTimeout(() => void inspect(false), 450);
    return () => {
      clearTimeout(timer);
      request.current?.controller.abort();
    };
  }, [browser.backend, requestKey]);
  useEffect(() => {
    if (browser.backend !== "runbridge" || !result?.file) return;
    const check = () => {
      if (document.visibilityState === "visible") void inspect(false, true);
    };
    const timer = setInterval(check, 15000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [browser.backend, requestKey, result?.file?.revision]);
  const edit = (next: Partial<Draft>) => {
    if (!dirty) setRevision(state.revision);
    setDraft((v) => ({ ...v, ...next }));
    setErrors({});
    setNotice("");
  };
  const focusError = (key: string) => {
    const ids: Record<string, string> = {
      accessFile: "dsh-test-runbridge-access",
      hubFile: "dsh-test-runbridge-hub",
      nodeId: "dsh-test-runbridge-node",
      nodeLeaseSeconds: "dsh-test-runbridge-node-lease",
      resourceId: "dsh-test-runbridge-resource",
      leaseSeconds: "dsh-test-runbridge-lease",
      mcpId: "dsh-test-preview-mcp",
      port: "dsh-test-browscreen-port",
      browscreenExecutable: "dsh-test-browscreen-executable",
    };
    const element = formRef.current?.querySelector<HTMLElement>("#" + ids[key]);
    const details = element?.closest("details");
    if (details) details.open = true;
    element?.focus();
  };
  const save = async () => {
    const invalid: Record<string, string> = {};
    if (browser.backend === "runbridge") {
      if (!activeFile.trim())
        invalid[hubSource ? "hubFile" : "accessFile"] =
          "请填写 DSH 运行机器上的私有 YAML 或 JSON 文件路径。";
      if (
        hubSource &&
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.nodeId?.trim() ?? "")
      )
        invalid.nodeId = "请填写有效的目标 Node ID。";
      if (
        hubSource &&
        browser.nodeLeaseSeconds !== undefined &&
        (!Number.isInteger(browser.nodeLeaseSeconds) ||
          browser.nodeLeaseSeconds < 1)
      )
        invalid.nodeLeaseSeconds =
          "Node 租期须为正整数秒，或留空使用 Hub 默认值。";
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.resourceId.trim()))
        invalid.resourceId = "请填写有效的受管理浏览器资源 ID。";
      if (
        !Number.isInteger(browser.leaseSeconds) ||
        browser.leaseSeconds < 1 ||
        browser.leaseSeconds > 3600
      )
        invalid.leaseSeconds = "会话租期须为 1～3600 秒的整数。";
    } else if (draft.preview.enabled || draft.preview.recordingEnabled) {
      if (
        !draft.preview.mcpId ||
        !info.mcpInstances.some(
          (m) => m.id === draft.preview.mcpId && m.compatible,
        )
      )
        invalid.mcpId = "请先选择可用的测试专用 Playwright MCP。";
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
          "请填写 browscreen 或完整可执行文件路径，不填写额外参数。";
    }
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      focusError(Object.keys(invalid)[0]!);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      if (browser.backend === "runbridge") {
        const file = await inspect(false);
        if (!file?.ok) {
          setErrors({
            [hubSource ? "hubFile" : "accessFile"]:
              file?.message ?? "读取配置未完成，请重新检查文件。",
          });
          focusError(hubSource ? "hubFile" : "accessFile");
          return;
        }
      }
      const normalized: Draft = {
        browser: {
          ...browser,
          accessFile: browser.accessFile.trim(),
          hubFile: browser.hubFile?.trim(),
          nodeId: browser.nodeId?.trim(),
          nodeLeaseSeconds:
            (browser.backend === "playwright" || !hubSource) &&
            browser.nodeLeaseSeconds !== undefined &&
            (!Number.isInteger(browser.nodeLeaseSeconds) ||
              browser.nodeLeaseSeconds < 1)
              ? base.browser.nodeLeaseSeconds
              : browser.nodeLeaseSeconds,
          resourceId: browser.resourceId.trim(),
          leaseSeconds:
            browser.backend === "playwright" &&
            (!Number.isInteger(browser.leaseSeconds) ||
              browser.leaseSeconds < 1 ||
              browser.leaseSeconds > 3600)
              ? base.browser.leaseSeconds
              : browser.leaseSeconds,
        },
        preview: {
          ...draft.preview,
          browscreenExecutable:
            draft.preview.browscreenExecutable.trim() || "browscreen",
          port:
            (browser.backend === "runbridge" ||
              (!draft.preview.enabled && !draft.preview.recordingEnabled)) &&
            (!Number.isInteger(draft.preview.port) ||
              draft.preview.port < 1 ||
              draft.preview.port > 65535)
              ? base.preview.port
              : draft.preview.port,
        },
      };
      // 隐藏的历史选项原样保留，不因切换后端覆盖另一种后端的偏好。
      if (
        await form.mutate(
          [
            {
              op: "set",
              path: ["browserConnection"],
              value: { ...normalized.browser },
            },
            {
              op: "set",
              path: ["browserPreview"],
              value: { ...normalized.preview },
            },
          ],
          revision,
        )
      ) {
        setDraft(normalized);
        setBase(normalized);
        drafts.delete(form);
        setNotice(
          "已保存，下次测试生效；当前测试继续使用原连接。连接检测结果见上方，保存本身不代表连接已验证。",
        );
      } else
        setErrors({
          save: state.writable
            ? "设置已被其他窗口修改或受启动配置覆盖，未覆盖现有值。请放弃草稿并重新读取后再试。"
            : "当前设置由启动配置固定，不能在此保存。",
        });
    } catch {
      setErrors({ save: "保存失败，请检查宿主连接后重试；当前草稿仍保留。" });
    } finally {
      setSaving(false);
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
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="dsh-test-config-state" role="status">
        {dirty
          ? "有未保存修改；关闭设置后草稿仍保留，请保存或放弃。"
          : "当前配置已保存"}{" "}
        · 已保存的浏览器位置：
        {base.browser.backend === "runbridge"
          ? "远程 RunBridge"
          : "本机 Playwright"}
      </p>
      {info.activeBrowser && (
        <p className="dsh-test-setting-hint">
          打开设置时，运行中的测试绑定：
          {info.activeBrowser === "runbridge"
            ? "远程 RunBridge"
            : "本机 Playwright"}
          。保存不会切换该测试。
        </p>
      )}
      {!writable && (
        <p role="alert">
          当前连接为只读或配置由启动 patch 固定。请在可编辑的 DSH profile
          中调整，不能通过此页覆盖启动配置。
          <a
            href={browser.backend === "runbridge" ? remoteGuide : localGuide}
            target="_blank"
            rel="noreferrer"
          >
            查看配置说明
          </a>
        </p>
      )}
      {!!Object.keys(errors).length && (
        <div role="alert" className="dsh-test-command-check">
          <strong>设置尚未保存</strong>
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
        <label htmlFor="dsh-test-browser-backend">浏览器位置</label>
        <select
          id="dsh-test-browser-backend"
          value={browser.backend}
          disabled={!writable}
          onChange={(e) =>
            edit({
              browser: {
                ...browser,
                backend: e.target.value as BrowserPreferences["backend"],
              },
            })
          }
        >
          <option value="playwright">本机 Playwright MCP</option>
          <option value="runbridge">远程 RunBridge MCP</option>
        </select>
        {browser.backend === "runbridge" && (
          <RunBridgeConnection
            value={browser}
            edit={(v) => edit({ browser: { ...browser, ...v } })}
            result={result}
            checking={checking}
            read={(connect) => void inspect(connect)}
            cancel={() => {
              cancel();
              setNotice("检测已取消，未保存设置。");
            }}
            errors={errors}
          />
        )}
        <h3>画面与录像</h3>
        {browser.backend === "runbridge" ? (
          <>
            <label className="dsh-test-setting-switch">
              <input
                type="checkbox"
                checked={browser.previewEnabled}
                disabled={!writable}
                onChange={(e) =>
                  edit({
                    browser: { ...browser, previewEnabled: e.target.checked },
                  })
                }
              />
              显示实时画面
            </label>
            <p className="dsh-test-setting-hint">
              RunBridge 提供同一远程页面的画面，无需本机
              Browscreen；远程录像暂不支持。
            </p>
          </>
        ) : (
          <LocalPreviewSettings
            value={draft.preview}
            edit={(v) => edit({ preview: { ...draft.preview, ...v } })}
            info={info}
            refresh={refresh}
            errors={errors}
          />
        )}
      </fieldset>
      <div className="dsh-test-settings-save dsh-test-setting-actions">
        <button
          type="submit"
          disabled={!writable || !dirty || saving || checking}
        >
          {saving ? "正在保存…" : "保存浏览器设置"}
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => {
            cancel();
            const current = values(state.value, info);
            setDraft(current);
            setBase(current);
            setRevision(state.revision);
            setErrors({});
            setNotice("已放弃修改，恢复当前已保存的浏览器设置。");
            drafts.delete(form);
          }}
        >
          放弃修改
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
