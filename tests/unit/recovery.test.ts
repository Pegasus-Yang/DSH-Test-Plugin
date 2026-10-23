import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RecoveryManager } from "../../src/recovery.js";
import type { SuiteRun } from "../../src/contracts.js";

const roots: string[] = [];
beforeEach(() => {
  const original = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.host !== "hub.test" || url.pathname !== "/v1/grants/grant_own")
      return original(input, init);
    return new Response(
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
    );
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function setup(timeout = 1000) {
  const root = mkdtempSync(join(tmpdir(), "test-recovery-"));
  roots.push(root);
  let active = false;
  const close = vi.fn(async (_input: unknown) => ({
    isError: false,
    value: null,
    content: [],
  }));
  const preview = vi.fn(async () => {});
  const agent = {
    id: "origin",
    status: "idle",
    ctx: { tools: { get: vi.fn(() => ({})), execute: close } },
  };
  const manager = new RecoveryManager(root, timeout, () => active, preview);
  const run = {
    suite_run_id: "run-old",
    instances: [{ resources: { browser_context: { state: "exists" } } }],
  } as unknown as SuiteRun;
  mkdirSync(join(root, run.suite_run_id));
  const original = JSON.stringify(run);
  writeFileSync(join(root, run.suite_run_id, "results.json"), original);
  manager.mark(run, "浏览器释放未获确认");
  const token = () => manager.status().quarantine!.token;
  const recover = () =>
    manager.recover(agent as never, token(), new AbortController().signal);
  return {
    root,
    manager,
    agent,
    close,
    preview,
    run,
    token,
    recover,
    original,
    setActive: (value: boolean) => {
      active = value;
    },
  };
}
it("隔离超过清理超时才标记可能卡住，读取状态不会自行释放或关闭浏览器", () => {
  const t = setup();
  const started = Date.parse(t.manager.status().quarantine!.created_at!);
  expect(t.manager.status(started + 999).quarantine).toMatchObject({
    overdue: false,
    elapsed_ms: 999,
    can_recover: true,
  });
  expect(t.manager.status(started + 1000).quarantine).toMatchObject({
    overdue: true,
    timeout_ms: 1000,
    can_recover: true,
  });
  expect(t.close).not.toHaveBeenCalled();
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(true);
});
it("重复记录同一遗留运行不重置隔离时间，新运行产生新的确认编号", () => {
  const t = setup();
  const before = t.manager.status().quarantine!;
  t.manager.mark(t.run, "重启后仍需处置");
  expect(t.manager.status().quarantine!.created_at).toBe(before.created_at);
  t.manager.mark({ ...t.run, suite_run_id: "run-new" }, "另一资源未释放");
  expect(t.token()).not.toBe(before.token);
});
it("确认恢复经原生关闭工具和预览收尾后留存审计，旧结果保持原样", async () => {
  const t = setup();
  expect(await t.recover()).toContain("已释放");
  expect(t.close).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "mcp__playwright__browser_close",
      agent: t.agent,
      arguments: {},
    }),
  );
  expect(t.preview).toHaveBeenCalledTimes(1);
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(false);
  expect(readFileSync(join(t.root, "run-old/results.json"), "utf8")).toBe(
    t.original,
  );
  const audit = readdirSync(t.root).find((name) =>
    name.startsWith("release-"),
  )!;
  expect(JSON.parse(readFileSync(join(t.root, audit), "utf8"))).toMatchObject({
    quarantine: { details: { run_id: "run-old" } },
    proof: {
      evidence: { method: "confirmed-browser-recovery", preview_stopped: true },
    },
  });
});
it("过期确认和活动测试不能关闭浏览器或删除隔离", async () => {
  const t = setup();
  const old = t.token();
  t.manager.mark({ ...t.run, suite_run_id: "run-new" }, "新隔离");
  await expect(
    t.manager.recover(t.agent as never, old, new AbortController().signal),
  ).rejects.toThrow("已变化");
  t.setActive(true);
  await expect(t.recover()).rejects.toThrow("活动测试");
  expect(t.close).not.toHaveBeenCalled();
});
it("关闭期间隔离被替换时不能释放新的隔离", async () => {
  const t = setup();
  let finish!: (value: any) => void;
  t.close.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const operation = t.recover();
  t.manager.mark({ ...t.run, suite_run_id: "run-new" }, "新隔离");
  finish({ isError: false, value: null, content: [] });
  await expect(operation).rejects.toThrow("已变化");
  expect(t.manager.status().quarantine!.run_id).toBe("run-new");
  expect(
    readdirSync(t.root).filter((name) => name.startsWith("release-")),
  ).toHaveLength(0);
});
it("审批拒绝或关闭失败保持隔离并给出可读原因", async () => {
  const t = setup();
  t.close.mockResolvedValue({ isError: true } as never);
  await expect(t.recover()).rejects.toThrow("隔离仍保留");
  expect(t.preview).not.toHaveBeenCalled();
  expect(t.manager.status()).toMatchObject({
    recovering: false,
    last_error: expect.stringContaining("关闭未成功"),
  });
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(true);
});
it("释放超时立即回报，但在途操作未结算前继续互斥，迟到成功不能解除隔离", async () => {
  vi.useFakeTimers();
  const t = setup(20);
  let finish!: (value: any) => void;
  t.close.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const operation = t.recover();
  const rejected = expect(operation).rejects.toThrow("释放操作超时");
  await vi.advanceTimersByTimeAsync(20);
  await rejected;
  expect(t.manager.busy).toBe(true);
  await expect(t.recover()).rejects.toThrow("释放操作尚未结束");
  finish({ isError: false, value: null, content: [] });
  await vi.waitFor(() => expect(t.manager.busy).toBe(false));
  expect(t.preview).not.toHaveBeenCalled();
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(true);
});
it("用户取消保留隔离，预览关闭失败也不能只删除标记", async () => {
  const t = setup();
  const controller = new AbortController();
  controller.abort();
  await expect(
    t.manager.recover(t.agent as never, t.token(), controller.signal),
  ).rejects.toThrow("已取消");
  expect(t.close).not.toHaveBeenCalled();
  t.preview.mockRejectedValue(new Error("预览关闭失败"));
  await expect(t.recover()).rejects.toThrow("预览关闭失败");
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(true);
});

