import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeTests } from "../../src/native-test.js";
import { sample } from "../fixtures/plan.js";
import { rebuild } from "../../src/recorder.js";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));
// 生命周期替身只驱动官方公开接口；真实宿主与模型在网页验收中单独验证。
function setup(value = 3) {
  const root = mkdtempSync(join(tmpdir(), "native-test-"));
  const events = new Map<string, Set<Function>>();
  const definitions = new Map<string, any>();
  const guards = new Set<Function>();
  const sections = new Set<unknown>();
  const followups: any[] = [];
  const toolNames: string[] = [];
  let sequence = 0;
  const on = (name: string, fn: Function) => {
    const set = events.get(name) ?? new Set();
    set.add(fn);
    events.set(name, set);
    return () => set.delete(fn);
  };
  const emit = async (name: string, ...args: any[]) => {
    for (const fn of [...(events.get(name) ?? [])]) await fn(...args);
  };
  const waterfall = async (name: string, exec: any, last: () => any) => {
    const fns = [...(events.get(name) ?? [])];
    const next = (n: number): any =>
      fns[n] ? fns[n](exec, () => next(n + 1)) : last();
    return next(0);
  };
  const agent: any = {
    id: "origin",
    status: "idle",
    followup: vi.fn((message: unknown) => {
      followups.push(message);
      agent.status = "running";
    }),
    steer: vi.fn(),
    cancel: vi.fn(),
    whenIdle: vi.fn(async () => {}),
  };
  const execute = async (exec: any) => {
    const full = {
      callId: `call-${++sequence}`,
      signal: new AbortController().signal,
      agent,
      arguments: {},
      ...exec,
    };
    full.rootCallId ??= full.callId;
    full.token = {};
    toolNames.push(full.name);
    await emit(
      "session/event",
      { id: agent.id },
      {
        type: "tool/call",
        data: {
          callId: full.callId,
          name: full.name,
          arguments: JSON.stringify(full.arguments),
        },
      },
    );
    let result: any;
    try {
      const decision = await waterfall("tools/pre-execute", full, () => {
        for (const guard of guards) {
          const reason = guard(full);
          if (reason) return { kind: "deny", reason };
        }
        return { kind: "allow" };
      });
      if (decision.kind !== "allow") throw new Error(decision.reason);
      const response = await waterfall("tools/execute", full, () => {
        if (definitions.has(full.name))
          return definitions.get(full.name).execute(full.arguments, full);
        if (full.name.endsWith("browser_evaluate"))
          return {
            content: [
              {
                type: "text",
                text:
                  "### Result\n" + JSON.stringify({ values: { likes: value } }),
              },
            ],
          };
        return {};
      });
      result = { value: response, isError: false, content: [] };
    } catch (error) {
      result = {
        isError: true,
        content: [{ type: "text", text: String(error) }],
      };
    }
    await emit("tools/result", full, result);
    return result;
  };
  agent.ctx = {
    on,
    systemPrompt: {
      section: (s: unknown) => {
        sections.add(s);
        return () => sections.delete(s);
      },
    },
    tools: {
      register: (def: any) => {
        definitions.set(def.name, def);
        return () => definitions.delete(def.name);
      },
      guard: (fn: Function) => {
        guards.add(fn);
        return () => guards.delete(fn);
      },
      execute,
    },
  };
  const ctx: any = { effect: (fn: Function) => fn() };
  const manager = new NativeTests(ctx, { outputRoot: root, cancelGraceMs: 25 });
  cleanups.push(() => {
    for (const test of manager.sessions.values()) test.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const end = async (aborted = false) => {
    agent.status = "idle";
    await emit(
      "session/event",
      { id: agent.id },
      {
        type: "turn/end",
        data: { reason: { kind: aborted ? "aborted" : "complete" } },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const call = (name: string, args = {}) => execute({ name, arguments: args });
  const step = async () => {
    expect((await call("test_capture")).isError).toBe(false);
    expect((await call("test_finish_step")).isError).toBe(false);
  };
  return {
    manager,
    agent,
    followups,
    toolNames,
    sections,
    definitions,
    guards,
    root,
    end,
    call,
    step,
    emit,
  };
}

it.each([
  [3, "PASS"],
  [0, "FAIL"],
])(
  "同一原生Agent采集 %s 并结算 %s；不创建子会话或伪造会话事件",
  async (value, expected) => {
    const t = setup(Number(value));
    await t.manager.start(t.agent, "点赞不为0", sample());
    expect(t.followups).toHaveLength(1);
    expect(t.followups[0].source.kind).toBe("user");
    const run = t.manager.sessions.get("origin")!;
    await t.step();
    await t.step();
    await t.step();
    const final = await t.call("test_finish");
    expect(final.value.statistics[expected]).toBe(1);
    expect(final.value.assertions[0]).toMatchObject({
      actual: value,
      expected: 0,
      status: expected,
    });
    await t.end();
    expect(run.closed).toBe(true);
    expect(t.definitions.size).toBe(0);
    expect(t.sections.size).toBe(0);
    expect(t.guards.size).toBe(0);
    expect(run.run.instances[0].session_id).toBe("origin");
    expect(run.run.instances[0].cleanup_session_id).toBe("origin");
    expect(rebuild(run.recorder.directory).instances[0].status).toBe(expected);
    expect(
      run.run.instances[0].steps
        .flatMap((s) => s.calls)
        .every((c) => c.finished_at),
    ).toBe(true);
    expect(
      readFileSync(join(run.recorder.directory, "report.html"), "utf8"),
    ).toContain("实际值 ACTUAL");
    expect(t.manager.reportId("other")).toBeUndefined();
  },
);

it("允许正常追问并等待同一会话补充；其他会话不继承测试上下文", async () => {
  const t = setup();
  await t.manager.start(t.agent, "检查点赞");
  await t.end();
  expect(t.manager.sessions.get("origin")!.closed).toBe(false);
  expect(t.sections.size).toBe(1);
  expect(t.manager.sessions.has("other")).toBe(false);
  expect(t.manager.reportId("other")).toBeUndefined();
  expect(t.followups).toHaveLength(1);
});

it("停止先等待原生在途结算，再在同一会话运行预授权清理并保留取消状态", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0", sample());
  await t.step();
  let drain!: () => void;
  t.agent.whenIdle.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        drain = resolve;
      }),
  );
  const run = t.manager.sessions.get("origin")!;
  run.stop();
  await t.end(true);
  expect(t.followups).toHaveLength(1);
  drain();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(t.followups).toHaveLength(2);
  expect(t.followups[1].source.kind).toBe("plugin:test");
  expect(
    (
      await t.call("mcp__playwright__browser_navigate", {
        url: "https://example.test",
      })
    ).isError,
  ).toBe(true);
  await t.step();
  expect((await t.call("test_finish")).value.statistics.CANCELLED).toBe(1);
  t.agent.whenIdle.mockResolvedValue(undefined);
  await t.end();
  expect(run.closed).toBe(true);
  expect(run.run.instances[0].cleanup_session_id).toBe("origin");
});

it("在途无法结算时不启动清理，持久隔离并拒绝后续共享环境运行", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0", sample());
  const run = t.manager.sessions.get("origin")!;
  t.agent.whenIdle.mockImplementation(() => new Promise(() => {}));
  run.stop();
  await t.end(true);
  await new Promise((resolve) => setTimeout(resolve, 45));
  expect(t.followups).toHaveLength(1);
  expect(run.closed).toBe(true);
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(true);
  await expect(t.manager.start(t.agent, "重试", sample())).rejects.toThrow(
    "隔离",
  );
});

