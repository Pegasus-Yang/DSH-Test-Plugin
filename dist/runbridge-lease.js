/** 整批 Node 使用权：只领取一次，用原令牌续租和等待释放，不重放未知申请。 */
import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWrite } from "./recorder.js";
import { hubPath, validateRunBridgeAccess, } from "./runbridge-access.js";
export class RunBridgeHttpError extends Error {
    code;
    status;
    constructor(code, status) {
        super(`RunBridge 请求未成功：${code}`);
        this.code = code;
        this.status = status;
    }
}
/** HTTP 错误只保留规范错误码，不回显正文或底层含凭据的异常。 */
export async function runbridgeRequest(hub, path, token, init = {}, signal) {
    let response;
    let body;
    try {
        if (signal?.aborted)
            throw new Error();
        response = await fetch(hubPath(hub, path), {
            method: init.method ?? "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                ...(init.body === undefined
                    ? {}
                    : { "Content-Type": "application/json" }),
            },
            ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
            redirect: "error",
            signal: AbortSignal.any([
                ...(signal ? [signal] : []),
                AbortSignal.timeout(10000),
            ]),
        });
        const content = await response.text();
        if (content.length > 1024 * 1024)
            throw new Error();
        body = JSON.parse(content);
    }
    catch {
        throw new Error("RunBridge Hub 请求未获得有效确认，请核对网络或原租约状态");
    }
    if (!response.ok) {
        const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(body?.code))
            ? String(body.code)
            : "HTTP_REQUEST_FAILED";
        throw new RunBridgeHttpError(code, response.status);
    }
    return { status: response.status, body };
}
export async function readNodeCatalog(credentials, nodeId, signal) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(nodeId))
        throw new Error("请提供有效的目标 Node ID");
    const { body } = await runbridgeRequest(credentials.hub_url, `/v1/pool/nodes/${nodeId}/tools`, credentials.hub_token, {}, signal);
    if (!body?.node ||
        body.node.node_id !== nodeId ||
        !Array.isArray(body.tools) ||
        !body.tools.length ||
        !body.tools.every((tool) => typeof tool?.name === "string" && tool.inputSchema?.type === "object") ||
        new Set(body.tools.map((tool) => tool.name)).size !== body.tools.length)
        throw new Error("Hub 节点工具目录不符合合同，尚未领取 Node");
    return { node: body.node, tools: body.tools };
}
export function parseNodeLeaseState(data, identity) {
    if (!data ||
        data.node_id !== identity.node_id ||
        data.grant_id !== identity.grant_id ||
        !["HELD", "RELEASING", "QUARANTINED", "RELEASED"].includes(data.state) ||
        !["COMPLETE", "PENDING", "UNKNOWN"].includes(data.cleanup) ||
        typeof data.expires_at !== "string" ||
        !Number.isFinite(Date.parse(data.expires_at)) ||
        typeof data.inflight !== "boolean" ||
        (data.idle_deadline_at === null
            ? !data.inflight
            : typeof data.idle_deadline_at !== "string" ||
                !Number.isFinite(Date.parse(data.idle_deadline_at))) ||
        !(data.close_reason === null ||
            /^[A-Z][A-Z0-9_]{0,63}$/.test(data.close_reason)))
        throw new Error("Node 租约状态或归属不符合本次运行，不能切换身份继续执行");
    return {
        grant_id: data.grant_id,
        node_id: data.node_id,
        state: data.state,
        cleanup: data.cleanup,
        expires_at: data.expires_at,
        idle_deadline_at: data.idle_deadline_at,
        inflight: data.inflight,
        close_reason: data.close_reason,
    };
}
export async function queryNodeLease(access, signal) {
    const { body } = await runbridgeRequest(access.hub_url, `/v1/grants/${access.grant_id}`, access.access_token, {}, signal);
    return parseNodeLeaseState(body, access);
}
const refusedClaims = new Set([
    "NODE_LEASE_BUSY",
    "NODE_OFFLINE",
    "NODE_NOT_READY",
    "NODE_CLEANUP_REQUIRED",
    "NODE_NOT_FOUND",
    "INVALID_HUB_TOKEN",
    "HUB_AUTH_REQUIRED",
    "INVALID_REQUEST",
    "LEASE_TOO_LONG",
    "PUBLIC_URL_REQUIRED",
    "MCP_DISABLED",
    "REQUEST_ID_CONFLICT",
    "HUB_ACCESS_NOT_CONFIGURED",
]);
export class NodeLease {
    source;
    changed;
    invalid;
    access;
    record;
    activation;
    activationAbort = new AbortController();
    maintenance;
    maintenanceAbort;
    releasing;
    timer;
    renewWindowMs = 60000;
    constructor(source, changed = () => { }, invalid = () => { }) {
        this.source = source;
        this.changed = changed;
        this.invalid = invalid;
        if (source.kind === "access-file")
            this.access = source.access;
        else if (source.leaseSeconds !== undefined &&
            (!Number.isInteger(source.leaseSeconds) || source.leaseSeconds < 1))
            throw new Error("Node 租期须为正整数秒或留空使用 Hub 默认值");
    }
    activate(signal) {
        return (this.activation ??= this.activateOnce(AbortSignal.any([
            ...(signal ? [signal] : []),
            this.activationAbort.signal,
        ])));
    }
    async activateOnce(signal) {
        signal?.throwIfAborted();
        const source = this.source;
        if (source.kind === "hub") {
            this.record = {
                source: "hub",
                hub_url: source.credentials.hub_url,
                node_id: source.nodeId,
                request_id: "claim_" + randomUUID(),
                state: "CLAIMING",
            };
            // 身份必须先落盘；首次响应丢失后不能生成新申请继续本批。
            this.changed();
            try {
                const result = await runbridgeRequest(source.credentials.hub_url, `/v1/nodes/${source.nodeId}/grants`, source.credentials.hub_token, {
                    method: "POST",
                    body: {
                        request_id: this.record.request_id,
                        ...(source.leaseSeconds === undefined
                            ? {}
                            : { lease_seconds: source.leaseSeconds }),
                    },
                }, signal);
                if (result.status !== 201 || result.body?.token_available !== true) {
                    if (result.body?.node_id === source.nodeId &&
                        typeof result.body?.grant_id === "string")
                        this.record.grant_id = result.body.grant_id;
                    throw new Error("领取响应没有首次执行令牌，不能重新申请或接管该租约");
                }
                if (JSON.stringify(Object.keys(result.body.access_config ?? {}).sort()) !==
                    JSON.stringify([
                        "hub_url",
                        "node_id",
                        "grant_id",
                        "access_token",
                        "expires_at",
                    ].sort()))
                    throw new Error("领取响应没有规范的五字段访问配置");
                const access = validateRunBridgeAccess(result.body.access_config);
                if (access.node_id !== source.nodeId ||
                    access.grant_id !== result.body.grant_id ||
                    access.access_token !== result.body.access_token ||
                    access.expires_at !== result.body.expires_at)
                    throw new Error("领取响应的节点身份或首次令牌不一致");
                this.access = access;
                Object.assign(this.record, {
                    hub_url: access.hub_url,
                    grant_id: access.grant_id,
                });
                this.apply(parseNodeLeaseState(result.body, access));
                mkdirSync(dirname(source.file), { recursive: true, mode: 0o700 });
                atomicWrite(source.file, JSON.stringify({
                    hub_url: access.hub_url,
                    node_id: access.node_id,
                    grant_id: access.grant_id,
                    access_token: access.access_token,
                    expires_at: access.expires_at,
                }) + "\n");
                this.record.access_file = source.file;
                this.changed();
            }
            catch (error) {
                this.record.state =
                    error instanceof RunBridgeHttpError && refusedClaims.has(error.code)
                        ? "NOT_ACQUIRED"
                        : "UNKNOWN";
                this.record.error =
                    error instanceof Error ? error.message : "Node 领取未获确认";
                this.changed();
                throw error;
            }
        }
        else {
            await this.inspectExisting(signal);
        }
        this.assertHeld();
        const remaining = Date.parse(this.record.expires_at) - Date.now();
        this.renewWindowMs = Math.max(1000, Math.min(60000, remaining / 3));
        if (this.releasing)
            return;
        this.timer = setInterval(() => {
            void this.maintain().catch(() => {
                if (!this.releasing)
                    this.invalid("Node 使用权失效或状态未获确认，停止旧任务");
            });
        }, Math.max(1000, Math.min(30000, remaining / 4)));
        this.timer.unref?.();
    }
    /** 隔离恢复只查询原访问文件，不要求租约仍可执行，也不启动保活。 */
    async inspectExisting(signal) {
        if (this.source.kind !== "access-file")
            throw new Error("恢复必须使用原节点访问文件");
        const source = this.source;
        this.record = {
            source: "access-file",
            hub_url: source.access.hub_url,
            node_id: source.access.node_id,
            grant_id: source.access.grant_id,
            access_file: source.file,
            state: "UNKNOWN",
        };
        this.changed();
        this.apply(await queryNodeLease(source.access, signal));
    }
    apply(state) {
        Object.assign(this.record, state, {
            checked_at: new Date().toISOString(),
        });
        delete this.record.error;
        this.changed();
    }
    assertHeld() {
        if (this.record?.state !== "HELD")
            throw new Error("Node 使用权已失效或正在回收，不能领取新租约继续原步骤");
    }
    maintain(signal) {
        if (this.releasing)
            return Promise.reject(new Error("Node 正在归还，禁止新执行"));
        if (this.maintenance)
            return this.maintenance;
        const controller = new AbortController();
        this.maintenanceAbort = controller;
        return (this.maintenance = this.maintainOnce(AbortSignal.any([...(signal ? [signal] : []), controller.signal]))
            .catch((error) => {
            if (this.record) {
                if (this.record.state === "HELD")
                    this.record.state = "UNKNOWN";
                this.record.error =
                    error instanceof Error ? error.message : "Node 租约状态未获确认";
                this.changed();
            }
            throw error;
        })
            .finally(() => {
            this.maintenance = undefined;
            this.maintenanceAbort = undefined;
        }));
    }
    async maintainOnce(signal) {
        if (!this.access || !this.record)
            throw new Error("本批尚未取得 Node 使用权");
        this.apply(await queryNodeLease(this.access, signal));
        this.assertHeld();
        if (Date.parse(this.record.expires_at) - Date.now() <=
            this.renewWindowMs) {
            const { body } = await runbridgeRequest(this.access.hub_url, `/v1/grants/${this.access.grant_id}/renew`, this.access.access_token, {
                method: "POST",
                body: this.source.kind === "hub" && this.source.leaseSeconds !== undefined
                    ? { lease_seconds: this.source.leaseSeconds }
                    : {},
            }, signal);
            this.apply(parseNodeLeaseState(body, this.access));
            this.assertHeld();
        }
    }
    release(timeoutMs, signal) {
        return (this.releasing ??= this.releaseOnce(timeoutMs, signal));
    }
    async releaseOnce(timeoutMs, signal) {
        const deadline = AbortSignal.any([
            ...(signal ? [signal] : []),
            AbortSignal.timeout(timeoutMs),
        ]);
        if (this.timer)
            clearInterval(this.timer);
        const abortActivation = () => {
            this.activationAbort.abort();
            this.maintenanceAbort?.abort();
        };
        deadline.addEventListener("abort", abortActivation, { once: true });
        try {
            if (deadline.aborted)
                abortActivation();
            await this.activation?.catch(() => { });
            if (this.timer)
                clearInterval(this.timer);
            await this.maintenance?.catch(() => { });
        }
        finally {
            deadline.removeEventListener("abort", abortActivation);
        }
        if (this.timer)
            clearInterval(this.timer);
        if (!this.record || this.record.state === "NOT_ACQUIRED")
            return;
        if (!this.access)
            throw new Error("原领取结果未知且没有原节点令牌，需由 Hub 维护者核查");
        try {
            const { body } = await runbridgeRequest(this.access.hub_url, `/v1/grants/${this.access.grant_id}`, this.access.access_token, { method: "DELETE" }, deadline);
            this.apply(parseNodeLeaseState(body, this.access));
            while (this.record.state === "RELEASING") {
                await new Promise((resolve, reject) => {
                    const done = () => {
                        clearTimeout(timer);
                        deadline.removeEventListener("abort", abort);
                        resolve();
                    };
                    const abort = () => {
                        clearTimeout(timer);
                        deadline.removeEventListener("abort", abort);
                        reject(new Error("Node 释放等待已取消或超时"));
                    };
                    const timer = setTimeout(done, 250);
                    deadline.addEventListener("abort", abort, { once: true });
                    if (deadline.aborted)
                        abort();
                });
                this.apply(await queryNodeLease(this.access, deadline));
            }
            if (this.record.state !== "RELEASED" ||
                this.record.cleanup !== "COMPLETE")
                throw new Error("Node 使用权归还未获确认，设备仍被占用或待核查");
            if (this.source.kind === "hub" &&
                this.record.access_file &&
                !this.source.retainFile?.()) {
                try {
                    unlinkSync(this.record.access_file);
                }
                catch {
                    /* 原令牌已失效，保留本机文件不改变设备释放事实。 */
                }
            }
        }
        catch (error) {
            this.record.error =
                error instanceof Error ? error.message : "Node 归还未获确认";
            this.changed();
            throw error;
        }
    }
}
