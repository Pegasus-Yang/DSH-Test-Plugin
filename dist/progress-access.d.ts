/** 按会话隔离的只读进度与预览路由；认证由宿主外层负责。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProgressSnapshot } from "./progress-model.js";
import type { PreviewManager } from "./preview.js";
export declare const progressPrefix = "/test-progress";
export declare class ProgressAccess {
    private readonly snapshot;
    private readonly preview;
    constructor(snapshot: (sessionId: string) => ProgressSnapshot | null, preview: PreviewManager);
    serve(req: IncomingMessage, res: ServerResponse): Promise<void>;
}
