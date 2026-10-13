/** 服务端消费同会话画面流，访问许可不会交给浮窗页面。 */
import type { SuiteRun } from "./contracts.js";
import type { PreviewState } from "./progress-model.js";
import { type RunBridge } from "./runbridge.js";
interface Frame {
    bytes: Buffer;
    id: string;
    capturedAt: string;
}
export declare function decodeRemoteFrame(data: Buffer): {
    metadata: any;
    bytes: Buffer<ArrayBufferLike>;
};
export declare class RunBridgePreview {
    private key?;
    private runId?;
    private socket?;
    private controller?;
    private timer?;
    private generation;
    private frame?;
    private receivedAt;
    private reason;
    private failed;
    private streamId?;
    private frameId;
    bind(run: SuiteRun, browser: RunBridge): void;
    state(runId: string): PreviewState;
    screenshot(runId: string): Frame | undefined;
    stop(): void;
}
export {};
