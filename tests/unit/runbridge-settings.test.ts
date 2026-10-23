import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRunBridgeSettings } from "../../src/runbridge-settings.js";
import { readRunBridgeAccess, RunBridge } from "../../src/runbridge.js";
import {
  browserPreferenceDefaults,
  runbridgeAccessTemplate,
} from "../../src/browser-preferences.js";
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
  sdk.list.mockReset().mockResolvedValue({
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
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          node_id: access.node_id,
          grant_id: access.grant_id,
          state: "HELD",
          cleanup: "COMPLETE",
          expires_at: access.expires_at,
          idle_deadline_at: "2030-01-01T00:00:00Z",
          inflight: false,
          close_reason: null,
        }),
      ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
const check = (connect = true, signal = new AbortController().signal) =>
  checkRunBridgeSettings(
    root,
    { accessFile: "access.json", resourceId: "chromium", connect },
    signal,
  );
const yamlAccess = `# Node 所有者签发的私有配置
hub_url: "http://hub.test/prefix" # 保留代理前缀
node_id: node_one
grant_id: grant_one
access_token: "${secret}"
expires_at: 2030-01-01T00:00:00Z
`;
it.each(["access.yaml", "access.yml", "access.json", "access"])(
  "带注释 YAML 按内容读取，不依赖后缀 %s，摘要不回传令牌",
  async (accessFile) => {
    writeFileSync(join(root, accessFile), yamlAccess);
    expect(readRunBridgeAccess(join(root, accessFile))).toEqual(access);
    const result = await checkRunBridgeSettings(
      root,
      { accessFile, resourceId: "chromium", connect: false },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: true, code: "FILE_VALID" });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(sdk.connect).not.toHaveBeenCalled();
  },
);
it("JSON 和同内容 YAML 使用相同摘要，注释不会改变连接身份", async () => {
  const original = await check(false);
  writeFileSync(join(root, "access.json"), yamlAccess + "# 补充维护说明\n");
  const yaml = await check(false);
  expect(yaml.file).toEqual(original.file);
});
it("实际运行与设置检测共用 YAML 解析，保留引号内的特殊字符", async () => {
  const token = secret + "_#literal:value";
  writeFileSync(join(root, "access.yml"), yamlAccess.replace(secret, token));
  const bridge = new RunBridge(
    {
      ...browserPreferenceDefaults,
      backend: "runbridge",
      accessFile: "access.yml",
    },
    root,
  );
  expect(bridge.access).toEqual({ ...access, access_token: token });
  expect(sdk.connect).not.toHaveBeenCalled();
  const result = await checkRunBridgeSettings(
    root,
    { accessFile: "access.yml", resourceId: "chromium", connect: true },
    new AbortController().signal,
  );
  expect(result.code).toBe("CONNECTION_READY");
  expect(sdk.call).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain(token);
});
it("插件 YAML 模板可直接替换签发值读取，保留说明注释", () => {
  expect(runbridgeAccessTemplate).toContain("# Hub 基址");
  writeFileSync(
    join(root, "template.yaml"),
    runbridgeAccessTemplate
      .replace("http://hub.example:8787", access.hub_url)
      .replace("node_example", access.node_id)
      .replace("grant_example", access.grant_id)
      .replace("<Hub本次签发的节点令牌>", secret),
  );
  expect(readRunBridgeAccess(join(root, "template.yaml"))).toEqual(access);
});
it.each([
  ["语法错误", `${yamlAccess}invalid: [`, "格式无效"],
  ["重复字段", `${yamlAccess}grant_id: other`, "格式无效"],
  ["多文档", `${yamlAccess}\n---\n${yamlAccess}`, "格式无效"],
  ["自定义标签", `${yamlAccess}custom: !private ${secret}`, "格式无效"],
  ["循环别名", `${yamlAccess}cycle: &cycle {self: *cycle}`, "格式无效"],
  ["顶层列表", `- ${secret}`, "JSON 或 YAML 对象"],
  ["空文件", "# 尚未填写\n", "JSON 或 YAML 对象"],
  [
    "字段类型错误",
    yamlAccess.replace("node_id: node_one", "node_id: 123"),
    "node_id",
  ],
])(
  "无效 YAML %s 安全拒绝，不记录原文或发起连接",
  async (_name, content, message) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      writeFileSync(join(root, "access.json"), content);
      const result = await check();
      expect(result).toMatchObject({ ok: false, code: "ACCESS_FILE_INVALID" });
      expect(result.message).toContain(message);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(warning).not.toHaveBeenCalled();
      expect(sdk.connect).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  },
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
  ["登记令牌纯文本", secret, "enrollment.token"],
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

