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
function setup(value = 3, preparePreview?: () => Promise<void>) {
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
  const planMode = { get: vi.fn(() => ({ active: false })), set: vi.fn() };
  agent.ctx = {
    sessionProjections: {
      stateOf: () => ({ active: false, wanted: null, running: null }),
    },
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
  const ctx: any = {
    commands: {
      find: () => ({}),
      execute: async (agent: any, line: string) => {
        planMode.set(agent, line !== "/plan off");
        return { result: { kind: "success" } };
      },
    },
    effect: (fn: Function) => {
      const dispose = fn();
      effects.add(dispose);
      return () => {
        if (effects.delete(dispose)) dispose();
      };
    },
  };
  const manager = new NativeTests(
    ctx,
    { outputRoot: root, cancelGraceMs: 25 },
    preparePreview,
  );
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
  const announce = (text: string, sessionId = "origin") =>
    emit(
      "session/event",
      { id: sessionId },
      {
        type: "assistant/message",
        data: { message: { content: [{ type: "text", text }] } },
      },
    );
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
    announce,
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

it("固定采集与清理接受空capture而不允许覆盖冻结定义", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0", sample());
  await t.step();
  const run = t.manager.sessions.get("origin")!;
  const plan = structuredClone(run.run.plan);
  expect(
    (
      await t.call("test_capture", {
        capture: { likes: { kind: "dom", mode: "number", selector: "#other" } },
      })
    ).isError,
  ).toBe(true);
  expect((await t.call("test_capture", { capture: {} })).isError).toBe(false);
  expect((await t.call("test_finish_step")).isError).toBe(false);
  expect(
    (
      await t.call("test_capture", {
        capture: {
          released: { kind: "dom", mode: "visible", selector: "body" },
        },
      })
    ).isError,
  ).toBe(true);
  expect((await t.call("test_capture", { capture: {} })).isError).toBe(false);
  expect((await t.call("test_finish_step")).isError).toBe(false);
  expect((await t.call("test_finish")).value.statistics.PASS).toBe(1);
  expect(run.run.plan).toEqual(plan);
  expect(
    run.run.instances[0].steps.find((s) => s.step_id === "__close")?.status,
  ).toBe("SUCCEEDED");
});

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
  const result = await t.call("test_submit_plan", reviewPlan());
  expect(result.isError).toBe(false);
  expect(result.value.plan_summary).toContain("原始任务");
  expect(result.value.plan_summary).toContain("拆分思路");
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

it("JSON运行时采集可修正定位且不改预期", async () => {
  const t = setup();
  const plan: any = sample();
  delete plan.cases[0].steps[0].action.capture;
  plan.cases[0].steps[0].action.capture_mode = "runtime";
  await t.manager.start(t.agent, "点赞不为0", plan);
  const run = t.manager.sessions.get("origin")!;
  const frozen = JSON.stringify(run.run.plan);
  expect(t.dispatched).toEqual([]);
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
  return {
    name: "查看帖子点赞",
    steps: [{ description: "查看帖子的点赞数", checks: ["点赞数不为0"] }],
  };
}
async function finishTextStep(t: ReturnType<typeof setup>) {
  expect(
    (
      await t.call("test_define_step", {
        capability: "browser",
        allowed_targets: ["https://example.test"],
        reason: "当前帖子",
      })
    ).isError,
  ).toBe(false);
  expect(
    (
      await t.call("test_capture", {
        capture: { likes: { kind: "dom", mode: "number", selector: "#likes" } },
        reason: "查看后确定点赞计数",
      })
    ).isError,
  ).toBe(false);
  expect(
    (
      await t.call("test_bind_check", {
        check_index: 0,
        assertion: {
          observation_ref: "step_1.likes",
          operator: "neq",
          expected_value: "0",
        },
      })
    ).isError,
  ).toBe(false);
  expect((await t.call("test_finish_step")).isError).toBe(false);
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
  await finishTextStep(t);
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

it("直接执行先观察本会话完整计划通报，不以工具结果或其他会话消息代替", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0");
  const submitted = await t.call("test_submit_plan", reviewPlan());
  const args = {
    capability: "browser",
    allowed_targets: ["https://example.test"],
    reason: "执行当前步骤",
  };
  expect((await t.call("test_define_step", args)).isError).toBe(true);
  await t.announce("计划已批准，开始执行");
  expect((await t.call("test_define_step", args)).isError).toBe(true);
  await t.announce(submitted.value.plan_summary, "other");
  expect((await t.call("test_define_step", args)).isError).toBe(true);
  expect(t.dispatched.filter((name) => name.includes("playwright"))).toEqual(
    [],
  );
  await t.announce(submitted.value.plan_summary);
  expect((await t.call("test_define_step", args)).isError).toBe(false);
  const run = t.manager.sessions.get("origin")!;
  expect(
    readFileSync(join(run.recorder.directory, "events.jsonl"), "utf8"),
  ).toContain('"plan_announced"');
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
      expect(
        (
          await t.call("test_api_get", {
            url: "https://httpbin.org/get?keyword=agent&client=dsh",
          })
        ).isError,
      ).toBe(true);
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

it("计划只输出文字时提醒原生提交，审核拒绝后不催促用户或自动执行", async () => {
  const t = setup();
  await t.manager.start(t.agent, "点赞不为0", undefined, true);
  await t.emit("agent/turn-stopping", { agent: t.agent });
  expect(t.agent.steer).toHaveBeenCalledOnce();
  await t.call("test_submit_plan", reviewPlan());
  const run = t.manager.sessions.get("origin")!;
  t.definitions.set("exit_plan_mode", {
    execute: () => {
      throw new Error("要求修改");
    },
  });
  await t.call("exit_plan_mode", { plan: run.state().review_markdown });
  t.agent.steer.mockClear();
  await t.emit("agent/turn-stopping", { agent: t.agent });
  expect(t.agent.steer).not.toHaveBeenCalled();
  expect(run.run.instances).toEqual([]);
});

it("文字计划只冻结短句，运行时按采集方式登记输出；缺少检查不能通过", async () => {
  const t = setup();
  await t.manager.start(t.agent, "打开帖子检查点赞不为0");
  await t.announce(
    (await t.call("test_submit_plan", reviewPlan())).value.plan_summary,
  );
  const run = t.manager.sessions.get("origin")!;
  const frozen = structuredClone(run.run.plan);
  expect(frozen.cases[0].steps[0]).toMatchObject({
    kind: "intent",
    checks: ["点赞数不为0"],
  });
  expect(frozen.cases[0].steps[0].action).toBeUndefined();
  expect((await t.call("test_finish_step")).isError).toBe(true);
  const base = {
    capability: "browser",
    allowed_targets: ["https://example.test"],
    reason: "执行当前步骤，先看页面",
  };
  expect((await t.call("test_define_step", base)).isError).toBe(false);
  expect(
    (
      await t.call("mcp__playwright__browser_navigate", {
        url: "https://example.test",
      })
    ).isError,
  ).toBe(false);
  expect(
    (
      await t.call("test_define_step", {
        ...base,
      })
    ).isError,
  ).toBe(false);
  await t.call("test_capture", {
    capture: { likes: { kind: "dom", mode: "number", selector: "#likes" } },
    reason: "实际页面定位",
  });
  expect((await t.call("test_define_step", base)).isError).toBe(true);
  expect((await t.call("test_finish_step")).isError).toBe(true);
  const check = {
    check_index: 0,
    assertion: {
      observation_ref: "step_1.likes",
      operator: "neq",
      expected_value: "0",
    },
  };
  for (const expected_value of ['["0"]', '"0"', "{"])
    expect(
      (
        await t.call("test_bind_check", {
          ...check,
          assertion: { ...check.assertion, expected_value },
        })
      ).isError,
    ).toBe(true);
  expect((await t.call("test_bind_check", check)).isError).toBe(false);
  expect((await t.call("test_bind_check", check)).isError).toBe(true);
  await t.call("test_finish_step");
  await t.step();
  expect((await t.call("test_finish")).value.statistics.PASS).toBe(1);
  expect(run.run.plan).toEqual(frozen);
  expect(rebuild(run.recorder.directory)).toEqual(run.run);
  await t.end();
});

it("纯接口文字步骤运行时确定响应结构，下一步只核对已采集响应，不重复请求", async () => {
  const t = setup();
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ args: { keyword: "agent" } }), {
      status: 200,
    }),
  );
  try {
    await t.manager.start(t.agent, "发送请求并验证状态码");
    const submitted = await t.call("test_submit_plan", {
      name: "接口检查",
      steps: [
        { description: "请求httpbin接口" },
        { description: "检查响应", checks: ["状态码为200", "关键字为agent"] },
      ],
    });
    await t.announce(submitted.value.plan_summary);
    const run = t.manager.sessions.get("origin")!;
    await t.call("test_define_step", {
      capability: "api",
      allowed_targets: ["https://httpbin.org"],
      reason: "本步请求接口",
    });
    await t.call("test_capture", {
      capture: {
        response: { kind: "http", url: "https://httpbin.org/get", field: "" },
      },
      reason: "保存完整响应",
    });
    expect(
      (
        await t.call("test_propose_checkpoint", {
          reason: "不得覆盖尚未绑定的文字检查",
          source_refs: run.run.plan.source_refs,
          added_steps: [
            {
              step_id: "step_2_check_1",
              kind: "assertion",
              description: "覆盖",
              required: true,
              depends_on: ["step_1"],
              assertion: {
                observation_ref: "step_1.response.status",
                operator: "eq",
                literal: 200,
                rule_ref: "user_task",
              },
            },
          ],
          target_instance_ids: ["scenario--default"],
          insertion_boundary: "step_2",
          post_hoc: true,
        })
      ).isError,
    ).toBe(true);
    await t.call("test_finish_step");
    expect(run.state().current?.step.step_id).toBe("step_2");
    expect(
      (
        await t.call("test_bind_check", {
          check_index: 1,
          assertion: {
            observation_ref: "step_1.response.body.args.keyword",
            operator: "eq",
            expected_value: "agent",
          },
        })
      ).isError,
    ).toBe(false);
    expect(
      (
        await t.call("test_bind_check", {
          check_index: 0,
          assertion: {
            observation_ref: "step_1.response.status",
            operator: "eq",
            expected_value: "200",
          },
        })
      ).isError,
    ).toBe(false);
    await t.call("test_finish_step");
    expect((await t.call("test_finish")).value.statistics.PASS).toBe(1);
    expect(spy).toHaveBeenCalledOnce();
    expect(t.dispatched.some((n) => n.includes("playwright"))).toBe(false);
    expect(run.run.instances[0].effective_required_assertion_ids).toEqual([
      "step_2_check_1",
      "step_2_check_2",
    ]);
    expect(
      run.run.instances[0].steps
        .filter((s) => s.assertion)
        .map((s) => s.step_id),
    ).toEqual(["step_2_check_1", "step_2_check_2"]);
    await t.end();
  } finally {
    spy.mockRestore();
  }
});