it("模型不能绕过可信采集直接完成，必需动作失败会阻断后续业务", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0", sample());
  await t.step();
  expect((await t.call("test_finish_step")).isError).toBe(true);
  await t.call("test_fail_step", { reason: "无法读取" });
  expect(t.manager.sessions.get("origin")!.state().current?.phase).toBe(
    "cleanup",
  );
  await t.step();
  const result = await t.call("test_finish");
  expect(result.value.statistics.ERROR).toBe(1);
  expect(result.value.assertions).toEqual([]);
  await t.end();
});

it("停止后保留自定义冻结清理，不把清理改成业务或跳过", async () => {
  const t = setup();
  const plan = sample() as any;
  plan.cases[0].cleanup = [
    {
      ...structuredClone(plan.cases[0].steps[0]),
      step_id: "custom_cleanup",
      run_if: "always",
      description: "授权的浏览器只读清理检查",
    },
  ];
  await t.manager.start(t.agent, "按计划执行", plan);
  await t.step();
  const run = t.manager.sessions.get("origin")!;
  run.stop();
  await t.end(true);
  expect(run.state().current?.step.step_id).toBe("custom_cleanup");
  expect(run.state().current?.phase).toBe("cleanup");
  expect((await t.call("mcp__playwright__browser_snapshot")).isError).toBe(
    false,
  );
  await t.step();
  await t.step();
  await t.call("test_finish");
  await t.end();
  expect(
    run.run.instances[0].steps.find((s) => s.step_id === "custom_cleanup")
      ?.status,
  ).toBe("SUCCEEDED");
  expect(run.run.instances[0].status).toBe("CANCELLED");
});

it("重启发现未结算测试时隔离，不创建Agent或重放工具", async () => {
  const t = setup();
  await t.manager.start(t.agent, "测试", sample());
  t.manager.sessions.get("origin")!.dispose();
  const restarted = new NativeTests({} as never, { outputRoot: t.root });
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(true);
  expect(restarted.sessions.size).toBe(0);
  expect(t.followups).toHaveLength(1);
});

it("追加有规则来源的必需断言会改变本实例结果且保留修订适用实例", async () => {
  const t = setup(3);
  const plan = sample();
  // 保留一个未执行动作作为追加断言前的运行边界。
  plan.cases[0].steps.splice(1, 0, {
    ...structuredClone(plan.cases[0].steps[0]),
    step_id: "second",
    depends_on: ["read"],
  });
  await t.manager.start(t.agent, "按计划执行", plan);
  await t.step();
  await t.step();
  const added = {
    ...structuredClone(plan.cases[0].steps.at(-1)),
    step_id: "extra",
    assertion: {
      observation_ref: "read.likes",
      operator: "eq",
      literal: 0,
      rule_ref: "r",
    },
  };
  const result = await t.call("test_propose_checkpoint", {
    reason: "补充已授权检查",
    source_refs: plan.source_refs,
    added_steps: [added],
    target_instance_ids: ["one--a"],
    insertion_boundary: "end",
    post_hoc: true,
  });
  expect(result.isError).toBe(false);
  await t.step();
  await t.step();
  await t.call("test_finish");
  await t.end();
  const run = t.manager.sessions.get("origin")!.run;
  expect(run.instances[0].status).toBe("FAIL");
  expect(run.instances[0].revision_history?.[0].target_instance_ids).toEqual([
    "one--a",
  ]);
});
