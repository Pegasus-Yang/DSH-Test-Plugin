import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  RunBridge,
  readRunBridgeAccess,
  runbridgeResult,
} from "../../src/runbridge.js";
import { browserPreferenceDefaults } from "../../src/browser-preferences.js";
import { operationTool } from "../../src/actual-operations.js";
const sdk = vi.hoisted(() => ({ call: vi.fn(), close: vi.fn() }));
const names = [
  "browser_start",
  "browser_stop",
  "browser_status",
  "browser_snapshot",
  "browser_capture",
  "browser_click",
  "browser_fill",
  "browser_screenshot",
  "browser_tabs",
  "browser_file_upload",
];
vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    connect = vi.fn();
    close = sdk.close;
    callTool = sdk.call;
    async listTools() {
      return {
        tools: names.map((name) => ({
          name,
          inputSchema: {
            type: "object",
            properties: {
              target: { type: "object" },
              node_id: { type: "string" },
              session_id: { type: "string" },
              page_id: { type: "string" },
              request_id: { type: "string" },
              resource_id: { type: "string" },
              lease_seconds: { type: "number" },
              action: { type: "string" },
              files: { type: "array" },
            },
            required:
              name === "browser_tabs"
                ? ["session_id"]
                : ["session_id", "page_id"],
          },
        })),
      };
    }
  },
  StreamableHTTPClientTransport: class {},
}));
let root: string, bridge: RunBridge, defs: Map<string, any>;
const session = {
  session_id: "session_own",
  node_id: "node_own",
  grant_id: "grant_own",
  resource_id: "chromium",
  connection_generation: 2,
  state: "ACTIVE",
  cleanup: "PENDING",
};
const result = (data: unknown, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: data,
  ...(isError ? { isError: true } : {}),
});
beforeEach(async () => {
  sdk.call.mockReset();
  sdk.close.mockReset().mockResolvedValue(undefined);
  root = mkdtempSync(join(tmpdir(), "runbridge-test-"));
  writeFileSync(
    join(root, "access.json"),
    JSON.stringify({
      hub_url: "http://hub.test",
      node_id: "node_own",
      grant_id: "grant_own",
      access_token: "x".repeat(48),
    }),
  );
  bridge = new RunBridge(
    {
      ...browserPreferenceDefaults,
      backend: "runbridge",
      accessFile: "access.json",
    },
    root,
  );
  await bridge.connect();
  defs = new Map();
  bridge.register({
    tools: {
      register: (d: any) => {
        defs.set(d.name, d);
        return () => defs.delete(d.name);
      },
    },
  } as any);
});
afterEach(async () => {
  await bridge.close();
  rmSync(root, { recursive: true, force: true });
});
const call = (
  name: string,
  args: Record<string, unknown> = {},
  id = "call_own",
) =>
  defs
    .get("mcp__runbridge__" + name)
    .execute(args, { signal: new AbortController().signal, callId: id });
