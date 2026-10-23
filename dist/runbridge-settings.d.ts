import { type NodeLeaseState } from "./runbridge-lease.js";
export interface RunBridgeFileInfo {
    hub_url: string;
    mcp_url: string;
    node_id: string;
    grant_id?: string;
    expires_at?: string;
    revision: string;
}
export interface RunBridgeResourceInfo {
    resource_id: string;
    readiness: string;
    occupancy: string;
}
export interface RunBridgeSettingsResult {
    ok: boolean;
    code: string;
    message: string;
    file?: RunBridgeFileInfo;
    hub_connected?: boolean;
    node_status?: string;
    resources?: RunBridgeResourceInfo[];
    checked_at?: string;
    node_lease?: NodeLeaseState;
    pool_lease?: {
        state: string;
        claimable: boolean;
    };
}
export interface RunBridgeSettingsInput {
    accessFile: string;
    resourceId: string;
    connect: boolean;
    connectionSource?: "access-file" | "hub";
    hubFile?: string;
    nodeId?: string;
}
export declare function checkRunBridgeSettings(workspace: string, input: RunBridgeSettingsInput, signal: AbortSignal): Promise<RunBridgeSettingsResult>;
