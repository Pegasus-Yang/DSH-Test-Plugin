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
  "browser_sessions",
  "browser_stop",
  "browser_status",
  "browser_snapshot",
  "browser_capture",
  "browser_click",
  "browser_fill",
  "browser_screenshot",
  "browser_tabs",
  "browser_file_upload",
  "tool_request_status",
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
              name === "tool_request_status"
                ? ["session_id", "request_id"]
                : name === "browser_tabs"
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
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_url, init) =>
      new Response(
        JSON.stringify({
          node_id: "node_own",
          grant_id: "grant_own",
          state: init?.method === "DELETE" ? "RELEASED" : "HELD",
          cleanup: "COMPLETE",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          idle_deadline_at: new Date(Date.now() + 600000).toISOString(),
          inflight: false,
          close_reason: init?.method === "DELETE" ? "RELEASED_BY_HOLDER" : null,
        }),
      ),
  );
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
  vi.restoreAllMocks();
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
it("动作查询保留原动作请求ID，当前页关闭后仍只绑定本次会话", async () => {
  const schema = defs.get("mcp__runbridge__tool_request_status").parameters;
  expect(schema.properties.request_id).toEqual({ type: "string" });
  expect(schema.required).toEqual(["request_id"]);
  await open();
  sdk.call.mockResolvedValueOnce(result({ session, pages: [] }));
  await call("browser_tabs", { action: "close" });
  expect(bridge.resource?.remote?.page_id).toBeUndefined();
  const resource = structuredClone(bridge.resource);
  sdk.call.mockResolvedValueOnce(result({ status: "SUCCEEDED" }));
  await call("tool_request_status", { request_id: "cmd_original" });
  expect(sdk.call.mock.calls.at(-1)![0]).toEqual({
    name: "tool_request_status",
    arguments: { session_id: session.session_id, request_id: "cmd_original" },
  });
  expect(bridge.resource).toEqual(resource);
});
it("查询缺少请求ID或覆盖会话身份在本机拒绝，其他工具不能接收请求ID", async () => {
  await open();
  sdk.call.mockClear();
  await expect(call("tool_request_status")).rejects.toThrow("Schema");
  for (const key of [
    "session_id",
    "node_id",
    "page_id",
    "resource_id",
    "lease_seconds",
  ])
    await expect(
      call("tool_request_status", {
        request_id: "cmd_original",
        [key]: "foreign",
      }),
    ).rejects.toThrow("不能覆盖");
  for (const name of ["browser_start", "browser_click", "browser_sessions"])
    await expect(call(name, { request_id: "cmd_original" })).rejects.toThrow(
      "不能覆盖",
    );
  expect(sdk.call).not.toHaveBeenCalled();
});
it("动作仍在途或结果未知时只返回原查询结果，不重放也不改写资源状态", async () => {
  await open();
  const resource = structuredClone(bridge.resource);
  sdk.call.mockClear();
  sdk.call.mockResolvedValueOnce(
    result({
      status: "RUNNING",
      request_id: "cmd_original",
      execution_outcome: "OUTCOME_UNKNOWN",
    }),
  );
  expect(
    runbridgeResult(
      await call("tool_request_status", { request_id: "cmd_original" }),
    ).status,
  ).toBe("RUNNING");
  sdk.call.mockResolvedValueOnce(
    result(
      {
        status: "UNKNOWN",
        request_id: "cmd_original",
        execution_outcome: "OUTCOME_UNKNOWN",
      },
      true,
    ),
  );
  await expect(
    call(
      "tool_request_status",
      { request_id: "cmd_original" },
      "query_unknown",
    ),
  ).rejects.toThrow("UNKNOWN");
  expect(bridge.outcome("query_unknown")).toBe("OUTCOME_UNKNOWN");
  expect(bridge.resource).toEqual(resource);
  expect(sdk.call.mock.calls.map(([value]) => value.name)).toEqual([
    "tool_request_status",
    "tool_request_status",
  ]);
});
it("预览状态读取复用MCP并绑定当前会话，不需要页面或另建连接", async () => {
  await expect(bridge.status()).rejects.toThrow("会话");
  expect(sdk.call).not.toHaveBeenCalled();
  await open();
  delete bridge.resource!.remote!.page_id;
  const response = result({
    session,
    visual: { stream_path: "/v1/sessions/session_own/visual/stream" },
  });
  sdk.call.mockResolvedValueOnce(response);
  const signal = new AbortController().signal;
  expect(await bridge.status(signal)).toEqual(response);
  expect(sdk.call.mock.calls.at(-1)).toEqual([
    { name: "browser_status", arguments: { session_id: session.session_id } },
    { signal, timeout: 5000 },
  ]);
});
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
it("失败启动找回原会话，UNKNOWN 保留身份，COMPLETE 才确认释放", async () => {
  sdk.call.mockRejectedValueOnce(new Error("lost start response"));
  await expect(call("browser_start")).rejects.toThrow("不能盲目重放");
  const request = bridge.resource?.remote?.request_id;
  const failed = { ...session, state: "FAILED", cleanup: "UNKNOWN" };
  sdk.call
    .mockResolvedValueOnce(
      result({
        request: {
          request_id: request,
          node_id: session.node_id,
          grant_id: session.grant_id,
          state: "FAILED",
          session_id: session.session_id,
          error_code: "BROWSER_CONNECT_FAILED",
          execution_outcome: "OUTCOME_UNKNOWN",
        },
        sessions: [{ request_id: request, session: failed }],
      }),
    )
    .mockResolvedValueOnce(result({ session: failed }));
  await call("browser_stop");
  expect(bridge.resource?.remote?.session_id).toBe("session_own");
  expect(bridge.resource?.state).toBe("unknown");
  sdk.call.mockResolvedValueOnce(
    result({ session: { ...failed, cleanup: "COMPLETE" } }),
  );
  await call("browser_stop");
  expect(bridge.resource?.state).toBe("absent");
  expect(
    sdk.call.mock.calls.filter(([input]) => input.name === "browser_start"),
  ).toHaveLength(1);
  expect(
    sdk.call.mock.calls.filter(([input]) => input.name === "browser_stop"),
  ).toHaveLength(2);
});
it.each(["缺失", "重复", "另一许可"])(
  "旧格式恢复查询%s时保留隔离，不猜测或重放启动",
  async (kind) => {
    sdk.call.mockRejectedValueOnce(new Error("lost response"));
    await expect(call("browser_start")).rejects.toThrow("不能盲目重放");
    const own = { request_id: bridge.resource?.remote?.request_id, session };
    const sessions =
      kind === "缺失"
        ? []
        : kind === "重复"
          ? [own, own]
          : [{ ...own, session: { ...session, grant_id: "foreign" } }];
    sdk.call.mockResolvedValueOnce(result({ sessions }));
    await expect(call("browser_stop")).rejects.toThrow(
      kind === "另一许可" ? "归属" : "唯一确认",
    );
    expect(bridge.resource?.state).toBe("unknown");
    expect(bridge.resource?.remote?.session_id).toBeUndefined();
    expect(sdk.call.mock.calls.map(([input]) => input.name)).toEqual([
      "browser_start",
      "browser_sessions",
    ]);
  },
);
it("确定未分配的失败请求仅核对一次便确认不存在，不发送无身份关闭", async () => {
  sdk.call.mockRejectedValueOnce(new Error("lost start response"));
  await expect(call("browser_start")).rejects.toThrow("不能盲目重放");
  const proof = {
    request: {
      request_id: bridge.resource?.remote?.request_id,
      node_id: session.node_id,
      grant_id: session.grant_id,
      state: "FAILED",
      session_id: null,
      error_code: "RESOURCE_BUSY",
      execution_outcome: "NOT_STARTED",
    },
    sessions: [],
  };
  sdk.call.mockResolvedValueOnce(result(proof));
  expect((await call("browser_stop")).structuredContent).toEqual(proof);
  expect(bridge.resource?.state).toBe("absent");
  expect(bridge.resource?.remote?.session_id).toBeUndefined();
  expect(sdk.call.mock.calls.map(([input]) => input.name)).toEqual([
    "browser_start",
    "browser_sessions",
  ]);
});
it.each([
  { state: "PENDING", session_id: null, execution_outcome: "NOT_STARTED" },
  { state: "UNKNOWN", session_id: null, execution_outcome: "NOT_STARTED" },
  { state: "NOT_FOUND", session_id: null, execution_outcome: "NOT_STARTED" },
  { state: "FAILED", session_id: null, execution_outcome: "OUTCOME_UNKNOWN" },
  { state: "FAILED", execution_outcome: "NOT_STARTED" },
])("未分配证据不完整或未知（$state）时保留隔离", async (request) => {
  sdk.call.mockRejectedValueOnce(new Error("lost start response"));
  await expect(call("browser_start")).rejects.toThrow("不能盲目重放");
  sdk.call.mockResolvedValueOnce(
    result({
      request: {
        request_id: bridge.resource?.remote?.request_id,
        node_id: session.node_id,
        grant_id: session.grant_id,
        ...request,
      },
      sessions: [],
    }),
  );
  await expect(call("browser_stop")).rejects.toThrow("隔离仍保留");
  expect(bridge.resource?.state).toBe("unknown");
  expect(sdk.call.mock.calls.map(([input]) => input.name)).toEqual([
    "browser_start",
    "browser_sessions",
  ]);
});
it.each([
  "请求不符",
  "节点不符",
  "许可不符",
  "会话不符",
  "失败却列出会话",
  "无记录却列出会话",
])("请求核对结果%s时不采用矛盾证据", async (kind) => {
  sdk.call.mockRejectedValueOnce(new Error("lost start response"));
  await expect(call("browser_start")).rejects.toThrow("不能盲目重放");
  const request = bridge.resource?.remote?.request_id;
  sdk.call.mockResolvedValueOnce(
    result({
      request: {
        request_id: kind === "请求不符" ? "foreign" : request,
        node_id: kind === "节点不符" ? "foreign" : session.node_id,
        grant_id: kind === "许可不符" ? "foreign" : session.grant_id,
        state:
          kind === "失败却列出会话"
            ? "FAILED"
            : kind === "无记录却列出会话"
              ? "NOT_FOUND"
              : "SUCCEEDED",
        session_id:
          kind === "失败却列出会话"
            ? null
            : kind === "会话不符"
              ? "foreign"
              : session.session_id,
        execution_outcome: "NOT_STARTED",
      },
      sessions: [{ request_id: request, session }],
    }),
  );
  await expect(call("browser_stop")).rejects.toThrow("隔离仍保留");
  expect(bridge.resource?.state).toBe("unknown");
  expect(bridge.resource?.remote?.session_id).toBeUndefined();
  expect(sdk.call.mock.calls.map(([input]) => input.name)).toEqual([
    "browser_start",
    "browser_sessions",
  ]);
});
it.each(["PENDING", "UNKNOWN", "SUCCEEDED"])(
  "%s 已分配时恢复原会话，不能凭请求状态确认清理",
  async (state) => {
    sdk.call.mockRejectedValueOnce(new Error("lost start response"));
    await expect(call("browser_start")).rejects.toThrow("不能盲目重放");
    const request = bridge.resource?.remote?.request_id;
    sdk.call
      .mockResolvedValueOnce(
        result({
          request: {
            request_id: request,
            node_id: session.node_id,
            grant_id: session.grant_id,
            state,
            session_id: session.session_id,
            error_code: null,
            execution_outcome: "OUTCOME_UNKNOWN",
          },
          sessions: [{ request_id: request, session }],
        }),
      )
      .mockResolvedValueOnce(
        result({
          session: { ...session, state: "FAILED", cleanup: "UNKNOWN" },
        }),
      );
    await call("browser_stop");
    expect(bridge.resource?.state).toBe("unknown");
    expect(bridge.resource?.remote?.session_id).toBe(session.session_id);
    expect(sdk.call.mock.calls.map(([input]) => input.name)).toEqual([
      "browser_start",
      "browser_sessions",
      "browser_stop",
    ]);
  },
);
it.each(["REQUEST_RECORD_LIMIT", "REQUEST_CONCURRENCY_LIMIT"])(
  "%s 在分配前明确拒绝时确认未占用资源",
  async (code) => {
    sdk.call.mockResolvedValueOnce(
      result({ code, execution_outcome: "NOT_STARTED" }, true),
    );
    await expect(call("browser_start")).rejects.toThrow(code);
    expect(bridge.resource?.state).toBe("absent");
    expect(bridge.outcome("call_own")).toBe("NOT_STARTED");
  },
);
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
it.each([1, 2])(
  "%i 个文件合计恰好 4 MiB 时发送原始字节，超出一字节在本机拒绝",
  async (count) => {
    await open();
    const files = Array.from(
      { length: count },
      (_, index) => `边界-${index}.bin`,
    );
    for (const [index, path] of files.entries())
      writeFileSync(
        join(root, path),
        Buffer.alloc((4 * 1024 * 1024) / count, index),
      );
    sdk.call.mockResolvedValueOnce(result({ files }));
    await call("browser_file_upload", {
      files,
      target: { by: "css", value: "#file" },
    });
    const sent = sdk.call.mock.calls.at(-1)![0].arguments.files;
    expect(sent.map((file: any) => file.name)).toEqual(files);
    expect(
      sent.reduce(
        (total: number, file: any) =>
          total + Buffer.from(file.data, "base64").length,
        0,
      ),
    ).toBe(4 * 1024 * 1024);
    for (const [index, file] of sent.entries())
      expect(
        Buffer.from(file.data, "base64").equals(
          Buffer.alloc((4 * 1024 * 1024) / count, index),
        ),
      ).toBe(true);
    writeFileSync(
      join(root, files[0]),
      Buffer.alloc((4 * 1024 * 1024) / count + 1),
    );
    sdk.call.mockClear();
    await expect(
      call("browser_file_upload", {
        files,
        target: { by: "css", value: "#file" },
      }),
    ).rejects.toThrow("不得超过 4 MiB");
    expect(sdk.call).not.toHaveBeenCalled();
  },
);
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