it("插件停止时取消在途恢复，不能由已卸载实例的迟到成功删除隔离", async () => {
  const t = setup();
  let finish!: (value: any) => void;
  t.close.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = t.recover();
  t.manager.cancel();
  await expect(pending).rejects.toThrow("已取消");
  expect(t.manager.busy).toBe(true);
  finish({ isError: false, value: null, content: [] });
  await vi.waitFor(() => expect(t.manager.busy).toBe(false));
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(true);
});
it("缺少浏览器、时间或可用关闭工具时提示实际处置，保留原手动释放合同", async () => {
  const t = setup();
  t.agent.ctx.tools.get.mockReturnValue(undefined as never);
  await expect(t.recover()).rejects.toThrow("没有可用");
  writeFileSync(
    join(t.root, "quarantine.json"),
    JSON.stringify({ created_at: "invalid", details: { run_id: "run-old" } }),
  );
  expect(t.manager.status().quarantine).toMatchObject({
    can_recover: false,
    overdue: false,
    unavailable_reason: expect.stringContaining("时间异常"),
  });
  writeFileSync(
    join(t.root, "run-old/results.json"),
    JSON.stringify({ ...t.run, instances: [] }),
  );
  t.manager.mark({ ...t.run, suite_run_id: "run-api" }, "外部请求未确认");
  expect(t.manager.status().quarantine!.can_recover).toBe(false);
  const proof = join(t.root, "proof.json");
  writeFileSync(
    proof,
    JSON.stringify({
      operator: "测试操作者",
      external_stopped: true,
      environment_reset: true,
      details: "测试替身处置",
      evidence: { fixture: true },
    }),
  );
  t.setActive(true);
  expect(() => t.manager.release(proof)).toThrow("活动测试");
  t.setActive(false);
  t.manager.release(proof);
  expect(t.manager.status().quarantine).toBeNull();
});

