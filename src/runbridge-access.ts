/** 两类 RunBridge 私有文件分别读取，凭据不进入普通设置或模型上下文。 */
import { readFileSync, statSync } from "node:fs";
import { parseDocument } from "yaml";

export interface RunBridgeAccess {
  hub_url: string;
  node_id: string;
  grant_id: string;
  access_token: string;
  expires_at?: string | null;
}
export interface RunBridgeHubCredentials {
  hub_url: string;
  hub_token: string;
}

function readPrivateObject(
  path: string,
  label: string,
  required: string[],
): Record<string, unknown> {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 32768) throw new Error();
  } catch {
    throw new Error(
      `无法读取 RunBridge 私有${label}，请检查路径、权限与文件大小（最多 32 KiB）。`,
    );
  }
  let data: unknown;
  try {
    const content = readFileSync(path, "utf8");
    try {
      data = JSON.parse(content);
    } catch {
      const document = parseDocument(content, {
        schema: "core",
        prettyErrors: false,
      });
      if (document.errors.length || document.warnings.length) throw new Error();
      data = document.toJS();
      // 后续摘要和运行记录使用 JSON，拒绝 YAML 别名产生的循环对象。
      JSON.stringify(data);
    }
  } catch {
    throw new Error(
      `${label}格式无效，请使用一个 JSON 或 YAML 配置对象；enrollment.token 仅用于节点登记。`,
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error(
      `${label}必须是包含 ${required.join("、")} 的 JSON 或 YAML 对象；enrollment.token 仅用于节点登记。`,
    );
  const result = data as Record<string, unknown>;
  const missing = required.filter(
    (key) => typeof result[key] !== "string" || !String(result[key]).trim(),
  );
  if (missing.length)
    throw new Error(`RunBridge ${label}缺少有效字段：${missing.join("、")}`);
  return result;
}

function hubBase(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RunBridge Hub 地址无效");
  }
  if (url.pathname.replace(/\/$/, "").endsWith("/mcp"))
    throw new Error(
      "hub_url 请填写 Hub 基址，不包含末尾的 /mcp；插件会自动拼接 MCP 端点。",
    );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("RunBridge 私有连接配置不符合服务合同");
  return url;
}

/** 已领取租约文件；不因缺少字段而尝试其他认证方式。 */
export function readRunBridgeAccess(path: string): RunBridgeAccess {
  const result = readPrivateObject(path, "访问文件", [
    "hub_url",
    "node_id",
    "grant_id",
    "access_token",
  ]) as unknown as RunBridgeAccess;
  return validateRunBridgeAccess(result);
}

/** 领取响应和私有文件共用字段校验，错误不包含输入值。 */
export function validateRunBridgeAccess(
  result: RunBridgeAccess,
): RunBridgeAccess {
  if (
    !result ||
    !["hub_url", "node_id", "grant_id", "access_token"].every(
      (key) =>
        typeof (result as unknown as Record<string, unknown>)[key] === "string",
    )
  )
    throw new Error("RunBridge 节点访问配置字段无效");
  const url = hubBase(result.hub_url);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result.node_id) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result.grant_id) ||
    result.access_token.length < 32 ||
    result.access_token.length > 256 ||
    /\s/.test(result.access_token)
  )
    throw new Error("RunBridge 私有连接配置不符合服务合同");
  return { ...result, hub_url: url.href.replace(/\/$/, "") };
}

/** Hub 共享申请凭据只供资源目录及领取，不替代节点执行令牌。 */
export function readRunBridgeHubCredentials(
  path: string,
): RunBridgeHubCredentials {
  const result = readPrivateObject(path, "Hub 认证文件", [
    "hub_url",
    "hub_token",
  ]) as unknown as RunBridgeHubCredentials;
  const url = hubBase(result.hub_url);
  if (/\s/.test(result.hub_token))
    throw new Error("RunBridge Hub 申请凭据不能包含空白字符");
  return { hub_url: url.href.replace(/\/$/, ""), hub_token: result.hub_token };
}

export function hubPath(base: string, path: string): URL {
  return new URL(base.replace(/\/$/, "") + "/" + path.replace(/^\//, ""));
}
