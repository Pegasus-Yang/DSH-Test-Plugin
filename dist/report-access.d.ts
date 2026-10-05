/** 静态报告索引和受宿主登录保护的只读HTTP访问。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SuiteRun } from "./contracts.js";
export declare const reportPrefix = "/test-reports";
export declare class ReportAccess {
    readonly outputRoot: string;
    origin?: () => string;
    private selected?;
    constructor(outputRoot: string);
    select(run: SuiteRun, filename?: string, settled?: boolean): void;
    finish(run: SuiteRun): void;
    get latestId(): string | undefined;
    url(id: string, filename?: string): string;
    state(): {
        run_id: string;
        lifecycle: "RUNNING" | "FINISHED" | "CANCELLING" | "INTERRUPTED";
        title: string;
        summary: string;
        path: string;
        ready: boolean;
        url: string;
    } | null;
    /** 仅在外层完成宿主认证后调用；拒绝目录、符号链接逃逸与写请求。 */
    serve(req: IncomingMessage, res: ServerResponse): void;
}