it.each(
  ["CLOSED", "FAILED", "INTERRUPTED"].flatMap((terminal) =>
    [false, true].map((lost) => ({ terminal, lost })),
  ),
)(
  "远程 $terminal+COMPLETE 按原许可确认释放（启动身份丢失=$lost），保留旧业务结果",
  async ({ terminal, lost }) => {
    const { RunBridge } = await import("../../src/runbridge.js");
    const t = setup();
    const access = join(t.root, "original-access.json");
    writeFileSync(
      access,
      JSON.stringify({
        hub_url: "http://hub.test",
        node_id: "node_own",
        grant_id: "grant_own",
        access_token: "x".repeat(48),
      }),
    );
    const resource: any = {
      id: lost ? "request_own" : "session_own",
      state: "unknown",
      remote: {
        hub_url: "http://hub.test",
        access_file: access,
        node_id: "node_own",
        grant_id: "grant_own",
        resource_id: "chromium",
        request_id: "request_own",
        ...(lost ? {} : { session_id: "session_own" }),
      },
    };
    t.run.instances[0].resources.browser_context = resource;
    t.run.instances[0].status = "ERROR";
    const original = JSON.stringify(t.run);
    writeFileSync(join(t.root, "run-old/results.json"), original);
    const definitions = new Map<string, any>();
    (t.agent.ctx.tools as any).register = (d: any) => {
      definitions.set(d.name, d);
      return () => definitions.delete(d.name);
    };
    const recoveredSession = {
      ...resource.remote,
      session_id: "session_own",
      state: terminal,
      cleanup: "COMPLETE",
    };
    const wire = vi.fn(async (input: any) => ({
      content: [{ type: "text", text: "released" }],
      structuredContent:
        input.name === "browser_sessions"
          ? {
              sessions: [
                { request_id: "request_own", session: recoveredSession },
              ],
            }
          : { session: recoveredSession },
    }));
    const spy = vi
      .spyOn(RunBridge.prototype, "connect")
      .mockImplementation(async function (this: RunBridge) {
        const internal = this as any;
        internal.connected = true;
        internal.client.callTool = wire;
        internal.definitions = [
          {
            name: "browser_stop",
            inputSchema: {
              type: "object",
              properties: { session_id: { type: "string" } },
              required: ["session_id"],
            },
          },
        ];
      });
    t.close.mockImplementation(async (exec: any) => ({
      isError: false,
      value: await definitions.get(exec.name).execute(exec.arguments, exec),
      content: [],
    }));
    try {
      expect(await t.recover()).toContain("已释放");
      expect(wire.mock.calls.at(-1)?.[0]).toMatchObject({
        name: "browser_stop",
        arguments: { session_id: "session_own" },
      });
      expect(wire.mock.calls.map(([input]) => input.name)).toEqual(
        lost ? ["browser_sessions", "browser_stop"] : ["browser_stop"],
      );
      expect(definitions.size).toBe(0);
      expect(readFileSync(join(t.root, "run-old/results.json"), "utf8")).toBe(
        original,
      );
      expect(t.manager.status().quarantine).toBeNull();
    } finally {
      spy.mockRestore();
    }
  },
);

