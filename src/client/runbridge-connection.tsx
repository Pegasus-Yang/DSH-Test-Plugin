/** 访问文件说明与无秘密的解析摘要。 */
import { useState } from "react";
import {
  runbridgeAccessTemplate,
  type BrowserPreferences,
} from "../browser-preferences.js";
import type { RunBridgeSettingsResult } from "../runbridge-settings.js";
export const remoteGuide =
  "https://github.com/Pegasus-Yang/DSH-Test-Plugin/blob/main/doc/user-guide/RunBridge远程浏览器与持续预览.md";
export function RunBridgeConnection({
  value,
  edit,
  result,
  checking,
  read,
  cancel,
  errors,
}: {
  value: BrowserPreferences;
  edit: (value: Partial<BrowserPreferences>) => void;
  result?: RunBridgeSettingsResult;
  checking: boolean;
  read: (connect: boolean) => void;
  cancel: () => void;
  errors: Record<string, string>;
}) {
  const [copied, setCopied] = useState("");
  const copyTemplate = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(runbridgeAccessTemplate);
      setCopied("模板已复制，请替换为真实签发信息。");
    } catch {
      setCopied("未能访问剪贴板，请选择并复制上方模板，或下载空白模板。");
    }
  };
  const file = result?.file;
  const expires = file?.expires_at ? Date.parse(file.expires_at) : undefined;
  return (
    <>
      <label htmlFor="dsh-test-runbridge-access">
        访问文件（DSH 运行机器上的 YAML / JSON）
      </label>
      <input
        id="dsh-test-runbridge-access"
        value={value.accessFile}
        placeholder="/path/to/runbridge-access.yaml"
        aria-describedby="dsh-test-access-help dsh-test-access-error"
        aria-invalid={
          !!errors.accessFile || result?.code === "ACCESS_FILE_INVALID"
        }
        onChange={(e) => edit({ accessFile: e.target.value })}
      />
      <p id="dsh-test-access-help" className="dsh-test-setting-hint">
        向 Node 所有者取得已签发的访问文件，放到运行 DSH 的机器上。文件包含 Hub
        地址与访问许可；支持带注释的 YAML 及原有 JSON，不使用 enrollment.token
        登记令牌。
      </p>
      {(errors.accessFile || result?.code === "ACCESS_FILE_INVALID") && (
        <p id="dsh-test-access-error" role="alert">
          {errors.accessFile || result?.message}
        </p>
      )}
      <details className="dsh-test-command-advanced">
        <summary>查看文件格式与空白模板</summary>
        <p>
          默认提供带注释的 YAML 模板；原有 JSON 文件仍可直接使用。示例 ID
          和占位令牌不可直接连接，也不会生成访问许可。
        </p>
        <pre tabIndex={0} aria-label="RunBridge 访问文件 YAML 模板">
          {runbridgeAccessTemplate}
        </pre>
        <dl className="dsh-test-field-guide">
          <dt>hub_url</dt>
          <dd>
            Hub 基址；插件自动拼接 /mcp。保留反向代理前缀，不填写完整 MCP 端点。
          </dd>
          <dt>node_id / grant_id</dt>
          <dd>Node 所有者提供的节点和配套许可 ID。</dd>
          <dt>access_token</dt>
          <dd>该许可的访问令牌，不能替换成节点登记令牌。</dd>
        </dl>
        <div className="dsh-test-setting-actions">
          <button type="button" onClick={() => void copyTemplate()}>
            复制模板
          </button>
          <a
            href={
              "data:application/yaml;charset=utf-8," +
              encodeURIComponent(runbridgeAccessTemplate)
            }
            download="runbridge-access.example.yaml"
          >
            下载空白模板
          </a>
          <a href={remoteGuide} target="_blank" rel="noreferrer">
            如何获取访问文件
          </a>
        </div>
        {copied && <p role="status">{copied}</p>}
      </details>
      <div className="dsh-test-setting-actions">
        <button
          type="button"
          disabled={checking || !value.accessFile.trim()}
          onClick={() => read(false)}
        >
          读取配置
        </button>
        <button
          type="button"
          disabled={checking || !value.accessFile.trim()}
          onClick={() => read(true)}
        >
          {checking ? "正在检查…" : "检测连接"}
        </button>
        {checking && (
          <button type="button" onClick={cancel}>
            取消检测
          </button>
        )}
      </div>
      <p className="dsh-test-setting-hint">
        检测只查询 Hub
        和授权节点，不启动浏览器；实际会话身份在运行时核对。保存不会自动执行连接检测。
      </p>
      {file && (
        <dl className="dsh-test-connection-summary" data-test-runbridge-summary>
          <dt>Hub 基址</dt>
          <dd>{file.hub_url}</dd>
          <dt>MCP 端点</dt>
          <dd>{file.mcp_url}</dd>
          <dt>节点 ID</dt>
          <dd>{file.node_id}</dd>
          <dt>许可 ID</dt>
          <dd>{file.grant_id}</dd>
          <dt>访问令牌</dt>
          <dd>已配置，仅在宿主读取</dd>
          {file.expires_at && (
            <>
              <dt>文件标注到期时间</dt>
              <dd>{new Date(file.expires_at).toLocaleString()}</dd>
            </>
          )}
        </dl>
      )}
      {result && result.code !== "ACCESS_FILE_INVALID" && (
        <div
          className="dsh-test-command-check"
          role={result.ok ? "status" : "alert"}
          data-test-runbridge-check
        >
          <strong>
            {result.code === "FILE_VALID"
              ? "文件已解析 · 连接未验证"
              : result.ok
                ? "最近检测通过"
                : result.hub_connected
                  ? "Hub 已连接 · 节点或资源需要处理"
                  : "最近连接检测未通过"}
          </strong>
          <p>{result.message}</p>
          {result.checked_at && (
            <p>
              检测时间：{new Date(result.checked_at).toLocaleString()}
              。状态可能变化，运行时会重新核对。
            </p>
          )}
          {result.node_status && <p>节点状态：{result.node_status}</p>}
        </div>
      )}
      {expires !== undefined &&
        expires - Date.now() < value.leaseSeconds * 1000 && (
          <p role="status">
            文件标注的许可剩余时间小于当前租期，请联系所有者核对许可；授权有效性以
            Hub 为准。
          </p>
        )}
      <label htmlFor="dsh-test-runbridge-resource">受管理浏览器资源 ID</label>
      <input
        id="dsh-test-runbridge-resource"
        value={value.resourceId}
        list="dsh-test-runbridge-resources"
        aria-describedby="dsh-test-resource-help dsh-test-resource-error"
        aria-invalid={!!errors.resourceId}
        onChange={(e) => edit({ resourceId: e.target.value })}
      />
      <datalist id="dsh-test-runbridge-resources">
        {result?.resources?.map((r) => (
          <option key={r.resource_id} value={r.resource_id}>
            {r.readiness} / {r.occupancy}
          </option>
        ))}
      </datalist>
      <p id="dsh-test-resource-help" className="dsh-test-setting-hint">
        通常为
        chromium。检测后可选择返回的授权资源，离线时仍可填写所有者提供的资源
        ID。
      </p>
      {errors.resourceId && (
        <p id="dsh-test-resource-error" role="alert">
          {errors.resourceId}
        </p>
      )}
      <label htmlFor="dsh-test-runbridge-lease">每条用例的会话租期（秒）</label>
      <input
        id="dsh-test-runbridge-lease"
        type="number"
        min={1}
        max={3600}
        value={Number.isFinite(value.leaseSeconds) ? value.leaseSeconds : ""}
        aria-describedby="dsh-test-lease-help dsh-test-lease-error"
        aria-invalid={!!errors.leaseSeconds}
        onChange={(e) =>
          edit({
            leaseSeconds: e.target.value === "" ? NaN : Number(e.target.value),
          })
        }
      />
      <p id="dsh-test-lease-help" className="dsh-test-setting-hint">
        {Number.isFinite(value.leaseSeconds)
          ? `${value.leaseSeconds} 秒，约 ${Math.round((value.leaseSeconds / 60) * 10) / 10} 分钟。`
          : ""}
        范围 1～3600 秒，需覆盖执行和收尾；它不是单个工具的超时。
      </p>
      {errors.leaseSeconds && (
        <p id="dsh-test-lease-error" role="alert">
          {errors.leaseSeconds}
        </p>
      )}
    </>
  );
}