it("文件与CSV四实例只在完整原生审核后执行，参数、证据和失败状态相互隔离", async () => {
  const { createTextInput, parseCases } = await import(
    "../../src/case-input.js"
  );
  const source = createTextInput(
    parseCases(
      "请求https://httpbin.org/get?keyword=${keyword}，核对keyword为${keyword}\n再次请求并核对keyword为${keyword}",
      ".txt",
    ),
    { path: "data.csv", content: "keyword\nagent\ntesting" },
  );
  const t = setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  try {
    await t.manager.start(
      t.agent,
      "data.csv --file cases.txt",
      undefined,
      true,
      source,
    );
    const draft = {
      name: "四实例",
      cases: source.instances.map((i) => ({
        instance_id: i.id,
        name: i.id,
        steps: [
          {
            description: i.task,
            checks: ["keyword等于" + i.parameters.keyword],
          },
        ],
      })),
    };
    const first = await t.call("test_submit_plan", draft);
    expect(first.value.phase).toBe("reviewing");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      (
        await t.call("test_define_step", {
          capability: "api",
          allowed_targets: ["https://httpbin.org"],
          reason: "提前请求",
        })
      ).isError,
    ).toBe(true);
    t.definitions.set("exit_plan_mode", {
      execute: () => ({ approved: true }),
    });
    const updated = structuredClone(draft);
    updated.cases[0]!.steps[0]!.description += "，在运行时决定字段";
    const second = await t.call("test_submit_plan", updated);
    expect(
      (await t.call("exit_plan_mode", { plan: first.value.review_markdown }))
        .isError,
    ).toBe(true);
    expect(
      (await t.call("exit_plan_mode", { plan: second.value.review_markdown }))
        .isError,
    ).toBe(false);
    const run = t.manager.sessions.get("origin")!;
    const frozen = structuredClone(run.run.plan);
    for (const [n, i] of source.instances.entries()) {
      expect(run.state().current!.instance).toBe(i.id + "--row_" + i.data_row);
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            args: { keyword: n === 1 ? "wrong" : i.parameters.keyword },
          }),
          { status: 200 },
        ),
      );
      expect(
        (
          await t.call("test_define_step", {
            capability: "api",
            allowed_targets: ["https://httpbin.org"],
            reason: "执行当前实例",
          })
        ).isError,
      ).toBe(false);
      expect(
        (
          await t.call("test_capture", {
            capture: {
              response: {
                kind: "http",
                url: "https://httpbin.org/get?keyword=" + i.parameters.keyword,
                field: "",
              },
            },
            reason: "请求并采集当前参数对应的响应",
          })
        ).isError,
      ).toBe(false);
      const id = run.state().current!.step.step_id;
      expect(
        (
          await t.call("test_bind_check", {
            check_index: 0,
            assertion: {
              observation_ref: id + ".response.body.args.keyword",
              operator: "eq",
              expected_value: i.parameters.keyword,
            },
          })
        ).isError,
      ).toBe(false);
      expect((await t.call("test_finish_step")).isError).toBe(false);
    }
    const final = await t.call("test_finish");
    expect(final.value.statistics).toMatchObject({
      total: 4,
      PASS: 3,
      FAIL: 1,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(t.dispatched.some((name) => name.includes("playwright"))).toBe(
      false,
    );
    expect(run.run.plan).toEqual(frozen);
    expect(rebuild(run.recorder.directory)).toEqual(run.run);
    const html = readFileSync(
      join(run.recorder.directory, "report.html"),
      "utf8",
    );
    expect(html).toContain("原始用例 2 条 · CSV 数据 2 行 · 执行实例 4 个");
    expect(html).toContain("用例来源与参数");
    expect(html).toContain('data-case="case_1"');
    expect(html).toContain('data-case="case_2"');
    await t.end();
  } finally {
    fetchSpy.mockRestore();
  }
});

