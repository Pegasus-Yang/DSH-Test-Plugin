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
  const dispatched: string[] = [];
  let domResult: any = { values: { likes: value } };
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
        dispatched.push(full.name);
        if (definitions.has(full.name))
          return definitions.get(full.name).execute(full.arguments, full);
        if (full.name.endsWith("browser_evaluate"))
          return {
            content: [
              {
                type: "text",
                text: "### Result\n" + JSON.stringify(domResult),
              },
            ],
          };
        return {};
      });
      // 宿主要求工具值为无损JSON；替身也验证这一公开边界。
      expect(response).toStrictEqual(JSON.parse(JSON.stringify(response)));
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
  const effects = new Set<Function>();
  const planMode = { get: vi.fn(() => ({ active: false })), set: vi.fn() };
  const ctx: any = {
    get: (name: string) => (name === "planMode" ? planMode : undefined),
    planMode,
    effect: (fn: Function) => {
      const dispose = fn();
      effects.add(dispose);
      return () => {
        if (effects.delete(dispose)) dispose();
      };
    },
  };
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
    planMode,
    unload: () => {
      for (const dispose of [...effects]) dispose();
    },
    agent,
    followups,
    toolNames,
    dispatched,
    setDomResult: (value: unknown) => {
      domResult = value;
    },
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

it("预先提交JSON计划只保留当前步骤计时器，释放后不遗留取消计时器", async () => {
  vi.useFakeTimers();
  try {
    const t = setup();
    await t.manager.start(t.agent, "测试", sample());
    expect(vi.getTimerCount()).toBe(1);
    t.manager.sessions.get("origin")!.dispose();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

it("插件作用域卸载会取消当前原生Agent并隔离未清理资源", async () => {
  const t = setup();
  await t.manager.start(t.agent, "测试", sample());
  t.unload();
  expect(t.agent.cancel).toHaveBeenCalledOnce();
  expect(t.manager.sessions.get("origin")!.closed).toBe(true);
  expect(existsSync(join(t.root, "quarantine.json"))).toBe(true);
  expect(t.definitions.size).toBe(0);
});

it("自然语言计划由插件补齐固定字段，不要求模型编造版本和规则来源", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0");
  const plan = sample();
  const c = plan.cases[0];
  c.steps[1].assertion!.rule_ref = "user_task";
  const result = await t.call("test_submit_plan", {
    suite_id: plan.suite_id,
    name: plan.name,
    cases: [
      {
        case_id: c.case_id,
        name: c.name,
        datasets: c.datasets,
        steps: c.steps,
      },
    ],
  });
  expect(result.isError).toBe(false);
  const frozen = t.manager.sessions.get("origin")!.run.plan;
  expect(frozen.schema_version).toBe("1");
  expect(frozen.cases[0].cleanup).toEqual([]);
  expect(frozen.source_refs[0].excerpt).toBe("点赞不为0");
});

it("规划超时记录ERROR，且没有执行或清理浏览器", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0");
  const run = t.manager.sessions.get("origin")!;
  run.stop("规划执行超时");
  await t.end(true);
  expect(run.run.instances[0].status).toBe("ERROR");
  expect(run.run.manifest.stop_reason).toBe("规划执行超时");
  expect(t.dispatched).toEqual([]);
  expect(t.followups).toHaveLength(1);
});

it("规划阶段禁止浏览器、API、命令和其他执行工具，仍允许正常分析与追问", async () => {
  const t = setup();
  await t.manager.start(t.agent, "访问站点检查点赞");
  for (const name of [
    "mcp__playwright__browser_navigate",
    "mcp__playwright__browser_snapshot",
    "test_api_get",
    "exec_command",
    "unknown_external_tool",
  ])
    expect((await t.call(name, { url: "https://example.test" })).isError).toBe(
      true,
    );
  for (const name of ["test_current", "todo_write", "ask_user_question"])
    expect((await t.call(name)).isError).toBe(false);
  expect(t.dispatched).toEqual([
    "test_current",
    "todo_write",
    "ask_user_question",
  ]);
  expect(t.manager.sessions.get("origin")!.state().phase).toBe("planning");
});

it("只按描述形成计划，执行时绑定和修正采集方式且不改预期", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0");
  const plan: any = sample();
  delete plan.cases[0].steps[0].action.capture;
  plan.cases[0].steps[1].assertion.rule_ref = "user_task";
  expect((await t.call("test_submit_plan", plan)).isError).toBe(false);
  const run = t.manager.sessions.get("origin")!;
  const frozen = JSON.stringify(run.run.plan);
  expect(t.dispatched).toEqual(["test_submit_plan"]);
  await t.step();
  expect(
    (
      await t.call("mcp__playwright__browser_navigate", {
        url: "https://example.test",
      })
    ).isError,
  ).toBe(false);
  expect(
    (
      await t.call("mcp__playwright__browser_evaluate", {
        function: "() => document.title",
      })
    ).isError,
  ).toBe(false);
  t.setDomResult({ values: {} });
  await t.call("test_capture", {
    capture: { likes: { kind: "dom", mode: "number", selector: "#old" } },
    reason: "按当前页面定位",
  });
  expect((await t.call("test_finish_step")).isError).toBe(true);
  t.setDomResult({ values: { likes: 3 } });
  expect(
    (
      await t.call("test_capture", {
        capture: { likes: { kind: "dom", mode: "number", selector: "#new" } },
        reason: "页面更新，修正同一点赞元素定位",
      })
    ).isError,
  ).toBe(false);
  expect((await t.call("test_finish_step")).isError).toBe(false);
  await t.step();
  const final = await t.call("test_finish");
  expect(final.value.assertions[0]).toMatchObject({
    actual: 3,
    expected: 0,
    status: "PASS",
  });
  expect(JSON.stringify(run.run.plan)).toBe(frozen);
  expect(
    run.run.instances[0].steps.find((s) => s.step_id === "read")!
      .capture_attempts,
  ).toHaveLength(2);
  expect(rebuild(run.recorder.directory)).toEqual(run.run);
  await t.end();
});

