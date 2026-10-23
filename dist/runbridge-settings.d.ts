export interface RunBridgeFileInfo {
    hub_url: string;
    mcp_url: string;
    node_id: string;
    grant_id: string;
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
}
export declare function checkRunBridgeSettings(workspace: string, input: {
    accessFile: string;
    resourceId: string;
    connect: boolean;
}, signal: AbortSignal): Promise<RunBridgeSettingsResult>;