it.each(["FAILED", "PENDING", "UNKNOWN", "NOT_FOUND"])(
  "无会话身份的 %s 请求按原许可核对，只有确定未分配才解除隔离",
  async (state) => {
    const { RunBridge } = await import("../../src/runbridge.js");
    const t = setup();
    const access = join(t.root, "original-access.json");
    writeFileSync(
      access,
      JSON.stringify({
        hub_url: "http://hub.test",
        node_id: "node_own",
        grant_id: "grant_own",
        access_token: "x".repeat(48),
      }),
    );
    t.run.instances[0].resources.browser_context = {
      id: "request_own",
      state: "unknown",
      remote: {
        hub_url: "http://hub.test",
        access_file: access,
        node_id: "node_own",
        grant_id: "grant_own",
        resource_id: "chromium",
        request_id: "request_own",
      },
    };
    t.run.instances[0].status = "ERROR";
    const original = JSON.stringify(t.run);
    writeFileSync(join(t.root, "run-old/results.json"), original);
    const request = {
      request_id: "request_own",
      node_id: "node_own",
      grant_id: "grant_own",
      state,
      session_id: null,
      error_code: "RESOURCE_BUSY",
      execution_outcome: "NOT_STARTED",
    };
    const definitions = new Map<string, any>();
    (t.agent.ctx.tools as any).register = (definition: any) => {
      definitions.set(definition.name, definition);
      return () => definitions.delete(definition.name);
    };
    const wire = vi.fn(async () => ({
      content: [
        { type: "text", text: JSON.stringify({ request, sessions: [] }) },
      ],
      structuredContent: { request, sessions: [] },
    }));
    const spy = vi
      .spyOn(RunBridge.prototype, "connect")
      .mockImplementation(async function (this: RunBridge) {
        const internal = this as any;
        internal.connected = true;
        internal.client.callTool = wire;
        internal.definitions = [
          {
            name: "browser_stop",
            inputSchema: {
              type: "object",
              properties: { session_id: { type: "string" } },
              required: ["session_id"],
            },
          },
        ];
      });
    t.close.mockImplementation(async (exec: any) => ({
      isError: false,
      value: await definitions.get(exec.name).execute(exec.arguments, exec),
      content: [],
    }));
    try {
      if (state === "FAILED") {
        expect(await t.recover()).toContain("已释放");
        expect(t.manager.status().quarantine).toBeNull();
        const audit = readdirSync(t.root).find((name) =>
          name.startsWith("release-"),
        )!;
        const proof = JSON.parse(
          readFileSync(join(t.root, audit), "utf8"),
        ).proof;
        expect(proof.evidence.remote_request).toEqual(request);
        expect(proof.evidence.remote_session).toBeUndefined();
        expect(proof.details).toContain("未分配浏览器");
      } else {
        await expect(t.recover()).rejects.toThrow("隔离仍保留");
        expect(t.manager.status().quarantine).not.toBeNull();
        expect(t.preview).not.toHaveBeenCalled();
        expect(
          readdirSync(t.root).filter((name) => name.startsWith("release-")),
        ).toEqual([]);
      }
      expect(wire.mock.calls).toHaveLength(1);
      expect(wire.mock.calls[0]?.[0]).toMatchObject({
        name: "browser_sessions",
        arguments: { node_id: "node_own", request_id: "request_own" },
      });
      expect(definitions.size).toBe(0);
      expect(readFileSync(join(t.root, "run-old/results.json"), "utf8")).toBe(
        original,
      );
    } finally {
      spy.mockRestore();
    }
  },
);

it("私有文件换成另一许可时远程恢复拒绝接管，隔离保留", async () => {
  const t = setup();
  const access = join(t.root, "changed-access.json");
  writeFileSync(
    access,
    JSON.stringify({
      hub_url: "http://hub.test",
      node_id: "node_own",
      grant_id: "grant_new",
      access_token: "x".repeat(48),
    }),
  );
  t.run.instances[0].resources.browser_context = {
    id: "session_own",
    state: "unknown",
    remote: {
      hub_url: "http://hub.test",
      access_file: access,
      node_id: "node_own",
      grant_id: "grant_original",
      resource_id: "chromium",
      session_id: "session_own",
    },
  };
  writeFileSync(join(t.root, "run-old/results.json"), JSON.stringify(t.run));
  await expect(t.recover()).rejects.toThrow("原许可");
  expect(t.close).not.toHaveBeenCalled();
  expect(t.manager.status().quarantine).not.toBeNull();
});