it("运行时采集只允许已声明输出，不能修改预期或覆盖既有观察", async () => {
  const t = setup();
  const p: any = sample();
  p.cases[0].steps[0].action.capture_mode = "runtime";
  delete p.cases[0].steps[0].action.capture;
  await t.manager.start(t.agent, "点赞不为0", p);
  await t.step();
  expect(
    (
      await t.call("test_capture", {
        capture: { fake: { kind: "dom", mode: "number", selector: "#likes" } },
        reason: "非法新增输出",
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await t.call("test_capture", {
        capture: { likes: { kind: "http", url: "https://other.test" } },
        reason: "越界采集",
      })
    ).isError,
  ).toBe(true);
  const capture = {
    likes: { kind: "dom", mode: "number", selector: "#likes" },
  };
  expect(
    (await t.call("test_capture", { capture, reason: "读取原目标点赞" }))
      .isError,
  ).toBe(false);
  expect(
    (await t.call("test_capture", { capture, reason: "覆盖实际值" })).isError,
  ).toBe(true);
});

it("采集部分成功后可只补采缺少输出，不丢失或覆盖已有证据", async () => {
  const t = setup();
  const p: any = sample();
  Object.assign(p.cases[0].steps[0].action, {
    capture_mode: "runtime",
    capture: undefined,
    outputs: { likes: { type: "number" }, path: { type: "string" } },
    completion_requirements: ["likes", "path"],
  });
  delete p.cases[0].steps[0].action.capture;
  await t.manager.start(t.agent, "点赞不为0", p);
  await t.step();
  const cap = {
    likes: { kind: "dom", mode: "number", selector: "#likes" },
    path: { kind: "dom", mode: "url", field: "pathname" },
  };
  await t.call("test_capture", { capture: cap, reason: "读取当前帖子" });
  const run = t.manager.sessions.get("origin")!;
  const first = structuredClone(
    run.run.instances[0].steps.find((s) => s.step_id === "read")!
      .observations[0],
  );
  t.setDomResult({ values: { path: "/topic/1" } });
  expect(
    (
      await t.call("test_capture", {
        capture: { path: cap.path },
        reason: "仅补采路径",
      })
    ).isError,
  ).toBe(false);
  expect(
    run.run.instances[0].steps.find((s) => s.step_id === "read")!
      .observations[0],
  ).toEqual(first);
  expect((await t.call("test_finish_step")).isError).toBe(false);
});

function reviewPlan() {
  const plan = sample();
  plan.cases[0].steps[1].assertion!.rule_ref = "user_task";
  return plan;
}

it("test-plan进入原生模式，草案可修改；只有原生审核批准同一草案后才能执行", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0", undefined, true);
  expect(t.planMode.set).toHaveBeenCalledWith(t.agent, true);
  const run = t.manager.sessions.get("origin")!;
  expect(
    (await t.call("exit_plan_mode", { plan: "# 未提交草案" })).isError,
  ).toBe(true);
  const first = await t.call("test_submit_plan", reviewPlan());
  expect(first.value.phase).toBe("reviewing");
  expect(run.run.instances).toEqual([]);
  expect(existsSync(join(run.recorder.directory, "plan.json"))).toBe(false);
  expect((await t.call("test_capture")).isError).toBe(true);
  expect(
    (await t.call("test_api_get", { url: "https://example.test" })).isError,
  ).toBe(true);
  expect(
    (await t.call("exit_plan_mode", { plan: "# 省略具体预期的计划" })).isError,
  ).toBe(true);
  t.definitions.set("exit_plan_mode", {
    execute: () => {
      throw new Error("用户要求修改");
    },
  });
  expect(
    (await t.call("exit_plan_mode", { plan: first.value.review_markdown }))
      .isError,
  ).toBe(true);
  await t.end();
  expect(run.closed).toBe(false);
  expect(run.run.instances).toEqual([]);
  const revised = reviewPlan();
  revised.name = "修改后的计划";
  const second = await t.call("test_submit_plan", revised);
  expect(second.value.review_markdown).toContain("修改后的计划");
  expect(
    (await t.call("exit_plan_mode", { plan: first.value.review_markdown }))
      .isError,
  ).toBe(true);
  t.definitions.set("exit_plan_mode", { execute: () => ({ approved: true }) });
  expect(
    (await t.call("exit_plan_mode", { plan: second.value.review_markdown }))
      .isError,
  ).toBe(false);
  expect(run.state().phase).toBe("executing");
  expect(run.run.plan.name).toBe("修改后的计划");
  expect((await t.call("test_submit_plan", reviewPlan())).isError).toBe(true);
  await t.step();
  await t.step();
  await t.step();
  expect((await t.call("test_finish")).value.statistics.PASS).toBe(1);
  await t.end();
});

it("等待审核没有执行计时器；取消审核不执行业务或浏览器清理并恢复原模式", async () => {
  vi.useFakeTimers();
  try {
    const t = setup();
    await t.manager.start(t.agent, "点赞不为0", undefined, true);
    await t.call("test_submit_plan", reviewPlan());
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600000);
    expect(t.agent.cancel).not.toHaveBeenCalled();
    vi.useRealTimers();
    t.manager.sessions.get("origin")!.stop();
    await t.end(true);
    expect(t.manager.sessions.get("origin")!.run.instances[0].status).toBe(
      "CANCELLED",
    );
    expect(t.dispatched).toEqual(["test_submit_plan"]);
    expect(t.planMode.set).toHaveBeenLastCalledWith(t.agent, false);
  } finally {
    vi.useRealTimers();
  }
});

