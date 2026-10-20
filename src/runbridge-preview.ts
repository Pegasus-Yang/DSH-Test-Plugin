/** 服务端消费同会话画面流，访问许可不会交给浮窗页面。 */
import { field, type SuiteRun } from "./contracts.js";
import type { PreviewState } from "./progress-model.js";
import { hubPath, runbridgeResult, type RunBridge } from "./runbridge.js";

interface Frame {
  bytes: Buffer;
  id: string;
  capturedAt: string;
}
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function decodeRemoteFrame(data: Buffer) {
  if (data.length < 5 || data.length > 4 + 4096 + 4 * 1024 * 1024)
    throw new Error("远程画面封包大小无效");
  const length = data.readUInt32BE(0);
  if (!length || length > 4096 || length + 4 >= data.length)
    throw new Error("远程画面头长度无效");
  const metadata = JSON.parse(data.subarray(4, 4 + length).toString("utf8"));
  const bytes = data.subarray(4 + length);
  if (
    bytes.length > 4 * 1024 * 1024 ||
    !bytes.subarray(0, 8).equals(pngSignature) ||
    metadata.visual_protocol_version !== 1 ||
    metadata.content_type !== "image/png" ||
    !Number.isInteger(metadata.frame_id) ||
    metadata.frame_id < 1 ||
    !Number.isFinite(Date.parse(metadata.capture_started_at))
  )
    throw new Error("远程画面合同无效");
  return { metadata, bytes };
}
export class RunBridgePreview {
  private key?: string;
  private runId?: string;
  private socket?: WebSocket;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private frame?: Frame;
  private receivedAt = 0;
  private reason = "等待远程浏览器画面";
  private failed = false;
  private streamId?: string;
  private frameId = 0;
  bind(run: SuiteRun, browser: RunBridge): void {
    const remote = browser.resource?.remote;
    if (
      run.lifecycle === "FINISHED" ||
      run.resource_quarantined ||
      !browser.config.previewEnabled ||
      browser.resource?.state !== "exists" ||
      !remote?.session_id ||
      !remote.page_id
    ) {
      this.stop();
      return;
    }
    const key = [
      run.suite_run_id,
      remote.session_id,
      remote.page_id,
      remote.connection_generation,
    ].join("/");
    if (this.key === key) return;
    this.stop();
    this.key = key;
    this.runId = run.suite_run_id;
    const generation = this.generation;
    const open = async () => {
      const controller = new AbortController();
      this.controller = controller;
      try {
        const response = await browser.status(
          AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        );
        if (generation !== this.generation) return;
        if (response.isError) {
          this.failed = true;
          throw new Error("远程画面许可或会话已失效");
        }
        const value = runbridgeResult(response);
        const path = `/v1/sessions/${remote.session_id}/visual/stream`;
        if (value.visual?.stream_path !== path) {
          this.failed = true;
          throw new Error(
            "该远程会话未提供持续画面，请检查 Hub 与 Node 版本和画面能力",
          );
        }
        const url = hubPath(browser.access.hub_url, path);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        this.socket = socket;
        this.reason = "等待远程页面首帧";
        socket.onopen = () => {
          if (generation === this.generation)
            socket.send(
              JSON.stringify({
                type: "auth",
                access_token: browser.access.access_token,
              }),
            );
          else socket.close();
        };
        socket.onmessage = (event) => {
          if (generation !== this.generation) return;
          try {
            if (typeof event.data === "string") {
              const value = JSON.parse(event.data).visual;
              if (
                !value ||
                value.target_id !== remote.page_id ||
                value.state !== "LIVE"
              ) {
                this.frame = undefined;
                this.streamId = undefined;
                this.reason =
                  value?.state === "STOPPED"
                    ? "远程画面已结束"
                    : "等待当前远程页面的新画面";
                return;
              }
              if (this.streamId !== value.stream_id) {
                this.frame = undefined;
                this.frameId = 0;
              }
              this.streamId = value.stream_id;
              return;
            }
            const { metadata, bytes } = decodeRemoteFrame(
              Buffer.from(event.data as ArrayBuffer),
            );
            if (
              metadata.session_id !== remote.session_id ||
              metadata.resource_id !== remote.resource_id ||
              metadata.connection_generation !== remote.connection_generation ||
              metadata.target_id !== remote.page_id ||
              metadata.stream_id !== this.streamId ||
              metadata.frame_id <= this.frameId
            )
              return;
            this.frameId = metadata.frame_id;
            this.frame = {
              bytes,
              id: String(metadata.frame_id),
              capturedAt: metadata.capture_started_at,
            };
            this.receivedAt = Date.now();
            this.failed = false;
          } catch {
            this.frame = undefined;
            this.failed = true;
            this.reason = "远程画面合同无效，已撤下图片";
            socket.close();
          }
        };
        socket.onerror = () => {
          if (generation === this.generation) {
            this.frame = undefined;
            this.reason = "远程画面连接暂不可用";
          }
        };
        socket.onclose = (event) => {
          if (generation !== this.generation) return;
          this.frame = undefined;
          this.streamId = undefined;
          if (event.code === 1008) this.failed = true;
          this.reason = this.failed
            ? this.reason
            : "远程画面已断开，正在核对会话";
          if (!this.failed) this.timer = setTimeout(() => void open(), 1000);
        };
      } catch (error) {
        if (generation !== this.generation || controller.signal.aborted) return;
        this.frame = undefined;
        if (
          [401, 403, 404, 410].includes(Number(field(error, "data.status")))
        ) {
          this.failed = true;
          this.reason = "远程画面许可或会话已失效";
          return;
        }
        this.reason =
          error instanceof Error &&
          !["TypeError", "TimeoutError"].includes(error.name)
            ? error.message
            : "远程画面连接暂不可用";
        if (!this.failed) this.timer = setTimeout(() => void open(), 1000);
      }
    };
    void open();
  }
  state(runId: string): PreviewState {
    if (runId !== this.runId) return { ready: false };
    if (this.frame && Date.now() - this.receivedAt > 5000) {
      this.frame = undefined;
      this.reason = "远程画面已过期，等待新帧";
    }
    return this.frame
      ? {
          ready: true,
          frame_id: this.frame.id,
          captured_at: this.frame.capturedAt,
        }
      : {
          ready: false,
          reason: this.reason,
          ...(this.failed ? { failed: true } : {}),
        };
  }
  screenshot(runId: string): Frame | undefined {
    return this.state(runId).ready ? this.frame : undefined;
  }
  stop(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.socket?.close();
    this.socket = undefined;
    this.controller = undefined;
    this.frame = undefined;
    this.runId = undefined;
    this.key = undefined;
    this.streamId = undefined;
    this.frameId = 0;
    this.failed = false;
  }
}
