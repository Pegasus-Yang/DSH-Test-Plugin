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
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
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
      .replace("<Node所有者签发的访问令牌>", secret),
  );
  const { expires_at: _expires, ...required } = access;
  expect(readRunBridgeAccess(join(root, "template.yaml"))).toEqual(required);
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