it("test入口提交后直接执行，不进入原生审核", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0");
  expect((await t.call("test_submit_plan", reviewPlan())).value.phase).toBe(
    "executing",
  );
  expect(t.planMode.set).not.toHaveBeenCalled();
});

it.each([
  [200, "PASS"],
  [201, "FAIL"],
])(
  "纯API响应经过通用采集与报告，预期状态码%s时结果为%s",
  async (expected, status) => {
    const t = setup();
    const plan = JSON.parse(readFileSync("examples/httpbin-get.json", "utf8"));
    plan.cases[0].datasets[0].expected.status = expected;
    const response = {
      args: { keyword: "agent", client: "dsh" },
      url: "https://httpbin.org/get?keyword=agent&client=dsh",
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(response), { status: 200 }),
      );
    try {
      await t.manager.start(t.agent, "接口回显验证", plan);
      await t.step();
      expect((await t.call("test_finish")).value.statistics[status]).toBe(1);
      const run = t.manager.sessions.get("origin")!;
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(t.dispatched).not.toContainEqual(
        expect.stringContaining("playwright"),
      );
      expect(run.run.instances[0].steps.map((s) => s.step_id)).toEqual([
        "request",
        "assert_status",
        "assert_keyword",
        "assert_client",
      ]);
      const observation = run.run.instances[0].steps[0].observations[0];
      expect(observation.producer.adapter).toBe("http-json-v1");
      const evidence = JSON.parse(
        readFileSync(
          join(run.recorder.directory, run.run.evidence[0].relative_path),
          "utf8",
        ),
      );
      expect(evidence.value).toEqual(observation.value);
      expect(observation.value).toEqual({ status: 200, body: response });
      expect(run.run.instances[0].steps[1].assertion).toMatchObject({
        actual: 200,
        expected,
        status,
      });
      expect(rebuild(run.recorder.directory)).toEqual(run.run);
      const html = readFileSync(
        join(run.recorder.directory, "report.html"),
        "utf8",
      );
      expect(html).toContain("断言 HTTP 状态码为 200");
      expect(html).toContain("test_api_get");
      await t.end();
    } finally {
      fetchSpy.mockRestore();
    }
  },
);
