import type { Context } from "@deepseek-ai/cordis";
import type { BrowserPreferences } from "./browser-preferences.js";
import { type BrowserResource } from "./contracts.js";
export declare const runbridgePrefix = "mcp__runbridge__";
/** 技术终态与业务结果分别判断；只有 Node 的 COMPLETE 能确认清理。 */
export declare function remoteCleanupComplete(session: unknown): boolean;
/** 普通收尾与隔离恢复复用实际清理或确定未分配的同一证据。 */
export declare function remoteReleaseConfirmed(data: unknown, resource?: BrowserResource): boolean;
export declare function runbridgeResult(value: unknown): Record<string, any>;
export interface RunBridgeAccess {
    hub_url: string;
    node_id: string;
    grant_id: string;
    access_token: string;
}
/** 读取配置时不回显原值，业务站点不会收到 Hub 凭据。 */
export declare function readRunBridgeAccess(path: string): RunBridgeAccess;
export declare function hubPath(base: string, path: string): URL;
export declare class RunBridge {
    private readonly workspace;
    private readonly changed;
    readonly prefix = "mcp__runbridge__";
    readonly access: RunBridgeAccess;
    readonly config: BrowserPreferences;
    private readonly accessFile;
    resource?: BrowserResource;
    private client;
    private definitions;
    private connected;
    private disposing?;
    private readonly outcomes;
    constructor(config: BrowserPreferences, workspace: string, changed?: () => void);
    connect(): Promise<void>;
    register(ctx: Context, only?: string[]): () => void;
    private invoke;
    outcome(callId: string): string | undefined;
    private acceptSession;
    restore(resource: BrowserResource): void;
    private reconcile;
    close(): Promise<void>;
}
