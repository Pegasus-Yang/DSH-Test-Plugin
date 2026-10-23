/** 设置页只读检查；不分配会话，不回传访问令牌或远程原始错误。 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createRunBridgeClient, hubPath, readRunBridgeAccess, runbridgeResult, } from "./runbridge.js";
import { field } from "./contracts.js";
export async function checkRunBridgeSettings(workspace, input, signal) {
    let access;
    try {
        if (!input.accessFile.trim())
            throw new Error("请填写 DSH 运行机器上的访问 YAML 或 JSON 文件路径。");
        access = readRunBridgeAccess(resolve(workspace, input.accessFile));
    }
    catch (error) {
        return {
            ok: false,
            code: "ACCESS_FILE_INVALID",
            message: error.message,
        };
    }
    const expires = typeof access.expires_at === "string" &&
        Number.isFinite(Date.parse(access.expires_at))
        ? access.expires_at
        : undefined;
    const file = {
        hub_url: access.hub_url,
        mcp_url: hubPath(access.hub_url, "/mcp").href,
        node_id: access.node_id,
        grant_id: access.grant_id,
        ...(expires ? { expires_at: expires } : {}),
        revision: createHash("sha256").update(JSON.stringify(access)).digest("hex"),
    };
    if (!input.connect)
        return {
            ok: true,
            code: "FILE_VALID",
            message: "文件格式已通过，连接尚未检测。",
            file,
        };
    const client = createRunBridgeClient();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    let cancel = () => { };
    let hub = false;
    const done = (ok, code, message, details = {}) => ({
        ok,
        code,
        message,
        file,
        hub_connected: hub,
        checked_at: new Date().toISOString(),
        ...details,
    });
    try {
        return await Promise.race([
            (async () => {
                deadline.throwIfAborted();
                await client.connect(new StreamableHTTPClientTransport(new URL(file.mcp_url), {
                    requestInit: {
                        headers: { Authorization: `Bearer ${access.access_token}` },
                    },
                }));
                deadline.throwIfAborted();
                const list = await client.listTools();
                deadline.throwIfAborted();
                hub = true;
                if (![
                    "node_inspect",
                    "browser_start",
                    "browser_stop",
                    "browser_capture",
                    "browser_status",
                ].every((name) => list.tools.some((t) => t.name === name)))
                    return done(false, "MCP_TOOLS_MISSING", "Hub 已连接，但缺少所需浏览器工具，请检查 MCP 启用状态和服务版本。");
                const result = await client.callTool({ name: "node_inspect", arguments: { node_id: access.node_id } }, { signal: deadline, timeout: 5000 });
                deadline.throwIfAborted();
                const node = runbridgeResult(result);
                if (result.isError) {
                    const code = String(node.code);
                    return done(false, "NODE_QUERY_DENIED", code === "NODE_NOT_FOUND"
                        ? "Hub 已连接，但授权节点不存在，请核对访问文件。"
                        : "Hub 已连接，但节点查询被拒绝，请核对许可是否过期、撤销或不包含目标节点。");
                }
                if (node.node_id !== access.node_id ||
                    !["ONLINE", "OFFLINE", "PREPARING"].includes(node.connection_status))
                    return done(false, "NODE_RESULT_INVALID", "Hub 返回的节点身份或状态无效，请核对服务版本。");
                const resources = (Array.isArray(node.capabilities?.resources)
                    ? node.capabilities.resources
                    : [])
                    .filter((r) => r.kind === "MANAGED_CHROMIUM" &&
                    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(r.resource_id))
                    .map((r) => ({
                    resource_id: r.resource_id,
                    readiness: [
                        "READY",
                        "NEEDS_PROBE",
                        "NEEDS_AUTHORIZATION",
                        "UNAVAILABLE",
                    ].includes(r.readiness)
                        ? r.readiness
                        : "UNAVAILABLE",
                    occupancy: ["FREE", "BUSY", "UNKNOWN"].includes(r.occupancy)
                        ? r.occupancy
                        : "UNKNOWN",
                }));
                const details = { node_status: node.connection_status, resources };
                if (node.connection_status !== "ONLINE")
                    return done(false, "NODE_OFFLINE", "Hub 已连接，节点尚未在线。请让 Node 所有者检查节点服务。", details);
                if (node.capabilities_stale)
                    return done(false, "CAPABILITIES_STALE", "Hub 已连接，节点能力快照已过期，请等待节点重新上报。", details);
                const resource = resources.find((r) => r.resource_id === input.resourceId);
                if (!resource)
                    return done(false, "RESOURCE_NOT_FOUND", "节点已在线，但没有找到所选受管理浏览器资源，请核对资源 ID。", details);
                if (resource.readiness !== "READY")
                    return done(false, "RESOURCE_NOT_READY", "节点已在线，但所选浏览器资源尚未就绪。", details);
                if (resource.occupancy !== "FREE")
                    return done(false, "RESOURCE_BUSY", "连接检测通过，但浏览器资源被占用或占用状态未知，请稍后再试。", details);
                return done(true, "CONNECTION_READY", "连接检测通过，所选浏览器资源当前可用；检测未启动浏览器。", details);
            })(),
            new Promise((_resolve, reject) => {
                cancel = () => reject(deadline.reason);
                if (deadline.aborted)
                    cancel();
                else
                    deadline.addEventListener("abort", cancel, { once: true });
            }),
        ]);
    }
    catch (error) {
        const status = Number(field(error, "data.status"));
        return done(false, signal.aborted
            ? "CHECK_CANCELLED"
            : deadline.aborted
                ? "CHECK_TIMEOUT"
                : [401, 403].includes(status)
                    ? "ACCESS_DENIED"
                    : status === 404
                        ? "MCP_NOT_FOUND"
                        : "HUB_UNAVAILABLE", signal.aborted
            ? "检测已取消。"
            : deadline.aborted
                ? "连接检测超时，请检查 Hub 地址、网络和服务状态。"
                : [401, 403].includes(status)
                    ? "访问许可被拒绝，请核对令牌、有效期及 Hub 允许的访问来源。"
                    : status === 404
                        ? "未找到 MCP 入口，请核对 Hub 基址并确认已启用 /mcp。"
                        : "无法完成 Hub MCP 检测，请核对地址、网络、服务和版本。");
    }
    finally {
        deadline.removeEventListener("abort", cancel);
        await client.close().catch(() => { });
    }
}
