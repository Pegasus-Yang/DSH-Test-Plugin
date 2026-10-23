import type { Client } from "@modelcontextprotocol/client";
import type { NodeLeaseRecord } from "./contracts.js";
import { type RunBridgeAccess, type RunBridgeHubCredentials } from "./runbridge-access.js";
export type RunBridgeTools = Awaited<ReturnType<Client["listTools"]>>["tools"];
export interface NodeLeaseState {
    grant_id: string;
    node_id: string;
    state: "HELD" | "RELEASING" | "QUARANTINED" | "RELEASED";
    cleanup: "COMPLETE" | "PENDING" | "UNKNOWN";
    expires_at: string;
    idle_deadline_at: string | null;
    inflight: boolean;
    close_reason: string | null;
}
export declare class RunBridgeHttpError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, status: number);
}
/** HTTP 错误只保留规范错误码，不回显正文或底层含凭据的异常。 */
export declare function runbridgeRequest(hub: string, path: string, token: string, init?: {
    method?: string;
    body?: unknown;
}, signal?: AbortSignal): Promise<{
    status: number;
    body: any;
}>;
export declare function readNodeCatalog(credentials: RunBridgeHubCredentials, nodeId: string, signal?: AbortSignal): Promise<{
    node: Record<string, any>;
    tools: RunBridgeTools;
}>;
export declare function parseNodeLeaseState(data: any, identity: Pick<RunBridgeAccess, "node_id" | "grant_id">): NodeLeaseState;
export declare function queryNodeLease(access: RunBridgeAccess, signal?: AbortSignal): Promise<NodeLeaseState>;
export type NodeLeaseSource = {
    kind: "access-file";
    access: RunBridgeAccess;
    file: string;
} | {
    kind: "hub";
    credentials: RunBridgeHubCredentials;
    nodeId: string;
    file: string;
    leaseSeconds?: number;
    retainFile?: () => boolean;
};
export declare class NodeLease {
    private readonly source;
    private readonly changed;
    private readonly invalid;
    access?: RunBridgeAccess;
    record?: NodeLeaseRecord;
    private activation?;
    private readonly activationAbort;
    private maintenance?;
    private maintenanceAbort?;
    private releasing?;
    private timer?;
    private renewWindowMs;
    constructor(source: NodeLeaseSource, changed?: () => void, invalid?: (reason: string) => void);
    activate(signal?: AbortSignal): Promise<void>;
    private activateOnce;
    /** 隔离恢复只查询原访问文件，不要求租约仍可执行，也不启动保活。 */
    inspectExisting(signal?: AbortSignal): Promise<void>;
    private apply;
    private assertHeld;
    maintain(signal?: AbortSignal): Promise<void>;
    private maintainOnce;
    release(timeoutMs: number, signal?: AbortSignal): Promise<void>;
    private releaseOnce;
}
