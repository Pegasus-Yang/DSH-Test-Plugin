import type { SuiteRun, Binding } from "./contracts.js";
interface Event {
    seq: number;
    schema_version?: string;
    timestamp?: string;
    type: string;
    binding: Binding;
    payload: any;
}
interface Scan {
    incomplete: boolean;
}
/** 每次只保留当前行；损坏的末尾可封存，中间损坏拒绝。 */
export declare function ledgerEvents(directory: string, signal?: AbortSignal, scan?: Scan): AsyncGenerator<Event>;
export declare function rebuild(directory: string, signal?: AbortSignal): Promise<SuiteRun>;
export {};