const hubSecret = "PRIVATE_HUB_TOKEN_" + "h".repeat(48);
function hubInput() {
  writeFileSync(
    join(root, "hub.yaml"),
    `# 共享申请凭据\nhub_url: http://hub.test/prefix\nhub_token: "${hubSecret}"\n`,
  );
  return {
    connectionSource: "hub" as const,
    hubFile: "hub.yaml",
    accessFile: "",
    nodeId: "node_one",
    resourceId: "chromium",
    connect: true,
  };
}
function catalogResponse(leaseState = "UNCLAIMED", claimable = true) {
  return new Response(
    JSON.stringify({
      node: { ...node(), lease: { state: leaseState, claimable } },
      tools: [{ name: "browser_start", inputSchema: { type: "object" } }],
    }),
  );
}
it("Hub 来源只读工具目录，不领取、不建立执行 MCP，也不回传共享凭据", async () => {
  const input = hubInput();
  const http = vi
    .mocked(fetch)
    .mockImplementation(async () => catalogResponse());
  const result = await checkRunBridgeSettings(
    root,
    input,
    new AbortController().signal,
  );
  expect(result).toMatchObject({
    ok: true,
    code: "HUB_CATALOG_READY",
    pool_lease: { state: "UNCLAIMED", claimable: true },
  });
  expect(JSON.stringify(result)).not.toContain(hubSecret);
  expect(result.file?.grant_id).toBeUndefined();
  expect(sdk.connect).not.toHaveBeenCalled();
  expect(sdk.call).not.toHaveBeenCalled();
  expect(http).toHaveBeenCalledOnce();
  expect(http.mock.calls[0][1]?.method).toBe("GET");
});
it("Hub 来源离线读取不联网，两个来源不根据缺少字段互相回退", async () => {
  const input = hubInput();
  const result = await checkRunBridgeSettings(
    root,
    { ...input, connect: false },
    new AbortController().signal,
  );
  expect(result.code).toBe("FILE_VALID");
  expect(fetch).not.toHaveBeenCalled();
  const wrongHub = await checkRunBridgeSettings(
    root,
    { ...input, hubFile: "access.json" },
    new AbortController().signal,
  );
  expect(wrongHub.code).toBe("ACCESS_FILE_INVALID");
  expect(wrongHub.message).toContain("hub_token");
  const wrongNode = await checkRunBridgeSettings(
    root,
    { ...input, connectionSource: "access-file", accessFile: "hub.yaml" },
    new AbortController().signal,
  );
  expect(wrongNode.code).toBe("ACCESS_FILE_INVALID");
  expect(wrongNode.message).toContain("grant_id");
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["HELD", "RELEASING", "QUARANTINED"])(
  "Hub 目录中资源 FREE 但 Node 为 %s，不能宣称可领取",
  async (state) => {
    const input = hubInput();
    vi.mocked(fetch).mockImplementation(async () =>
      catalogResponse(state, false),
    );
    const result = await checkRunBridgeSettings(
      root,
      input,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      ok: false,
      code: "NODE_NOT_CLAIMABLE",
      hub_connected: true,
      pool_lease: { state, claimable: false },
    });
    expect(result.resources?.[0].occupancy).toBe("FREE");
    expect(sdk.connect).not.toHaveBeenCalled();
  },
);
it("现成文件标注远期到期，但 Hub 已空闲回收时不建立执行连接", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        node_id: access.node_id,
        grant_id: access.grant_id,
        state: "RELEASED",
        cleanup: "COMPLETE",
        expires_at: access.expires_at,
        idle_deadline_at: access.expires_at,
        inflight: false,
        close_reason: "IDLE_TIMEOUT",
      }),
    ),
  );
  const result = await check();
  expect(result).toMatchObject({
    ok: false,
    code: "NODE_LEASE_INACTIVE",
    node_lease: { state: "RELEASED", close_reason: "IDLE_TIMEOUT" },
  });
  expect(sdk.connect).not.toHaveBeenCalled();
  expect(sdk.call).not.toHaveBeenCalled();
});
it("取消 Hub 目录检测不发请求，不接受远端原始错误中的凭据", async () => {
  const input = hubInput(),
    controller = new AbortController();
  controller.abort();
  const cancelled = await checkRunBridgeSettings(
    root,
    input,
    controller.signal,
  );
  expect(cancelled.code).toBe("CHECK_CANCELLED");
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({ code: "INVALID_HUB_TOKEN", message: hubSecret }),
      { status: 401 },
    ),
  );
  const denied = await checkRunBridgeSettings(
    root,
    input,
    new AbortController().signal,
  );
  expect(denied.code).toBe("INVALID_HUB_TOKEN");
  expect(JSON.stringify(denied)).not.toContain(hubSecret);
});
