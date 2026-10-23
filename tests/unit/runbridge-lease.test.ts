import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeLease, readNodeCatalog } from "../../src/runbridge-lease.js";
import {
  readRunBridgeAccess,
  readRunBridgeHubCredentials,
} from "../../src/runbridge-access.js";

let root: string;
const leases: NodeLease[] = [];
const hubToken = "hub_PRIVATE_" + "h".repeat(40);
const nodeToken = "node_PRIVATE_" + "n".repeat(40);
const credentials = { hub_url: "http://hub.test/prefix", hub_token: hubToken };
const access = {
  hub_url: credentials.hub_url,
  node_id: "node_one",
  grant_id: "grant_one",
  access_token: nodeToken,
};
const state = (patch: Record<string, unknown> = {}) => ({
  node_id: access.node_id,
  grant_id: access.grant_id,
  state: "HELD",
  cleanup: "COMPLETE",
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  idle_deadline_at: new Date(Date.now() + 600000).toISOString(),
  inflight: false,
  close_reason: null,
  ...patch,
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const claimed = (patch: Record<string, unknown> = {}) => {
  const lease = state(patch);
  return {
    ...lease,
    token_available: true,
    access_token: nodeToken,
    access_config: { ...access, expires_at: lease.expires_at },
  };
};
const ended = () =>
  state({ state: "RELEASED", close_reason: "RELEASED_BY_HOLDER" });
function create(changed = () => {}, invalid = (_reason: string) => {}) {
  const lease = new NodeLease(
    {
      kind: "hub",
      credentials,
      nodeId: access.node_id,
      file: join(root, "private", "access.json"),
    },
    changed,
    invalid,
  );
  leases.push(lease);
  return lease;
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "node-lease-"));
});
afterEach(async () => {
  await Promise.allSettled(leases.splice(0).map((lease) => lease.release(50)));
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

it.each(["yaml", "json"])(
  "Hub %s 文件使用独立解析器，不能与节点访问文件互换",
  (format) => {
    const file = join(root, "hub." + format);
    writeFileSync(
      file,
      format === "yaml"
        ? `# 共享申请凭据\nhub_url: "${credentials.hub_url}/"\nhub_token: "${hubToken}"\n`
        : JSON.stringify(credentials),
    );
    expect(readRunBridgeHubCredentials(file)).toEqual(credentials);
    expect(() => readRunBridgeAccess(file)).toThrow("node_id");
    writeFileSync(file, JSON.stringify(access));
    expect(() => readRunBridgeHubCredentials(file)).toThrow("hub_token");
  },
);
it("只读目录保留 MCP 工具声明，不发出申请，也不将凭据放在 URL", async () => {
  const tools = [{ name: "browser_start", inputSchema: { type: "object" } }];
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(response({ node: { node_id: access.node_id }, tools }));
  expect((await readNodeCatalog(credentials, access.node_id)).tools).toEqual(
    tools,
  );
  expect(http).toHaveBeenCalledOnce();
  const [url, init] = http.mock.calls[0];
  expect(String(url)).toBe(
    "http://hub.test/prefix/v1/pool/nodes/node_one/tools",
  );
  expect(init?.method).toBe("GET");
  expect(init?.headers).toMatchObject({ Authorization: `Bearer ${hubToken}` });
  expect(String(url)).not.toContain(hubToken);
});
it("首次申请身份先通知持久化，整批只领取一次，执行令牌保存为独立私有五字段文件", async () => {
  const records: unknown[] = [];
  let lease: NodeLease;
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        expect(records).toHaveLength(1);
        expect(lease.record?.state).toBe("CLAIMING");
        expect(JSON.parse(String(init.body)).request_id).toBe(
          lease.record?.request_id,
        );
        return response(claimed(), 201);
      }
      return response(init?.method === "DELETE" ? ended() : state());
    });
  lease = create(() => records.push(structuredClone(lease.record)));
  await Promise.all([lease.activate(), lease.activate()]);
  await lease.maintain();
  expect(
    http.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
  const file = lease.record!.access_file!;
  expect(Object.keys(JSON.parse(readFileSync(file, "utf8"))).sort()).toEqual(
    ["hub_url", "node_id", "grant_id", "access_token", "expires_at"].sort(),
  );
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(join(root, "private")).mode & 0o777).toBe(0o700);
  expect(JSON.stringify(records)).not.toContain(nodeToken);
  expect(JSON.stringify(records)).not.toContain(hubToken);
  await lease.release(1000);
  expect(lease.record).toMatchObject({
    state: "RELEASED",
    cleanup: "COMPLETE",
  });
  expect(existsSync(file)).toBe(false);
});
it("申请响应丢失保持 UNKNOWN，不重试、不泄露原异常，也不虚构原令牌", async () => {
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error(hubToken));
  const lease = create();
  await expect(lease.activate()).rejects.not.toThrow(hubToken);
  await expect(lease.activate()).rejects.toThrow("有效确认");
  expect(http).toHaveBeenCalledOnce();
  expect(lease.record).toMatchObject({ state: "UNKNOWN" });
  expect(lease.record?.request_id).toMatch(/^claim_/);
  expect(lease.access).toBeUndefined();
  await expect(lease.release(1000)).rejects.toThrow("没有原节点令牌");
});
it("同 ID 重复申请无首次令牌时不继续，也不申请第二份使用权", async () => {
  const http = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    response({
      node_id: access.node_id,
      grant_id: access.grant_id,
      state: "HELD",
      token_available: false,
    }),
  );
  const lease = create();
  await expect(lease.activate()).rejects.toThrow("首次执行令牌");
  await expect(lease.activate()).rejects.toThrow();
  expect(http).toHaveBeenCalledOnce();
  expect(lease.record).toMatchObject({
    state: "UNKNOWN",
    grant_id: access.grant_id,
  });
});
it("明确占用拒绝不误报已领取，也不释放其他持有者", async () => {
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      response({ code: "NODE_LEASE_BUSY", detail: nodeToken }, 409),
    );
  const lease = create();
  await expect(lease.activate()).rejects.toThrow("NODE_LEASE_BUSY");
  expect(lease.record?.state).toBe("NOT_ACQUIRED");
  expect(JSON.stringify(lease.record)).not.toContain(nodeToken);
  await lease.release(1000);
  expect(http).toHaveBeenCalledOnce();
});
it("现成访问文件使用原节点令牌查询和释放，不使用 Hub 凭据或删除用户文件", async () => {
  const file = join(root, "user-access.yaml");
  writeFileSync(file, JSON.stringify(access));
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, init) =>
      response(init?.method === "DELETE" ? ended() : state()),
    );
  const lease = new NodeLease({ kind: "access-file", access, file });
  leases.push(lease);
  await lease.activate();
  await lease.release(1000);
  expect(existsSync(file)).toBe(true);
  expect(http.mock.calls.map(([, init]) => init?.method)).toEqual([
    "GET",
    "DELETE",
  ]);
  for (const [url, init] of http.mock.calls) {
    expect(String(url)).toContain("/v1/grants/grant_one");
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${nodeToken}`,
    });
  }
});
it("临近到期只续原租约，不改变 Hub 返回的空闲截止时间", async () => {
  vi.useFakeTimers();
  const start = Date.now(),
    original = state({ expires_at: new Date(start + 9000).toISOString() });
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, init) => {
      if (String(url).endsWith("/grants"))
        return response(claimed(original), 201);
      if (String(url).endsWith("/renew"))
        return response({
          ...original,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        });
      return response(init?.method === "DELETE" ? ended() : original);
    });
  const lease = create();
  await lease.activate();
  vi.setSystemTime(start + 7000);
  await lease.maintain();
  expect(lease.record?.idle_deadline_at).toBe(original.idle_deadline_at);
  const renew = http.mock.calls.find(([url]) =>
    String(url).endsWith("/renew"),
  )!;
  expect(renew[1]?.headers).toMatchObject({
    Authorization: `Bearer ${nodeToken}`,
  });
  expect(
    http.mock.calls.filter(([url]) => String(url).endsWith("/grants")),
  ).toHaveLength(1);
});
it("运行中已释放不复活、不重新申请，仍可按原身份重复释放", async () => {
  let released = false;
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      response(
        String(url).endsWith("/grants")
          ? claimed()
          : released
            ? ended()
            : state(),
        String(url).endsWith("/grants") ? 201 : 200,
      ),
    );
  const lease = create();
  await lease.activate();
  released = true;
  await expect(lease.maintain()).rejects.toThrow("不能领取新租约");
  await lease.release(1000);
  expect(
    http.mock.calls.filter(([url]) => String(url).endsWith("/grants")),
  ).toHaveLength(1);
});
it("状态必须匹配原 Node 和 grant，不能用另一份租约覆盖", async () => {
  let wrong = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
    response(
      String(url).endsWith("/grants")
        ? claimed()
        : init?.method === "DELETE"
          ? ended()
          : state({ grant_id: wrong ? "grant_other" : access.grant_id }),
      String(url).endsWith("/grants") ? 201 : 200,
    ),
  );
  const lease = create();
  await lease.activate();
  wrong = true;
  await expect(lease.maintain()).rejects.toThrow("归属");
  expect(lease.record?.grant_id).toBe(access.grant_id);
});
it("202 回收中必须等原租约查询确认 RELEASED 且 COMPLETE", async () => {
  vi.useFakeTimers();
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, init) =>
      response(
        String(url).endsWith("/grants")
          ? claimed()
          : init?.method === "DELETE"
            ? state({ state: "RELEASING", cleanup: "PENDING" })
            : ended(),
        String(url).endsWith("/grants")
          ? 201
          : init?.method === "DELETE"
            ? 202
            : 200,
      ),
    );
  const lease = create();
  await lease.activate();
  let done = false;
  const closing = lease.release(1000).then(() => {
    done = true;
  });
  await vi.advanceTimersByTimeAsync(249);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await closing;
  expect(done).toBe(true);
  expect(
    http.mock.calls.filter(([, init]) => init?.method === "DELETE"),
  ).toHaveLength(1);
  expect(lease.record?.state).toBe("RELEASED");
});
it.each([
  ["QUARANTINED", "UNKNOWN"],
  ["RELEASED", "PENDING"],
])(
  "%s / %s 不能宣称设备归还，也不删除恢复令牌",
  async (leaseState, cleanup) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      response(
        String(url).endsWith("/grants")
          ? claimed()
          : state({ state: leaseState, cleanup }),
        String(url).endsWith("/grants") ? 201 : 200,
      ),
    );
    const lease = create();
    await lease.activate();
    await expect(lease.release(1000)).rejects.toThrow("归还未获确认");
    expect(lease.record).toMatchObject({ state: leaseState, cleanup });
    expect(existsSync(lease.record!.access_file!)).toBe(true);
  },
);

it("Hub 未配置申请凭据是明确拒绝，不误报未知领取", async () => {
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(response({ code: "HUB_ACCESS_NOT_CONFIGURED" }, 503));
  const lease = create();
  await expect(lease.activate()).rejects.toThrow("HUB_ACCESS_NOT_CONFIGURED");
  expect(lease.record?.state).toBe("NOT_ACQUIRED");
  await lease.release(1000);
  expect(http).toHaveBeenCalledOnce();
});
it("后台状态无法确认时通知停止旧任务，记录原身份而不自动重领", async () => {
  vi.useFakeTimers();
  const invalid = vi.fn(),
    original = state({
      expires_at: new Date(Date.now() + 12000).toISOString(),
    });
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, init) => {
      if (String(url).endsWith("/grants"))
        return response(claimed(original), 201);
      if (init?.method === "DELETE") return response(ended());
      return response({ code: "INVALID_ACCESS_TOKEN" }, 401);
    });
  const lease = create(() => {}, invalid);
  await lease.activate();
  await vi.advanceTimersByTimeAsync(3000);
  expect(invalid).toHaveBeenCalledOnce();
  expect(lease.record).toMatchObject({
    state: "UNKNOWN",
    node_id: access.node_id,
    grant_id: access.grant_id,
  });
  expect(
    http.mock.calls.filter(([url]) => String(url).endsWith("/grants")),
  ).toHaveLength(1);
});

it("领取仍在途时收尾等待原响应，再释放同一 grant，不启动新的保活或申请", async () => {
  let respond!: (response: Response) => void;
  const http = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).endsWith("/grants"))
      return new Promise<Response>((done) => {
        respond = done;
      });
    return response(ended());
  });
  const lease = create();
  const activation = lease.activate();
  let finished = false;
  const closing = lease.release(1000).then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  respond(response(claimed(), 201));
  await activation;
  await closing;
  expect(lease.record).toMatchObject({
    state: "RELEASED",
    cleanup: "COMPLETE",
  });
  expect(http.mock.calls.map(([, init]) => init?.method)).toEqual([
    "POST",
    "DELETE",
  ]);
});