const open = async () => {
  sdk.call.mockResolvedValueOnce(result({ session, page_id: "page_own" }));
  await call("browser_start");
};
it("身份从私有文件绑定，模型不能覆盖；启动前先保存未知资源", async () => {
  const schema = defs.get("mcp__runbridge__browser_click").parameters;
  expect(schema.properties.session_id).toBeUndefined();
  expect(schema.required).toEqual([]);
  expect(schema.additionalProperties).toBe(false);
  await expect(call("browser_start", { node_id: "foreign" })).rejects.toThrow(
    "不能覆盖",
  );
  expect(sdk.call).not.toHaveBeenCalled();
  sdk.call.mockImplementationOnce(async ({ arguments: args }) => {
    expect(bridge.resource?.state).toBe("unknown");
    expect(args).toMatchObject({
      node_id: "node_own",
      resource_id: "chromium",
      lease_seconds: 1800,
    });
    expect(args.request_id).toBe(bridge.resource?.id);
    return result({ session, page_id: "page_own" });
  });
  await call("browser_start");
  expect(bridge.resource?.state).toBe("exists");
  await expect(call("browser_start")).rejects.toThrow("尚未确认释放");
});
it("默认列页保留当前页，关闭其他页不改选，关闭当前页后必须明确选择", async () => {
  await open();
  sdk.call.mockResolvedValue(result({ session, pages: [] }));
  await call("browser_tabs");
  expect(bridge.resource?.remote?.page_id).toBe("page_own");
  expect(operationTool("mcp__runbridge__browser_tabs")).toBe(false);
  await call("browser_tabs", { action: "close", page_id: "page_other" });
  expect(bridge.resource?.remote?.page_id).toBe("page_own");
  await call("browser_tabs", { action: "close" });
  expect(sdk.call.mock.calls.at(-1)![0].arguments.page_id).toBe("page_own");
  expect(bridge.resource?.remote?.page_id).toBeUndefined();
  await expect(call("browser_click")).rejects.toThrow("明确选择");
  sdk.call.mockResolvedValue(
    result({ session, page_id: "page_new", pages: [] }),
  );
  await call("browser_tabs", { action: "new" });
  expect(bridge.resource?.remote?.page_id).toBe("page_new");
});
it("仅同一会话 CLOSED+COMPLETE 确认释放；客户端断开不改变资源归属", async () => {
  await open();
  sdk.call.mockResolvedValueOnce(
    result({ session: { ...session, state: "CLOSED", cleanup: "UNKNOWN" } }),
  );
  await call("browser_stop");
  expect(bridge.resource?.state).toBe("unknown");
  sdk.call.mockResolvedValueOnce(
    result({
      session: {
        ...session,
        session_id: "foreign",
        state: "CLOSED",
        cleanup: "COMPLETE",
      },
    }),
  );
  await expect(call("browser_stop")).rejects.toThrow("归属");
  expect(bridge.resource?.state).toBe("unknown");
  sdk.call.mockResolvedValueOnce(
    result({ session: { ...session, state: "CLOSED", cleanup: "COMPLETE" } }),
  );
  await call("browser_stop");
  expect(bridge.resource?.state).toBe("absent");
  await bridge.close();
  expect(bridge.resource?.remote?.session_id).toBe("session_own");
});
it("响应丢失保留未知，不自动重放；恢复按原请求核对会话再关闭", async () => {
  sdk.call.mockRejectedValueOnce(new Error("network"));
  await expect(call("browser_start", {}, "lost")).rejects.toThrow(
    "不能盲目重放",
  );
  expect(bridge.outcome("lost")).toBe("OUTCOME_UNKNOWN");
  const request = bridge.resource?.remote?.request_id;
  const saved = structuredClone(bridge.resource!);
  bridge.restore(saved);
  sdk.call
    .mockResolvedValueOnce(
      result({ sessions: [{ request_id: request, session }] }),
    )
    .mockResolvedValueOnce(
      result({ session: { ...session, state: "CLOSED", cleanup: "COMPLETE" } }),
    );
  await call("browser_stop");
  expect(sdk.call.mock.calls.at(-2)![0]).toEqual({
    name: "browser_sessions",
    arguments: { node_id: "node_own", request_id: request },
  });
  expect(bridge.resource?.state).toBe("absent");
});
it("结构化与通用 MCP 错误都经公开工具投影失败，拒绝启动无占用证据", async () => {
  sdk.call.mockResolvedValueOnce(
    result({ code: "RESOURCE_BUSY", execution_outcome: "NOT_STARTED" }, true),
  );
  await expect(call("browser_start")).rejects.toThrow("RESOURCE_BUSY");
  expect(bridge.resource?.state).toBe("absent");
  sdk.call.mockResolvedValueOnce({
    content: [{ type: "text", text: "invalid params" }],
    isError: true,
  });
  await expect(call("browser_start", {}, "invalid")).rejects.toThrow(
    "invalid params",
  );
  expect(bridge.resource?.state).toBe("unknown");
  expect(bridge.outcome("invalid")).toBe("OUTCOME_UNKNOWN");
  expect(() =>
    runbridgeResult({ content: [{ type: "text", text: "guess" }] }),
  ).toThrow();
});
it("文件上传读取明确本机路径，经线传送实际字节而非 Hub 路径", async () => {
  await open();
  writeFileSync(join(root, "测试.txt"), "原始内容");
  const schema = defs.get("mcp__runbridge__browser_file_upload").parameters;
  expect(schema.properties.files.items).toEqual({ type: "string" });
  sdk.call.mockResolvedValueOnce(result({ files: ["测试.txt"] }));
  await call("browser_file_upload", {
    files: ["测试.txt"],
    target: { by: "css", value: "#file" },
  });
  const f = sdk.call.mock.calls.at(-1)![0].arguments.files[0];
  expect(f).toEqual({
    name: "测试.txt",
    mime_type: "text/plain",
    data: Buffer.from("原始内容").toString("base64"),
  });
});
it("恢复拒绝不同 grant，配置异常不回显秘密", () => {
  expect(() =>
    bridge.restore({
      id: "s",
      state: "unknown",
      remote: {
        ...bridge.access,
        resource_id: "chromium",
        grant_id: "foreign",
      },
    } as any),
  ).toThrow("原许可");
  writeFileSync(
    join(root, "bad.json"),
    JSON.stringify({
      hub_url: "http://user:secret@hub.test",
      node_id: "n",
      grant_id: "g",
      access_token: "secret".repeat(8),
    }),
  );
  expect(() => readRunBridgeAccess(join(root, "bad.json"))).toThrow("不符合");
});
