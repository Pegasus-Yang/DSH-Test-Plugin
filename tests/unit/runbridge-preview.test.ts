import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  decodeRemoteFrame,
  RunBridgePreview,
} from "../../src/runbridge-preview.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
  "base64",
);
const metadata = {
  visual_protocol_version: 1,
  content_type: "image/png",
  session_id: "s",
  resource_id: "r",
  connection_generation: 2,
  target_id: "p",
  stream_id: "stream",
  frame_id: 1,
  capture_started_at: "2026-10-14T00:00:00Z",
};
function packet(m = metadata, p = png) {
  const json = Buffer.from(JSON.stringify(m));
  const n = Buffer.alloc(4);
  n.writeUInt32BE(json.length);
  return Buffer.concat([n, json, p]);
}
let sockets: any[], preview: RunBridgePreview;
const run: any = {
  suite_run_id: "run-own",
  lifecycle: "RUNNING",
  resource_quarantined: false,
};
const browser: any = {
  config: { previewEnabled: true },
  resource: {
    state: "exists",
    remote: {
      session_id: "s",
      resource_id: "r",
      page_id: "p",
      connection_generation: 2,
    },
  },
  access: { hub_url: "http://hub.test", access_token: "SECRET_ONLY_SERVER" },
  status: vi.fn(),
};
beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  preview = new RunBridgePreview();
  browser.status.mockReset().mockResolvedValue({
    structuredContent: {
      visual: { stream_path: "/v1/sessions/s/visual/stream" },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        visual: { stream_path: "/v1/sessions/s/visual/stream" },
      }),
    }),
  );
  vi.stubGlobal(
    "WebSocket",
    class {
      onopen: any;
      onmessage: any;
      onclose: any;
      onerror: any;
      send = vi.fn();
      close = vi.fn();
      constructor(public url: any) {
        sockets.push(this);
      }
    },
  );
});
afterEach(() => {
  preview.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function bind(b = browser) {
  preview.bind(run, b);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return sockets.at(-1);
}
const state = (socket: any, target = "p", stream = "stream") =>
  socket.onmessage({
    data: JSON.stringify({
      type: "state",
      visual: { state: "LIVE", target_id: target, stream_id: stream },
    }),
  });
const frame = (socket: any, m = metadata) =>
  socket.onmessage({ data: packet(m) });
it("拒绝损坏长度、错误类型与超大 PNG；仅解码有界规范帧", () => {
  expect(decodeRemoteFrame(packet()).bytes).toEqual(png);
  for (const p of [
    Buffer.alloc(2),
    packet({ ...metadata, content_type: "image/jpeg" }),
    packet(metadata, Buffer.alloc(4 * 1024 * 1024 + 1)),
  ])
    expect(() => decodeRemoteFrame(p)).toThrow();
  const invalid = packet();
  invalid.writeUInt32BE(5000);
  expect(() => decodeRemoteFrame(invalid)).toThrow();
});
it("鉴权走首消息；筛除不同会话、页面、代次、乱序帧并在五秒后撤图", async () => {
  const socket = await bind();
  expect(String(socket.url)).not.toContain("SECRET");
  socket.onopen();
  expect(socket.send).toHaveBeenCalledWith(
    JSON.stringify({ type: "auth", access_token: "SECRET_ONLY_SERVER" }),
  );
  state(socket);
  for (const m of [
    { ...metadata, session_id: "foreign" },
    { ...metadata, target_id: "foreign" },
    { ...metadata, connection_generation: 1 },
  ])
    frame(socket, m);
  expect(preview.state("run-own").ready).toBe(false);
  frame(socket);
  expect(preview.state("run-own").ready).toBe(true);
  frame(socket, { ...metadata, frame_id: 2 });
  frame(socket);
  expect(preview.state("run-own").frame_id).toBe("2");
  vi.advanceTimersByTime(5001);
  expect(preview.state("run-own").ready).toBe(false);
  expect(preview.screenshot("run-own")).toBeUndefined();
});
it("切页立即撤下旧帧，迟到消息不能更新新代次；隔离和结束都关闭流", async () => {
  const first = await bind();
  state(first);
  frame(first);
  const changed = {
    ...browser,
    resource: {
      state: "exists",
      remote: { ...browser.resource.remote, page_id: "p2" },
    },
  };
  const second = await bind(changed);
  expect(first.close).toHaveBeenCalled();
  frame(first, { ...metadata, frame_id: 4 });
  expect(preview.state("run-own").ready).toBe(false);
  state(second, "p2", "stream2");
  frame(second, { ...metadata, target_id: "p2", stream_id: "stream2" });
  expect(preview.state("run-own").ready).toBe(true);
  preview.bind({ ...run, resource_quarantined: true }, changed);
  expect(second.close).toHaveBeenCalled();
  expect(preview.state("run-own").ready).toBe(false);
});
it("错误或断开立即撤图，许可拒绝禁止自动重连", async () => {
  const socket = await bind();
  state(socket);
  frame(socket);
  socket.onerror();
  expect(preview.state("run-own").ready).toBe(false);
  socket.onclose({ code: 1008 });
  vi.advanceTimersByTime(5000);
  expect(sockets).toHaveLength(1);
});
it("旧HTTP会话入口退役不影响MCP状态读取与同页预览", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 410 } as Response);
  const socket = await bind();
  expect(browser.status).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expect(String(socket.url)).toBe("ws://hub.test/v1/sessions/s/visual/stream");
  state(socket);
  frame(socket);
  expect(preview.state("run-own").ready).toBe(true);
});
it("MCP状态查询拒绝许可时撤图并停止重连，网络错误允许重试", async () => {
  browser.status.mockResolvedValueOnce({
    isError: true,
    structuredContent: { code: "SESSION_OUTSIDE_GRANT" },
  });
  await bind();
  expect(preview.state("run-own")).toMatchObject({
    ready: false,
    failed: true,
  });
  expect(sockets).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(2000);
  expect(browser.status).toHaveBeenCalledTimes(1);
  preview.stop();
  browser.status.mockRejectedValueOnce(new TypeError("network"));
  await bind();
  expect(preview.state("run-own").failed).not.toBe(true);
  await vi.advanceTimersByTimeAsync(1001);
  expect(sockets).toHaveLength(1);
});
it("切换或停止后迟到的MCP状态响应不能重建旧订阅", async () => {
  let resolve: (value: unknown) => void;
  browser.status.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await bind();
  preview.stop();
  resolve!({
    structuredContent: {
      visual: { stream_path: "/v1/sessions/s/visual/stream" },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(sockets).toHaveLength(0);
});
it("MCP传输返回401时停止重连，不将许可拒绝当作网络抖动", async () => {
  browser.status.mockRejectedValueOnce(
    Object.assign(new Error("HTTP 401"), { data: { status: 401 } }),
  );
  await bind();
  expect(preview.state("run-own")).toMatchObject({
    ready: false,
    failed: true,
    reason: "远程画面许可或会话已失效",
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(browser.status).toHaveBeenCalledTimes(1);
});
