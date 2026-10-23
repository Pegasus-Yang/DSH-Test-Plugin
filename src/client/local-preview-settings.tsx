/** 关闭画面选项时收起采集依赖；保持录像与预览独立。 */
import { useEffect, useRef, useState } from "react";
import {
  browscreenVersionRange,
  videoInstallHint,
  type BrowscreenCheck,
  type PreviewPreferences,
  type PreviewSettingsInfo,
} from "../preview-preferences.js";
export const localGuide =
  "https://github.com/Pegasus-Yang/DSH-Test-Plugin/blob/main/doc/user-guide/浏览器实时预览一步一步配置.md";
export function LocalPreviewSettings({
  value,
  edit,
  info,
  refresh,
  errors,
}: {
  value: PreviewPreferences;
  edit: (value: Partial<PreviewPreferences>) => void;
  info: PreviewSettingsInfo;
  refresh: () => Promise<void>;
  errors: Record<string, string>;
}) {
  const [check, setCheck] = useState<BrowscreenCheck>();
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const controller = useRef<AbortController>();
  useEffect(() => {
    controller.current?.abort();
    setCheck(undefined);
    setChecking(false);
    return () => controller.current?.abort();
  }, [value.browscreenExecutable]);
  const inspect = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setChecking(true);
    setCheck(undefined);
    try {
      const r = await fetch("/test-preview-settings/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browscreenExecutable:
            value.browscreenExecutable.trim() || "browscreen",
        }),
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(8000)]),
      });
      if (!r.ok) throw new Error();
      const next = (await r.json()) as BrowscreenCheck;
      if (!current.signal.aborted) setCheck(next);
    } catch {
      if (!current.signal.aborted)
        setCheck({
          ok: false,
          message: "命令检测失败，请核对路径和宿主连接。",
        });
    } finally {
      if (controller.current === current) setChecking(false);
    }
  };
  return (
    <>
      <label className="dsh-test-setting-switch">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => edit({ enabled: e.target.checked })}
        />
        显示实时画面
      </label>
      <label className="dsh-test-setting-switch">
        <input
          type="checkbox"
          checked={!!value.recordingEnabled}
          onChange={(e) => edit({ recordingEnabled: e.target.checked })}
        />
        录制浏览器操作视频
      </label>
      <p className="dsh-test-setting-hint">
        预览等待首帧后显示；录像与预览独立，关闭浮窗不会停止录像，结束后在报告查看。
      </p>
      {value.enabled || value.recordingEnabled ? (
        <>
          <label htmlFor="dsh-test-preview-mcp">Playwright 浏览器</label>
          <select
            id="dsh-test-preview-mcp"
            value={value.mcpId}
            aria-describedby="dsh-test-mcp-help dsh-test-mcp-error"
            aria-invalid={!!errors.mcpId}
            onChange={(e) => edit({ mcpId: e.target.value })}
          >
            <option value="">请选择浏览器</option>
            {info.mcpInstances.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.compatible}>
                {m.label}
                {m.compatible ? "" : "（暂不支持此接入）"}
              </option>
            ))}
          </select>
          <p id="dsh-test-mcp-help" className="dsh-test-setting-hint">
            选择测试专用的本机 Playwright MCP，不与其他对话共享操作。
          </p>
          {errors.mcpId && (
            <p id="dsh-test-mcp-error" role="alert">
              {errors.mcpId}
            </p>
          )}
          {!info.mcpInstances.some((m) => m.compatible) && (
            <p role="status">
              未找到可用的本机 Playwright MCP。
              <a href={localGuide} target="_blank" rel="noreferrer">
                查看配置指南
              </a>
              ，配置后重新读取列表。
            </p>
          )}
          <div className="dsh-test-setting-actions">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void refresh()
                  .catch(() =>
                    setCheck({
                      ok: false,
                      message: "无法重新读取 MCP 列表，请检查宿主连接。",
                    }),
                  )
                  .finally(() => setRefreshing(false));
              }}
            >
              {refreshing ? "正在读取…" : "重新读取 MCP 列表"}
            </button>
          </div>
          <p className="dsh-test-setting-hint">
            DSH 运行机器需要 Browscreen（Python ≥3.14），支持稳定版{" "}
            {browscreenVersionRange}。无需提前启动采集服务。
            <a href={localGuide} target="_blank" rel="noreferrer">
              查看安装与配置步骤
            </a>
          </p>
          <div className="dsh-test-setting-actions">
            <button
              type="button"
              disabled={checking}
              onClick={() => void inspect()}
            >
              {checking ? "正在检测…" : "检测命令与版本"}
            </button>
          </div>
          {check && (
            <div
              className="dsh-test-command-check"
              data-test-browscreen-check
              role={check.ok ? "status" : "alert"}
            >
              <p>{check.message}</p>
              {check.executable && <p>命令位置：{check.executable}</p>}
              {check.version && <p>版本：{check.version}</p>}
              <p>此项仅检测命令和版本，不证明录像依赖或实际采集已可用。</p>
            </div>
          )}
          {value.recordingEnabled && (
            <details>
              <summary>录像依赖准备</summary>
              <p>{videoInstallHint}</p>
              <p>命令检测不验证 PyAV，实际录制结果在测试时确认。</p>
            </details>
          )}
          <details className="dsh-test-command-advanced">
            <summary>高级设置：命令路径与采集端口</summary>
            <label htmlFor="dsh-test-browscreen-executable">
              Browscreen 可执行文件
            </label>
            <input
              id="dsh-test-browscreen-executable"
              value={value.browscreenExecutable}
              aria-describedby="dsh-test-command-help dsh-test-command-error"
              aria-invalid={!!errors.browscreenExecutable}
              onChange={(e) => edit({ browscreenExecutable: e.target.value })}
            />
            <p id="dsh-test-command-help" className="dsh-test-setting-hint">
              默认
              browscreen。找不到命令时填写完整可执行文件路径，不填目录或额外参数。
            </p>
            {errors.browscreenExecutable && (
              <p id="dsh-test-command-error" role="alert">
                {errors.browscreenExecutable}
              </p>
            )}
            <label htmlFor="dsh-test-browscreen-port">采集服务端口</label>
            <input
              id="dsh-test-browscreen-port"
              type="number"
              min={1}
              max={65535}
              value={Number.isFinite(value.port) ? value.port : ""}
              aria-describedby="dsh-test-port-help dsh-test-port-error"
              aria-invalid={!!errors.port}
              onChange={(e) =>
                edit({
                  port: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
            />
            <p id="dsh-test-port-help" className="dsh-test-setting-hint">
              通常保留 13390；被占用时换为空闲端口。它不是 DSH 或浏览器 CDP
              端口。
            </p>
            {errors.port && (
              <p id="dsh-test-port-error" role="alert">
                {errors.port}
              </p>
            )}
          </details>
        </>
      ) : (
        <p className="dsh-test-setting-hint">
          画面与录像均已关闭，不需要配置 Browscreen。浏览器用例仍需已注册的本机
          Playwright MCP。
          <a href={localGuide} target="_blank" rel="noreferrer">
            查看配置指南
          </a>
        </p>
      )}
    </>
  );
}
