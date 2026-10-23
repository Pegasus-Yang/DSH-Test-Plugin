/** 访问文件说明与无秘密的解析摘要。 */
import { useEffect, useState } from "react";
import {
  runbridgeAccessTemplate,
  runbridgeHubTemplate,
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
  const hub = value.connectionSource === "hub";
  const template = hub ? runbridgeHubTemplate : runbridgeAccessTemplate;
  const fileKey = hub ? "hubFile" : "accessFile";
  const fileId = hub ? "dsh-test-runbridge-hub" : "dsh-test-runbridge-access";
  const path = hub ? (value.hubFile ?? "") : value.accessFile;
  useEffect(() => setCopied(""), [hub]);
  const copyTemplate = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(template);
      setCopied("模板已复制，请替换为真实签发信息。");
    } catch {
      setCopied("未能访问剪贴板，请选择并复制上方模板，或下载空白模板。");
    }
  };
  const file = result?.file;
  const expires = file?.expires_at ? Date.parse(file.expires_at) : undefined;
  return (
    <>
      <label htmlFor="dsh-test-runbridge-source">连接来源</label>
      <select
        id="dsh-test-runbridge-source"
        value={value.connectionSource ?? "access-file"}
        onChange={(e) =>
          edit({ connectionSource: e.target.value as "access-file" | "hub" })
        }
      >
        <option value="hub">Hub 自动领取（推荐）</option>
        <option value="access-file">现成访问文件</option>
      </select>
      <p className="dsh-test-setting-hint">
        {hub
          ? "规划和审核只读工具目录；执行浏览器任务时领取整 Node，整批结束后归还。"
          : "使用已领取的有限租约；浏览器整批结束后会归还，下一批需新访问文件。同一文件的所有持有者共用使用权。"}
      </p>
      <label htmlFor={fileId}>
        {hub
          ? "Hub 认证文件（DSH 运行机器上的 YAML / JSON）"
          : "访问文件（DSH 运行机器上的 YAML / JSON）"}
      </label>
      <input
        id={fileId}
        value={path}
        placeholder={
          hub ? "/path/to/runbridge-hub.yaml" : "/path/to/runbridge-access.yaml"
        }
        aria-describedby="dsh-test-access-help dsh-test-access-error"
        aria-invalid={
          !!errors[fileKey] || result?.code === "ACCESS_FILE_INVALID"
        }
        onChange={(e) => edit({ [fileKey]: e.target.value })}
      />
      <p id="dsh-test-access-help" className="dsh-test-setting-hint">
        {hub
          ? "向 Hub 维护者取得共享申请凭据文件，仅含 hub_url 和 hub_token；凭据只在宿主读取，不能直接执行设备动作。"
          : "使用 Hub 领取时导出的访问文件，包含节点、租约和执行令牌；支持 YAML 注释及原有 JSON。文件不是 enrollment.token，不能作为永久授权。"}
      </p>
      {(errors[fileKey] || result?.code === "ACCESS_FILE_INVALID") && (
        <p id="dsh-test-access-error" role="alert">
          {errors[fileKey] || result?.message}
        </p>
      )}
      {hub && (
        <>
          <label htmlFor="dsh-test-runbridge-node">目标 Node ID</label>
          <input
            id="dsh-test-runbridge-node"
            value={value.nodeId ?? ""}
            placeholder="node_example"
            aria-invalid={!!errors.nodeId}
            onChange={(e) => edit({ nodeId: e.target.value })}
          />
          {errors.nodeId && <p role="alert">{errors.nodeId}</p>}
          <label htmlFor="dsh-test-runbridge-node-lease">
            整批 Node 租期（秒，可留空）
          </label>
          <input
            id="dsh-test-runbridge-node-lease"
            type="number"
            min={1}
            value={value.nodeLeaseSeconds ?? ""}
            placeholder="留空使用 Hub 默认值"
            aria-describedby="dsh-test-node-lease-help"
            aria-invalid={!!errors.nodeLeaseSeconds}
            onChange={(e) =>
              edit({
                nodeLeaseSeconds:
                  e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
          <p id="dsh-test-node-lease-help" className="dsh-test-setting-hint">
            留空由 Hub 采用默认租期，通常为 3600 秒；上限和空闲期限以 Hub
            配置为准。运行中按需续租，续租不会刷新空闲计时。
          </p>
          {errors.nodeLeaseSeconds && (
            <p role="alert">{errors.nodeLeaseSeconds}</p>
          )}
        </>
      )}
      <details className="dsh-test-command-advanced">
        <summary>查看文件格式与空白模板</summary>
        <p>
          默认提供带注释的 YAML 模板；原有 JSON 文件仍可直接使用。示例 ID
          和占位令牌不可直接连接，模板不会签发租约。
        </p>
        <pre
          tabIndex={0}
          aria-label={
            hub
              ? "RunBridge Hub 认证文件 YAML 模板"
              : "RunBridge 访问文件 YAML 模板"
          }
        >
          {template}
        </pre>
        <dl className="dsh-test-field-guide">
          <dt>hub_url</dt>
          <dd>
            Hub 基址；插件自动拼接 /mcp。保留反向代理前缀，不填写完整 MCP 端点。
          </dd>
          {hub ? (
            <>
              <dt>hub_token</dt>
              <dd>共享申请凭据，用于目录和领取，不能代替节点执行令牌。</dd>
            </>
          ) : (
            <>
              <dt>node_id / grant_id</dt>
              <dd>本次领取的 Node 和租约 ID。</dd>
              <dt>access_token</dt>
              <dd>本次租约的节点执行令牌，共享它即共享同一份使用权。</dd>
            </>
          )}
        </dl>
        <div className="dsh-test-setting-actions">
          <button type="button" onClick={() => void copyTemplate()}>
            复制模板
          </button>
          <a
            href={
              "data:application/yaml;charset=utf-8," +
              encodeURIComponent(template)
            }
            download={
              hub
                ? "runbridge-hub.example.yaml"
                : "runbridge-access.example.yaml"
            }
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
          disabled={checking || !path.trim() || (hub && !value.nodeId?.trim())}
          onClick={() => read(false)}
        >
          读取配置
        </button>
        <button
          type="button"
          disabled={checking || !path.trim() || (hub && !value.nodeId?.trim())}
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
        检测只读，不领取 Node、不启动浏览器、不刷新空闲期限。Hub
        模式验证申请凭据和目录；现成文件模式检查原租约与 MCP。保存不会自动检测。
      </p>
      {file && (
        <dl className="dsh-test-connection-summary" data-test-runbridge-summary>
          <dt>Hub 基址</dt>
          <dd>{file.hub_url}</dd>
          <dt>MCP 端点</dt>
          <dd>{file.mcp_url}</dd>
          <dt>节点 ID</dt>
          <dd>{file.node_id}</dd>
          {file.grant_id && (
            <>
              <dt>租约 ID</dt>
              <dd>{file.grant_id}</dd>
            </>
          )}
          <dt>{hub ? "申请凭据" : "节点令牌"}</dt>
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
              ? "文件已解析 · 尚未检测"
              : result.ok
                ? hub
                  ? "Hub 目录已验证 · 尚未领取"
                  : "最近检测通过"
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
          {result.pool_lease && (
            <p>
              Node 使用权：{result.pool_lease.state} ·{" "}
              {result.pool_lease.claimable ? "当前可领取" : "当前不可领取"}
            </p>
          )}
          {result.node_lease && (
            <p>
              租约状态：{result.node_lease.state} · 到期：
              {new Date(result.node_lease.expires_at).toLocaleString()} ·{" "}
              {result.node_lease.idle_deadline_at
                ? "空闲截止：" +
                  new Date(result.node_lease.idle_deadline_at).toLocaleString()
                : "真实执行中，空闲倒计时暂停"}
            </p>
          )}
        </div>
      )}
      {expires !== undefined &&
        expires - Date.now() < value.leaseSeconds * 1000 && (
          <p role="status">
            文件标注的租约时间小于浏览器会话租期，实际期限及空闲回收以 Hub
            状态为准；失效后不能自动换令牌继续本批。
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
        通常为 chromium。检测后可选择返回的受管理资源，离线时仍可填写已知资源
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
        范围 1～3600 秒，需覆盖本条用例的执行和收尾；它与整批 Node
        租期、单个工具超时分别计算。
      </p>
      {errors.leaseSeconds && (
        <p id="dsh-test-lease-error" role="alert">
          {errors.leaseSeconds}
        </p>
      )}
    </>
  );
}