it("两个文字浏览器实例分别初始化清理，第一例失败不污染下一例的断言", async () => {
  const { createTextInput, parseCases } = await import(
    "../../src/case-input.js"
  );
  const source = createTextInput(
    parseCases("检查第一页点赞不为0\n检查第二页点赞不为0", ".txt"),
  );
  const t = setup();
  await t.manager.start(t.agent, "cases.txt", undefined, false, source);
  const submitted = await t.call("test_submit_plan", {
    name: "浏览器集合",
    cases: source.instances.map((i) => ({
      instance_id: i.id,
      name: i.id,
      steps: [{ description: i.task, checks: ["点赞数不为0"] }],
    })),
  });
  await t.announce(submitted.value.plan_summary);
  const run = t.manager.sessions.get("origin")!;
  for (const likes of [0, 3]) {
    expect(
      (
        await t.call("test_define_step", {
          capability: "browser",
          allowed_targets: ["https://example.test"],
          reason: "当前实例读取点赞",
        })
      ).isError,
    ).toBe(false);
    t.setDomResult({ values: { likes } });
    expect(
      (
        await t.call("test_capture", {
          capture: {
            likes: { kind: "dom", mode: "number", selector: "#likes" },
          },
          reason: "当前页面点赞",
        })
      ).isError,
    ).toBe(false);
    const step = run.state().current!.step.step_id;
    expect(
      (
        await t.call("test_bind_check", {
          check_index: 0,
          assertion: {
            observation_ref: step + ".likes",
            operator: "neq",
            expected_value: "0",
          },
        })
      ).isError,
    ).toBe(false);
    await t.call("test_finish_step");
    expect(run.state().current!.step.step_id).toBe("__close");
    await t.step();
  }
  expect((await t.call("test_finish")).value.statistics).toMatchObject({
    total: 2,
    FAIL: 1,
    PASS: 1,
  });
  expect(
    t.dispatched.filter((name) => name.endsWith("browser_close")),
  ).toHaveLength(4);
  expect(
    run.run.instances.every(
      (i) => i.resources.browser_context.state === "absent",
    ),
  ).toBe(true);
});