function leaseRecovery() {
  const t = setup();
  const file = join(t.root, "original-lease.json");
  writeFileSync(
    file,
    JSON.stringify({
      hub_url: "http://hub.test",
      node_id: "node_own",
      grant_id: "grant_own",
      access_token: "x".repeat(48),
    }),
  );
  t.run.instances[0].resources = {};
  t.run.node_lease = {
    source: "hub",
    hub_url: "http://hub.test",
    node_id: "node_own",
    grant_id: "grant_own",
    access_file: file,
    state: "QUARANTINED",
    cleanup: "UNKNOWN",
  };
  const original = JSON.stringify(t.run);
  writeFileSync(join(t.root, "run-old/results.json"), original);
  return { ...t, file, original };
}
it("浏览器已不存在仍可用原 Node 租约归还，保留旧 UNKNOWN 和业务结果", async () => {
  const t = leaseRecovery();
  expect(t.manager.status().quarantine).toMatchObject({
    can_recover: true,
    browser_backend: "runbridge",
  });
  expect(await t.recover()).toContain("原 Node 使用权已确认归还");
  expect(t.manager.status().quarantine).toBeNull();
  expect(t.close).not.toHaveBeenCalled();
  expect(readFileSync(join(t.root, "run-old/results.json"), "utf8")).toBe(
    t.original,
  );
  const audit = readdirSync(t.root).find((name) =>
    name.startsWith("release-"),
  )!;
  const proof = JSON.parse(readFileSync(join(t.root, audit), "utf8")).proof;
  expect(proof.evidence).toMatchObject({
    method: "confirmed-node-lease-recovery",
    node_lease: {
      grant_id: "grant_own",
      state: "RELEASED",
      cleanup: "COMPLETE",
    },
  });
  expect(JSON.stringify(proof)).not.toContain("x".repeat(48));
  expect(JSON.stringify(proof)).not.toContain(t.file);
});
it("Node 仍 QUARANTINED 或仅人工核查 UNKNOWN 时不自动解除旧隔离", async () => {
  const t = leaseRecovery();
  vi.mocked(fetch).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          node_id: "node_own",
          grant_id: "grant_own",
          state: "QUARANTINED",
          cleanup: "UNKNOWN",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          idle_deadline_at: new Date(Date.now() + 600000).toISOString(),
          inflight: false,
          close_reason: "IDLE_TIMEOUT",
          resolution: null,
        }),
      ),
  );
  await expect(t.recover()).rejects.toThrow("归还未获确认");
  expect(t.manager.status().quarantine).not.toBeNull();
  expect(existsSync(t.file)).toBe(true);
  expect(t.close).not.toHaveBeenCalled();
});
it("更换访问文件为新 grant 时在发请求前拒绝，不接管另一持有者", async () => {
  const t = leaseRecovery();
  writeFileSync(
    t.file,
    JSON.stringify({
      hub_url: "http://hub.test",
      node_id: "node_own",
      grant_id: "grant_new",
      access_token: "x".repeat(48),
    }),
  );
  await expect(t.recover()).rejects.toThrow("不能使用新许可");
  expect(fetch).not.toHaveBeenCalled();
  expect(t.manager.status().quarantine).not.toBeNull();
});
it("未知领取没有原令牌时只保留人工处置，不用 Hub 凭据抢占", async () => {
  const t = leaseRecovery();
  t.run.node_lease = {
    source: "hub",
    hub_url: "http://hub.test",
    node_id: "node_own",
    request_id: "claim_lost",
    state: "UNKNOWN",
  };
  writeFileSync(join(t.root, "run-old/results.json"), JSON.stringify(t.run));
  expect(t.manager.status().quarantine?.can_recover).toBe(false);
  await expect(t.recover()).rejects.toThrow("没有取得可恢复的节点令牌");
  expect(fetch).not.toHaveBeenCalled();
});
