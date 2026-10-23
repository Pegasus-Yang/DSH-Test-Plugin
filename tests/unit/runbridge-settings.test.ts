import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRunBridgeSettings } from "../../src/runbridge-settings.js";
const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  list: vi.fn(),
  call: vi.fn(),
  close: vi.fn(),
  transport: vi.fn(),
}));
vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    connect = sdk.connect;
    listTools = sdk.list;
    callTool = sdk.call;
    close = sdk.close;
  },
  StreamableHTTPClientTransport: class {
    constructor(...args: unknown[]) {
      sdk.transport(...args);
    }
  },
}));
let root: string;
const secret = "PRIVATE_ACCESS_DO_NOT_RETURN_" + "x".repeat(32);
const access = {
  hub_url: "http://hub.test/prefix",
  node_id: "node_one",
  grant_id: "grant_one",
  access_token: secret,
  expires_at: "2030-01-01T00:00:00Z",
};
const node = () => ({
  node_id: "node_one",
  connection_status: "ONLINE",
  capabilities_stale: false,
  capabilities: {
    resources: [
      {
        resource_id: "chromium",
        kind: "MANAGED_CHROMIUM",
        readiness: "READY",
        occupancy: "FREE",
      },
    ],
  },
});
const reply = (value: unknown, isError = false) => ({
  structuredContent: value,
  content: [],
  isError,
});
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "runbridge-settings-"));
  writeFileSync(join(root, "access.json"), JSON.stringify(access));
  sdk.connect.mockReset().mockResolvedValue(undefined);
  sdk.list
    .mockReset()
    .mockResolvedValue({
      tools: [
        "node_inspect",
        "browser_start",
        "browser_stop",
        "browser_status",
        "browser_capture",
      ].map((name) => ({ name })),
    });
  sdk.call.mockReset().mockResolvedValue(reply(node()));
  sdk.close.mockReset().mockResolvedValue(undefined);
  sdk.transport.mockReset();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const check = (connect = true, signal = new AbortController().signal) =>
  checkRunBridgeSettings(
    root,
    { accessFile: "access.json", resourceId: "chromium", connect },
    signal,
  );