it("Markdown无参数时不要求通报空对象，缺少实质内容仍明确拦截", async () => {
  const { createTextInput, parseCases } = await import(
    "../../src/case-input.js"
  );
  const source = createTextInput(
    parseCases("- 访问页面，检查点赞不为0", ".md"),
  );
  const t = setup();
  await t.manager.start(t.agent, "cases.md", undefined, false, source);
  const submitted = await t.call("test_submit_plan", {
    name: "MD",
    cases: [
      {
        instance_id: "case_1",
        name: "页面",
        steps: [{ description: "读取点赞", checks: ["点赞数不为0"] }],
      },
    ],
  });
  const args = {
    capability: "browser",
    allowed_targets: ["https://example.test"],
    reason: "读取",
  };
  const rejected = await t.call("test_define_step", args);
  expect(rejected.content[0].text).toContain("缺少");
  await t.announce(submitted.value.plan_summary.replaceAll("```\n{}\n```", ""));
  expect((await t.call("test_define_step", args)).isError).toBe(false);
});

it("CSV审核前取消保留全部未执行实例，不请求接口或派发清理", async () => {
  const { createTextInput, parseCases } = await import(
    "../../src/case-input.js"
  );
  const source = createTextInput(parseCases("验证${x}\n再次验证${x}", ".txt"), {
    path: "data.csv",
    content: "x\n001\n002",
  });
  const t = setup();
  await t.manager.start(
    t.agent,
    "data.csv --file cases.txt",
    undefined,
    true,
    source,
  );
  const run = t.manager.sessions.get("origin")!;
  run.stop();
  await t.end(true);
  expect(run.closed).toBe(true);
  expect(run.run.instances).toHaveLength(4);
  expect(
    run.run.instances.every(
      (i) => i.status === "CANCELLED" && i.steps.length === 0,
    ),
  ).toBe(true);
  expect(run.run.manifest.plan_approved).toBe(false);
  expect(t.dispatched).toEqual([]);
  expect(
    readFileSync(join(run.recorder.directory, "report.html"), "utf8"),
  ).toContain("计划未获批准");
});

