import { afterEach, expect, it, vi } from "vitest";
import { apply } from "../../src/client/index.js";
import * as clientPlugin from "../../src/client/index.js";
import { Context } from "@deepseek-ai/cordis";
import type { ProgressSnapshot } from "../../src/progress-model.js";

afterEach(() => vi.unstubAllGlobals());

it("在真实 Cordis 依赖边界下可调用原生恢复命令，不能依赖普通对象替身掩盖漏注入", async () => {
  vi.stubGlobal("document", {
    createElement: () => ({ dataset: {}, remove: () => {} }),
    head: { append: () => {} },
  });
  const entries = new Map<string, any>();
  const execute = vi.fn(async () => ({
    ok: true,
    value: { result: { kind: "success", text: "已释放" } },
  }));
  const ctx = new Context();
  ctx.provide("slots", {
    inject: (_name: string, fn: Function) => fn(),
    register: (entry: any) => {
      entries.set(entry.id ?? entry.key, entry);
      return () => {};
    },
  } as never);
  ctx.provide("sidebarRightTabs", { register: () => () => {} } as never);
  ctx.provide("sidebarRight", {} as never);
  ctx.provide("remote", { commands: { execute } } as never);
  ctx.provide("remote.commands", { execute } as never);
  ctx.plugin(clientPlugin);
  try {
    await vi.waitFor(() =>
      expect(entries.has("harness-test-progress")).toBe(true),
    );
    const actions = entries.get("harness-test-progress").inject("one");
    await expect(actions.recover("a".repeat(64))).resolves.toBe("已释放");
    expect(execute).toHaveBeenCalledWith(
      "one",
      `/test-recover --confirm ${"a".repeat(64)}`,
      [],
    );
  } finally {
    await ctx.fiber.dispose();
  }
});
function setup() {
  vi.stubGlobal("document", {
    createElement: () => ({ dataset: {}, remove: vi.fn() }),
    head: { append: vi.fn() },
  });
  const entries = new Map<string, any>();
  const execute = vi.fn(async () => ({
    ok: true,
    value: { result: { kind: "success", text: "测试环境已释放" } },
  }));
  let expanded = false;
  let currentSession = "one";
  let tab: any;
  const sidebar = {
    mounted: { getSnapshot: () => currentSession },
    isExpanded: () => expanded,
    toggleExpanded: vi.fn(() => {
      expanded = !expanded;
    }),
    openTab: vi.fn((kind) => {
      tab = { id: "tab-one", kind };
      expanded = true;
    }),
    active: () => tab,
    float: vi.fn(),
    close: vi.fn(() => {
      tab = undefined;
    }),
  };
  apply({
    inject: vi.fn(() => () => {}),
    remote: { commands: { execute } },
    effect: (effect: Function) => effect(),
    sidebarRight: sidebar,
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      inject: (_name: string, effect: Function) => effect(),
      register: (entry: any) => {
        entries.set(entry.name + "/" + (entry.id ?? entry.key), entry);
      },
    },
  } as never);
  const actions = entries
    .get("conversation.input.dock/harness-test-progress")
    .inject("one");
  const state = {
    session_id: "one",
    run_id: "run-one",
    phase: "executing",
    preview: { ready: false },
  } as ProgressSnapshot;
  return {
    actions,
    state,
    sidebar,
    execute,
    switchSession: () => {
      currentSession = "other";
    },
  };
}
it("无CDP或首帧的状态不创建浮窗；后台会话也不抢占当前界面", () => {
  const { actions, state, sidebar, switchSession } = setup();
  actions.followPreview(state);
  actions.openPreview(state);
  expect(sidebar.openTab).not.toHaveBeenCalled();
  switchSession();
  actions.followPreview({ ...state, preview: { ready: true } });
  expect(sidebar.openTab).not.toHaveBeenCalled();
});

it("读取隔离不调用释放；确认操作走当前会话的原生命令，失败不会显示为成功", async () => {
  const t = setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ quarantine: null, recovering: false }),
    })),
  );
  await expect(
    t.actions.readRecovery(new AbortController().signal),
  ).resolves.toMatchObject({ quarantine: null });
  expect(t.execute).not.toHaveBeenCalled();
  expect(await t.actions.recover("a".repeat(64))).toContain("已释放");
  expect(t.execute).toHaveBeenCalledWith(
    "one",
    `/test-recover --confirm ${"a".repeat(64)}`,
    [],
  );
  t.execute.mockResolvedValue({
    ok: true,
    value: { result: { kind: "error", text: "关闭失败，隔离仍保留" } },
  });
  await expect(t.actions.recover("a".repeat(64))).rejects.toThrow("隔离仍保留");
});
it("首帧自动打开一次，用户关闭后不反复弹出；手动重开只调用布局操作", () => {
  const { actions, state, sidebar } = setup();
  const ready = { ...state, preview: { ready: true } };
  actions.followPreview(ready);
  expect(sidebar.float).toHaveBeenCalledTimes(1);
  expect(sidebar.isExpanded()).toBe(false);
  sidebar.close();
  actions.followPreview(ready);
  expect(sidebar.openTab).toHaveBeenCalledTimes(1);
  actions.openPreview(ready);
  expect(sidebar.openTab).toHaveBeenCalledTimes(2);
});
it("结束或切换运行时关闭旧浮窗，不把上一运行的画面留给新任务", () => {
  const { actions, state, sidebar } = setup();
  actions.followPreview({ ...state, preview: { ready: true } });
  actions.followPreview({
    ...state,
    phase: "finished",
    preview: { ready: false },
  });
  expect(sidebar.close).toHaveBeenCalledTimes(1);
  actions.followPreview({
    ...state,
    run_id: "run-next",
    preview: { ready: false },
  });
  expect(sidebar.openTab).toHaveBeenCalledTimes(1);
});
