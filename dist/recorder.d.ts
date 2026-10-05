import { type Binding, type Evidence, type Json, type SuiteRun } from "./contracts.js";
export interface RecordedEvent {
    type: string;
    binding: Binding | {
        suite_run_id: string;
    };
    payload: Json;
}
export declare function redact(value: unknown): Json;
export declare function safePath(root: string, path: string): string;
export declare function atomicJson(path: string, value: unknown): void;
export declare function atomicWrite(path: string, contents: string | Buffer): void;
export declare class Recorder {
    readonly runId: string;
    private readonly onEvent?;
    private secrets;
    protect(input: unknown): void;
    sanitize(value: unknown): Json;
    readonly directory: string;
    private seq;
    failed?: Error;
    private seen;
    constructor(root: string, runId: string, onEvent?: ((event: RecordedEvent) => void) | undefined);
    event(type: string, payload: unknown, binding?: Binding, key?: string): void;
    snapshot(run: SuiteRun): void;
    json(name: string, value: unknown): void;
    evidence(name: string, content: string | Buffer, mediaType: string, redacted?: boolean): Evidence;
}
/** 从保存的最后状态重建；尾部损坏可标中断，中间损坏拒绝。 */
export declare function rebuild(directory: string): SuiteRun;
