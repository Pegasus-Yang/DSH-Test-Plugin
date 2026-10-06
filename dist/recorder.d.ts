import { type Binding, type Evidence, type Json, type SuiteRun } from "./contracts.js";
export { rebuild, ledgerEvents } from "./ledger-rebuild.js";
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
    private checkpoints;
    private obsolete;
    constructor(root: string, runId: string, onEvent?: ((event: RecordedEvent) => void) | undefined);
    event(type: string, payload: unknown, binding?: Binding, key?: string): void;
    snapshot(run: SuiteRun): void;
    json(name: string, value: unknown): void;
    evidence(name: string, content: string | Buffer, mediaType: string, redacted?: boolean): Evidence;
}