async function hubBridge(mismatch = false) {
  const tools = await (bridge as any).client.listTools();
  await bridge.close();
  const file = join(root, "hub.yaml");
  writeFileSync(
    file,
    'hub_url: "http://hub.test"\nhub_token: "' + "h".repeat(48) + '"\n',
  );
  const http = vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/tools"))
      return new Response(
        JSON.stringify({
          node: { node_id: "node_own" },
          tools: mismatch
            ? tools.tools.map((tool: any, index: number) =>
                index ? tool : { ...tool, description: "审核时目录说明" },
              )
            : tools.tools,
        }),
      );
    const lease = {
      node_id: "node_own",
      grant_id: "grant_own",
      state: init?.method === "DELETE" ? "RELEASED" : "HELD",
      cleanup: "COMPLETE",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      idle_deadline_at: new Date(Date.now() + 600000).toISOString(),
      inflight: false,
      close_reason: init?.method === "DELETE" ? "RELEASED_BY_HOLDER" : null,
    };
    if (url.pathname === "/v1/nodes/node_own/grants")
      return new Response(
        JSON.stringify({
          ...lease,
          token_available: true,
          access_token: "x".repeat(48),
          access_config: {
            hub_url: "http://hub.test",
            node_id: "node_own",
            grant_id: "grant_own",
            access_token: "x".repeat(48),
            expires_at: lease.expires_at,
          },
        }),
        { status: 201 },
      );
    return new Response(JSON.stringify(lease));
  });
  bridge = new RunBridge(
    {
      ...browserPreferenceDefaults,
      backend: "runbridge",
      connectionSource: "hub",
      hubFile: file,
      nodeId: "node_own",
      accessFile: "",
    },
    root,
    () => {},
    {
      credentialFile: join(root, "private", "access.json"),
      cleanupTimeoutMs: 1000,
      invalid: () => {},
    },
  );
  await bridge.preparePlanning();
  defs.clear();
  bridge.register({
    tools: {
      register: (definition: any) => {
        defs.set(definition.name, definition);
        return () => defs.delete(definition.name);
      },
    },
  } as any);
  return http;
}
it("Hub 目录只投影声明，可信首次初始化后才领取并核对实际 MCP 定义", async () => {
  const http = await hubBridge();
  expect((bridge as any).connected).toBe(false);
  expect(
    http.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(0);
  expect(sdk.call).not.toHaveBeenCalled();
  await open();
  expect(sdk.call).toHaveBeenCalledOnce();
  expect(bridge.lease.record).toMatchObject({
    source: "hub",
    node_id: "node_own",
    grant_id: "grant_own",
    state: "HELD",
  });
  await bridge.close();
  expect(bridge.lease.record?.state).toBe("RELEASED");
});
it("实际 MCP 与目录不一致在业务前停止，归还已领取的原 Node", async () => {
  await hubBridge(true);
  await expect(open()).rejects.toThrow("工具定义与审核时目录不一致");
  expect(sdk.call).not.toHaveBeenCalled();
  await bridge.close();
  expect(bridge.lease.record).toMatchObject({
    state: "RELEASED",
    cleanup: "COMPLETE",
  });
});

it("初始化前的远程观察不会领取或接管 Node", async () => {
  await expect(call("browser_status")).rejects.toThrow("尚未启动");
  expect(fetch).not.toHaveBeenCalled();
  expect(bridge.lease.record).toBeUndefined();
  expect(sdk.call).not.toHaveBeenCalled();
});
