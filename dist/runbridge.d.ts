import type { Context } from "@deepseek-ai/cordis";
import { Client } from "@modelcontextprotocol/client";
import type { BrowserPreferences } from "./browser-preferences.js";
import { type RunBridgeAccess } from "./runbridge-access.js";
export { hubPath, readRunBridgeAccess, type RunBridgeAccess, } from "./runbridge-access.js";
import { NodeLease } from "./runbridge-lease.js";
import { type BrowserResource } from "./contracts.js";
export declare const runbridgePrefix = "mcp__runbridge__";
/** 技术终态与业务结果分别判断；只有 Node 的 COMPLETE 能确认清理。 */
export declare function remoteCleanupComplete(session: unknown): boolean;
/** 普通收尾与隔离恢复复用实际清理或确定未分配的同一证据。 */
export declare function remoteReleaseConfirmed(data: unknown, resource?: BrowserResource): boolean;
export declare function runbridgeResult(value: unknown): Record<string, any>;
/** 运行与设置检测共享同一 SDK、版本标识。 */
export declare function createRunBridgeClient(): Client;
export declare class RunBridge {
    private readonly workspace;
    private readonly changed;
    private readonly runtime?;
    readonly prefix = "mcp__runbridge__";
    readonly lease: NodeLease;
    readonly config: BrowserPreferences;
    private readonly accessFile;
    private readonly hubCredentials?;
    private catalogSignature?;
    resource?: BrowserResource;
    private client;
    private definitions;
    private connected;
    private disposing?;
    private readonly outcomes;
    constructor(config: BrowserPreferences, workspace: string, changed?: () => void, runtime?: {
        credentialFile: string;
        cleanupTimeoutMs: number;
        invalid: (reason: string) => void;
        retainAccessFile?: () => boolean;
    } | undefined);
    get access(): RunBridgeAccess;
    /** Hub 模式在审核前只读目录；现成文件模式只建立只读 MCP 准备连接。 */
    preparePlanning(): Promise<void>;
    private prepareExecution;
    connect(): Promise<void>;
    /** 预览复用当前 MCP 连接读取会话，不依赖 HTTP 会话接口版本。 */
    status(signal?: AbortSignal): Promise<{
        [x: string]: unknown;
        content: ({
            type: "text";
            text: string;
            annotations?: {
                audience?: ("user" | "assistant")[] | undefined;
                priority?: number | undefined;
                lastModified?: string | undefined;
            } | undefined;
            _meta?: {
                [x: string]: unknown;
            } | undefined;
        } | {
            type: "image";
            data: string;
            mimeType: string;
            annotations?: {
                audience?: ("user" | "assistant")[] | undefined;
                priority?: number | undefined;
                lastModified?: string | undefined;
            } | undefined;
            _meta?: {
                [x: string]: unknown;
            } | undefined;
        } | {
            type: "audio";
            data: string;
            mimeType: string;
            annotations?: {
                audience?: ("user" | "assistant")[] | undefined;
                priority?: number | undefined;
                lastModified?: string | undefined;
            } | undefined;
            _meta?: {
                [x: string]: unknown;
            } | undefined;
        } | {
            uri: string;
            name: string;
            type: "resource_link";
            description?: string | undefined;
            mimeType?: string | undefined;
            size?: number | undefined;
            annotations?: {
                audience?: ("user" | "assistant")[] | undefined;
                priority?: number | undefined;
                lastModified?: string | undefined;
            } | undefined;
            _meta?: {
                [x: string]: unknown;
            } | undefined;
            icons?: {
                src: string;
                mimeType?: string | undefined;
                sizes?: string[] | undefined;
                theme?: "light" | "dark" | undefined;
            }[] | undefined;
            title?: string | undefined;
        } | {
            type: "resource";
            resource: {
                uri: string;
                text: string;
                mimeType?: string | undefined;
                _meta?: {
                    [x: string]: unknown;
                } | undefined;
            } | {
                uri: string;
                blob: string;
                mimeType?: string | undefined;
                _meta?: {
                    [x: string]: unknown;
                } | undefined;
            };
            annotations?: {
                audience?: ("user" | "assistant")[] | undefined;
                priority?: number | undefined;
                lastModified?: string | undefined;
            } | undefined;
            _meta?: {
                [x: string]: unknown;
            } | undefined;
        })[];
        _meta?: {
            [x: string]: unknown;
            "io.modelcontextprotocol/serverInfo"?: {
                version: string;
                name: string;
                websiteUrl?: string | undefined;
                description?: string | undefined;
                icons?: {
                    src: string;
                    mimeType?: string | undefined;
                    sizes?: string[] | undefined;
                    theme?: "light" | "dark" | undefined;
                }[] | undefined;
                title?: string | undefined;
            } | undefined;
        } | undefined;
        structuredContent?: unknown;
        isError?: boolean | undefined;
    }>;
    register(ctx: Context, only?: string[]): () => void;
    private invoke;
    outcome(callId: string): string | undefined;
    private acceptSession;
    restore(resource: BrowserResource): void;
    private reconcile;
    close(): Promise<void>;
}