it("进度只属于原会话，准备清理与业务分别呈现；读状态不会派发工具", async () => {
  const t = setup(3);
  await t.manager.start(t.agent, "点赞不为0", sample());
  const dispatched = t.dispatched.length;
  expect(t.manager.presentation("other-session")).toBeNull();
  expect(t.manager.presentation("origin")).toMatchObject({
    session_id: "origin",
    total_steps: 2,
    settled_steps: 0,
  });
  expect(t.dispatched).toHaveLength(dispatched);
  await t.step();
  expect(t.manager.presentation("origin")).toMatchObject({
    current_step_id: "read",
    phase: "executing",
  });
  await t.step();
  expect(t.manager.presentation("origin")).toMatchObject({
    phase: "cleanup",
    settled_steps: 2,
  });
  await t.step();
  await t.call("test_finish");
  const state = t.manager.presentation("origin")!;
  expect(state).toMatchObject({
    phase: "finished",
    settled_steps: 2,
    total_steps: 2,
  });
  expect(state.instances[0]?.setup).toHaveLength(1);
  expect(state.instances[0]?.cleanup).toHaveLength(1);
  expect(state.report_url).toContain("report.html");
  expect((await t.manager.preview.state(state.run_id)).ready).toBe(false);
  await t.end();
});

it("预览接入准备也保持互斥，不能在准备过程中启动第二条测试", async () => {
  let release!: () => void;
  const prepare = vi.fn(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  const t = setup(3, prepare);
  const first = t.manager.start(t.agent, "检查预览准备", sample());
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(t.manager.sessions.size).toBe(0);
  await expect(
    t.manager.start({ ...t.agent, id: "other" }, "另一条测试", sample()),
  ).rejects.toThrow("已有测试");
  release();
  await first;
  expect(t.manager.sessions.size).toBe(1);
});
