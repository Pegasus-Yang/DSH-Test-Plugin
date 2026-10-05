/** 设置页的报告重建与隔离处置；宿主外层负责认证，操作沿用现有执行服务。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { NativeTests } from "./native-test.js";
export interface ReportResult {
    run_id: string;
    url: string;
    path: string;
}
export declare class TestUiAccess {
    private readonly tests;
    private readonly inputPath;
    private readonly recover;
    private readonly pending;
    constructor(tests: NativeTests, inputPath: (input: string) => string, recover: (sessionId: string, token: string, signal: AbortSignal) => Promise<string>);
    serve(req: IncomingMessage, res: ServerResponse): Promise<void>;
    dispose(): void;
}
