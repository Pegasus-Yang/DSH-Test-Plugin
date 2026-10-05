import { afterEach, expect, it, vi } from "vitest";
import { apply } from "../../src/client/index.js";
import * as clientPlugin from "../../src/client/index.js";
import { Context } from "@deepseek-ai/cordis";
import type { ProgressSnapshot } from "../../src/progress-model.js";

// 此处验证会话与布局操作；真实图标和点击结果由 Web 验收覆盖。
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () =>
  Object.fromEntries(
    [
      "IconBrowseOutlineRegular",
      "IconCheckCircleOutlineRegular",
      "IconCheckOutlineRegular",
      "IconChevronDownOutlineRegular",
      "IconChevronUpOutlineRegular",
      "IconClockOutlineRegular",
      "IconInfoOutlineRegular",
      "IconFlatListOutlineRegular",
      "IconLoadingOutlineRegular",
      "IconWarningOutlineRegular",
    ].map((name) => [name, () => null]),
  ),
);
afterEach(() => vi.unstubAllGlobals());
function documentStub() {
  vi.stubGlobal("document", {
    createElement: () => ({ dataset: {}, remove: vi.fn() }),
    head: { append: vi.fn() },
  });
}
function mockFetch() {
  const fetcher = vi.fn(async (_url: string, _options?: any) => ({
    ok: true,
    json: async () => ({ ok: true, value: "测试环境已释放" }),
  }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("真实 Cordis 依赖边界下设置覆盖对话也能调用恢复接口，不依赖已删除的命令服务", async () => {
  documentStub();
  const entries = new Map<string, any>();
  const fetcher = mockFetch();
  const ctx = new Context();
  ctx.provide("slots", {
    inject: (_name: string, fn: Function) => fn(),
    register: (entry: any) => {
      entries.set(entry.id ?? entry.key, entry);
      return () => {};
    },
  } as never);
  ctx.provide("sidebarRightTabs", { register: () => () => {} } as never);
  ctx.provide("sidebarRight", {
    mounted: { getSnapshot: () => undefined },
  } as never);
  ctx.provide("uiSession", {
    adapter: { current: { getSnapshot: () => ({ key: "one" }) } },
  } as never);
  ctx.provide("configForms", {} as never);
  ctx.provide("remote", {} as never);
  ctx.plugin(clientPlugin);
  try {
    await vi.waitFor(() => expect(entries.has("harness-test")).toBe(true));
    await expect(
      entries.get("harness-test").inject().recover("a".repeat(64)),
    ).resolves.toContain("已释放");
    expect(fetcher).toHaveBeenCalledWith(
      "/test-ui/recover",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ session_id: "one", token: "a".repeat(64) }),
      }),
    );
  } finally {
    await ctx.fiber.dispose();
  }
});
function setup() {
  documentStub();
  const fetcher = mockFetch();
  const entries = new Map<string, any>();
  const events = new Map<string, Function>();
  const tabs = new Map<string, any>();
  const subscribers = new Set<() => void>();
  let expanded = false,
    currentSession = "one",
    settingsOpen = false;
  let activeId: string | undefined;
  let serial = 0;
  const notify = () => subscribers.forEach((fn) => fn());
  const sidebar = {
    mounted: { getSnapshot: () => (settingsOpen ? undefined : currentSession) },
    openTabs: {
      getSnapshot: () => [...tabs.values()],
      subscribe: (fn: () => void) => {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
      },
    },
    isExpanded: () => expanded,
    toggleExpanded: vi.fn(() => {
      expanded = !expanded;
    }),
    openTab: vi.fn((kind: string) => {
      activeId = `tab-${++serial}`;
      tabs.set(activeId, { tabId: activeId, sessionId: currentSession, kind });
      expanded = true;
      notify();
    }),
    active: () => {
      const tab = tabs.get(activeId!);
      return tab && { id: tab.tabId, kind: tab.kind };
    },
    focus: vi.fn((id: string) => {
      activeId = id;
    }),
    float: vi.fn(),
    close: vi.fn((id = activeId) => {
      tabs.delete(id!);
      if (activeId === id) activeId = undefined;
      notify();
    }),
  };
  const ctx = {
    inject: (_names: string[], callback: Function) => callback(ctx),
    on: (name: string, listener: Function) => events.set(name, listener),
    configForms: {},
    remote: {},
    uiSession: {
      adapter: {
        current: { getSnapshot: () => ({ key: currentSession || undefined }) },
      },
    },
    effect: (fn: Function) => fn(),
    sidebarRight: sidebar,
    sidebarRightTabs: { register: () => () => {} },
    slots: {
      inject: (_name: string, fn: Function) => fn(),
      register: (entry: any) =>
        entries.set(entry.name + "/" + (entry.id ?? entry.key), entry),
    },
  };
  apply(ctx as never);
  const sessionActions = (id: string) =>
    entries.get("conversation.input.dock/harness-test-progress").inject(id);
  return {
    actions: sessionActions("one"),
    sessionActions,
    settings: entries.get("settings.section/harness-test").inject(),
    executed: (sid: string, name: string, result: object) =>
      events.get("command/executed")!(sid, name, result),
    state: {
      session_id: "one",
      run_id: "run-one",
      phase: "executing",
      preview: { ready: false },
    } as ProgressSnapshot,
    sidebar,
    tabs,
    fetcher,
    switchSession: (id = "other") => {
      currentSession = id;
    },
    openSettings: () => {
      settingsOpen = true;
    },
  };
}
it("无CDP、首帧未就绪或采集失败不创建浮窗；后台会话不抢占界面", () => {
  const t = setup();
  t.actions.followPreview(t.state);
  t.actions.openPreview(t.state);
  t.actions.openPreview({ ...t.state, preview: { ready: true, failed: true } });
  t.switchSession();
  t.actions.followPreview({ ...t.state, preview: { ready: true } });
  expect(t.sidebar.openTab).not.toHaveBeenCalled();
});
it("读取隔离不调用释放；恢复发送所选会话与确认编号，失败不显示成功", async () => {
  const t = setup();
  t.fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ quarantine: null, recovering: false }),
  } as never);
  await expect(
    t.settings.readRecovery(new AbortController().signal),
  ).resolves.toMatchObject({ quarantine: null });
  expect(t.fetcher).toHaveBeenCalledTimes(1);
  t.switchSession();
  t.openSettings();
  await expect(t.settings.recover("a".repeat(64))).resolves.toContain("已释放");
  expect(t.fetcher).toHaveBeenLastCalledWith(
    "/test-ui/recover",
    expect.objectContaining({
      body: JSON.stringify({ session_id: "other", token: "a".repeat(64) }),
    }),
  );
  t.fetcher.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ ok: false, message: "关闭失败，隔离仍保留" }),
  });
  await expect(t.settings.recover("a".repeat(64))).rejects.toThrow(
    "隔离仍保留",
  );
});
it("普通对话没有隔离查询或释放入口，未使用测试命令时没有提示", () => {
  const t = setup();
  expect(t.actions).not.toHaveProperty("readRecovery");
  expect(t.actions).not.toHaveProperty("recover");
  expect(t.actions.notice.getSnapshot()).toBe("");
  expect(t.sessionActions("other").notice.getSnapshot()).toBe("");
  expect(t.fetcher).not.toHaveBeenCalled();
});
it("只有保留的四个测试命令失败才提示发起会话；关闭提示不释放环境", () => {
  const t = setup();
  const changed = vi.fn();
  const unsubscribe = t.actions.notice.subscribe(changed);
  for (const name of [
    "help",
    "test-other-plugin",
    "test-status",
    "test-recover",
    "test-stop",
    "test-report",
    "test-release",
  ])
    t.executed("one", name, { kind: "error", text: "其他命令失败" });
  expect(t.actions.notice.getSnapshot()).toBe("");
  t.executed("one", "test", {
    kind: "error",
    text: "Error: 请进入设置释放环境",
  });
  expect(t.actions.notice.getSnapshot()).toBe("请进入设置释放环境");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(t.sessionActions("other").notice.getSnapshot()).toBe("");
  t.actions.notice.dismiss();
  expect(t.actions.notice.getSnapshot()).toBe("");
  expect(t.fetcher).not.toHaveBeenCalled();
  unsubscribe();
  t.executed("one", "test-run", { kind: "error", text: "文件不存在" });
  expect(changed).toHaveBeenCalledTimes(2);
  t.executed("one", "test-run", { kind: "success" });
  expect(t.actions.notice.getSnapshot()).toBe("");
});
it("设置释放失败保留提示、成功清除；无所选对话时不发送恢复请求", async () => {
  const t = setup();
  t.executed("one", "test-plan", { kind: "error", text: "请进入设置释放" });
  t.fetcher.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ ok: false, message: "关闭失败" }),
  });
  await expect(t.settings.recover("a".repeat(64))).rejects.toThrow("关闭失败");
  expect(t.actions.notice.getSnapshot()).toContain("设置");
  await t.settings.recover("a".repeat(64));
  expect(t.actions.notice.getSnapshot()).toBe("");
  t.switchSession("");
  t.fetcher.mockClear();
  await expect(t.settings.recover("a".repeat(64))).rejects.toThrow(
    "打开一个对话",
  );
  expect(t.fetcher).not.toHaveBeenCalled();
});
it("界面能提交处置文件与当前编号；报告入口准确绑定会话并支持指定历史运行", async () => {
  const t = setup();
  await t.settings.releaseEvidence("处置/proof.json", "b".repeat(64));
  expect(t.fetcher).toHaveBeenLastCalledWith(
    "/test-ui/release",
    expect.objectContaining({
      body: JSON.stringify({
        evidence_file: "处置/proof.json",
        token: "b".repeat(64),
      }),
    }),
  );
  t.switchSession("other");
  t.openSettings();
  await t.settings.rebuildReport();
  expect(t.fetcher).toHaveBeenLastCalledWith(
    "/test-ui/report",
    expect.objectContaining({ body: JSON.stringify({ session_id: "other" }) }),
  );
  await t.actions.rebuildReport("run-history");
  expect(t.fetcher).toHaveBeenLastCalledWith(
    "/test-ui/report",
    expect.objectContaining({
      body: JSON.stringify({ session_id: "one", run_id: "run-history" }),
    }),
  );
});
it("首帧只自动打开一次，原生关闭后不反复弹出，手动重开只操作布局", () => {
  const t = setup();
  const ready = { ...t.state, preview: { ready: true } };
  t.actions.followPreview(ready);
  expect(t.sidebar.float).toHaveBeenCalledTimes(1);
  expect(t.sidebar.isExpanded()).toBe(false);
  t.sidebar.close();
  t.actions.followPreview(ready);
  expect(t.sidebar.openTab).toHaveBeenCalledTimes(1);
  t.actions.openPreview(ready);
  expect(t.tabs.size).toBe(1);
  expect(t.fetcher).not.toHaveBeenCalled();
});
it("连续点击实时画面在零个和一个浮窗之间切换，轮询不会重新弹出隐藏画面", () => {
  const t = setup();
  const ready = { ...t.state, preview: { ready: true } };
  const changed = vi.fn();
  t.actions.previewVisible.subscribe(changed);
  t.actions.followPreview(ready);
  for (let i = 0; i < 10; i++) {
    t.actions.openPreview(ready);
    expect(t.tabs.size).toBe(i % 2 ? 1 : 0);
    expect(t.actions.previewVisible.getSnapshot()).toBe(i % 2 === 1);
    t.actions.followPreview(ready);
    expect(t.tabs.size).toBe(i % 2 ? 1 : 0);
  }
  expect(changed).toHaveBeenCalledTimes(11);
});
it("刷新后复用已有浮窗并移除历史重复，只影响所属会话", () => {
  const t = setup();
  for (const id of ["old-a", "old-b"])
    t.tabs.set(id, {
      tabId: id,
      sessionId: "one",
      kind: "harness-test-preview",
    });
  t.tabs.set("other-tab", {
    tabId: "other-tab",
    sessionId: "other",
    kind: "harness-test-preview",
  });
  t.actions.followPreview({ ...t.state, preview: { ready: true } });
  expect(t.sidebar.openTab).not.toHaveBeenCalled();
  expect(t.sidebar.focus).toHaveBeenCalledWith("old-a");
  expect([...t.tabs.keys()]).toEqual(["old-a", "other-tab"]);
  t.actions.openPreview({ ...t.state, preview: { ready: true } });
  expect([...t.tabs.keys()]).toEqual(["other-tab"]);
});
it("结束或新运行时关闭旧画面；新运行也要等待真实首帧", () => {
  const t = setup();
  t.actions.followPreview({ ...t.state, preview: { ready: true } });
  t.actions.followPreview({
    ...t.state,
    run_id: "run-next",
    preview: { ready: false },
  });
  expect(t.tabs.size).toBe(0);
  t.actions.followPreview({
    ...t.state,
    run_id: "run-next",
    preview: { ready: true },
  });
  expect(t.tabs.size).toBe(1);
  t.actions.followPreview({
    ...t.state,
    run_id: "run-next",
    phase: "finished",
    preview: { ready: false },
  });
  expect(t.tabs.size).toBe(0);
});
it("采集终止关闭已有浮窗，不为失败状态重开窗口", () => {
  const t = setup();
  t.actions.followPreview({ ...t.state, preview: { ready: true } });
  t.actions.followPreview({
    ...t.state,
    preview: { ready: false, failed: true, reason: "采集已退出" },
  });
  expect(t.tabs.size).toBe(0);
  expect(t.sidebar.openTab).toHaveBeenCalledTimes(1);
  expect(t.actions.notice.getSnapshot()).toBe("");
});
