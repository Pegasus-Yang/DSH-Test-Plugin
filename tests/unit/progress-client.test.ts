import { afterEach, expect, it, vi } from "vitest";
import { apply } from "../../src/client/index.js";
import type { ProgressSnapshot } from "../../src/progress-model.js";

afterEach(() => vi.unstubAllGlobals());
function setup() {
  vi.stubGlobal("document", {
    createElement: () => ({ dataset: {}, remove: vi.fn() }),
    head: { append: vi.fn() },
  });
  const entries = new Map<string, any>();
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
