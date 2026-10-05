/** 设置元信息和主动安装检测；认证由宿主路由外层负责。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PreviewSettingsInfo } from "./preview-preferences.js";
export declare class PreviewSettingsAccess {
    private readonly describe;
    private readonly pending;
    constructor(describe: () => PreviewSettingsInfo);
    serve(req: IncomingMessage, res: ServerResponse): Promise<void>;
    dispose(): void;
}