it("读取文件只返回无秘密摘要，保留反向代理前缀；内容变化使版本失效", async () => {
  const first = await check(false);
  expect(first).toMatchObject({
    ok: true,
    code: "FILE_VALID",
    file: {
      hub_url: "http://hub.test/prefix",
      mcp_url: "http://hub.test/prefix/mcp",
      node_id: "node_one",
      grant_id: "grant_one",
      expires_at: access.expires_at,
    },
  });
  expect(JSON.stringify(first)).not.toContain(secret);
  expect(sdk.connect).not.toHaveBeenCalled();
  writeFileSync(
    join(root, "access.json"),
    JSON.stringify({ ...access, access_token: secret + "new" }),
  );
  expect((await check(false)).file?.revision).not.toBe(first.file?.revision);
});
it.each([
  ["登记令牌纯文本", secret, "不是连接 JSON"],
  ["字段遗漏", JSON.stringify({ node_id: "one" }), "hub_url"],
  ["空白字段", JSON.stringify({ ...access, grant_id: " " }), "grant_id"],
  [
    "完整MCP地址",
    JSON.stringify({ ...access, hub_url: "http://hub.test/prefix/mcp/" }),
    "Hub 基址",
  ],
  [
    "非HTTP地址",
    JSON.stringify({ ...access, hub_url: "file:///secret" }),
    "合同",
  ],
  [
    "地址带凭据",
    JSON.stringify({ ...access, hub_url: "http://user:pass@hub.test" }),
    "合同",
  ],
  [
    "占位令牌",
    JSON.stringify({ ...access, access_token: "<访问令牌>" }),
    "合同",
  ],
  ["数组", JSON.stringify([access]), "hub_url"],
  ["过大文件", " ".repeat(32769), "32 KiB"],
])("%s在文件阶段拒绝，不握手或泄漏内容", async (_name, text, message) => {
  writeFileSync(join(root, "access.json"), text);
  const result = await check();
  expect(result).toMatchObject({ ok: false, code: "ACCESS_FILE_INVALID" });
  expect(result.message).toContain(message);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(sdk.connect).not.toHaveBeenCalled();
});
it("连接只做握手、清单与一次只读查询，关闭临时客户端，不分配会话", async () => {
  expect(await check()).toMatchObject({
    ok: true,
    code: "CONNECTION_READY",
    hub_connected: true,
    node_status: "ONLINE",
    resources: [
      { resource_id: "chromium", readiness: "READY", occupancy: "FREE" },
    ],
  });
  expect(sdk.transport).toHaveBeenCalledWith(
    new URL("http://hub.test/prefix/mcp"),
    { requestInit: { headers: { Authorization: `Bearer ${secret}` } } },
  );
  expect(sdk.call).toHaveBeenCalledTimes(1);
  expect(sdk.call.mock.calls[0][0]).toEqual({
    name: "node_inspect",
    arguments: { node_id: "node_one" },
  });
  expect(sdk.close).toHaveBeenCalledOnce();
});
it.each([
  ["节点离线", { ...node(), connection_status: "OFFLINE" }, "NODE_OFFLINE"],
  ["快照过期", { ...node(), capabilities_stale: true }, "CAPABILITIES_STALE"],
  ["节点身份不符", { ...node(), node_id: "foreign" }, "NODE_RESULT_INVALID"],
  [
    "资源未就绪",
    {
      ...node(),
      capabilities: {
        resources: [
          { ...node().capabilities.resources[0], readiness: "UNAVAILABLE" },
        ],
      },
    },
    "RESOURCE_NOT_READY",
  ],
  [
    "资源忙",
    {
      ...node(),
      capabilities: {
        resources: [{ ...node().capabilities.resources[0], occupancy: "BUSY" }],
      },
    },
    "RESOURCE_BUSY",
  ],
  [
    "借用资源不用于MCP",
    {
      ...node(),
      capabilities: {
        resources: [
          { ...node().capabilities.resources[0], kind: "BORROWED_CHROME_CDP" },
        ],
      },
    },
    "RESOURCE_NOT_FOUND",
  ],
])("%s与Hub连接失败分开返回", async (_label, value, code) => {
  sdk.call.mockResolvedValue(reply(value));
  const result = await check();
  expect(result).toMatchObject({ ok: false, hub_connected: true, code });
  expect(sdk.close).toHaveBeenCalledOnce();
});
it.each([
  [401, "ACCESS_DENIED"],
  [403, "ACCESS_DENIED"],
  [404, "MCP_NOT_FOUND"],
  [503, "HUB_UNAVAILABLE"],
])("HTTP %i 使用固定安全文案", async (status, code) => {
  sdk.connect.mockRejectedValue(
    Object.assign(new Error(secret), { data: { status } }),
  );
  const result = await check();
  expect(result.code).toBe(code);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(sdk.close).toHaveBeenCalledOnce();
});
it("远程错误内容不会进入摘要，缺工具时不查询节点", async () => {
  sdk.call.mockResolvedValue(
    reply({ code: "ACCESS_REVOKED", message: secret }, true),
  );
  expect(JSON.stringify(await check())).not.toContain(secret);
  sdk.call.mockClear();
  sdk.list.mockResolvedValue({ tools: [] });
  expect((await check()).code).toBe("MCP_TOOLS_MISSING");
  expect(sdk.call).not.toHaveBeenCalled();
});
it("取消尚未完成的握手后关闭连接，迟到结果不再查询节点", async () => {
  let finish: () => void = () => {};
  sdk.connect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = check(true, controller.signal);
  await vi.waitFor(() => expect(sdk.connect).toHaveBeenCalledOnce());
  controller.abort();
  expect((await pending).code).toBe("CHECK_CANCELLED");
  finish();
  await Promise.resolve();
  expect(sdk.call).not.toHaveBeenCalled();
  expect(sdk.close).toHaveBeenCalledOnce();
});
