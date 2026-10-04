/** 同一个插件包的浏览器端入口，使用 DSH 官方插槽与浮窗。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-commands";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-client-ui-commands/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { TabId } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { PreviewSettingsPage } from "./preview-settings.js";
import type { ProgressSnapshot } from "../progress-model.js";
import type { RecoverySnapshot } from "../recovery.js";
import type { RecoveryActions } from "./recovery-panel.js";
import {
  PreviewPanel,
  ProgressDetails,
  ProgressDock,
  ProgressHeader,
  type ProgressActions,
} from "./components.js";
import { progressStyle } from "./style.js";

export const name = "harness-test-ui";
export const inject = [
  "slots",
  "sidebarRightTabs",
  "sidebarRight",
  "remote",
  "remote.commands",
] as const;
const progressKind = "harness-test-progress";
const previewKind = "harness-test-preview";
const progressId = "dsh-test-plugin:progress";
const previewId = "dsh-test-plugin:preview";
const testCommands = new Set([
  "test",
  "test-plan",
  "test-run",
  "test-data",
  "test-status",
  "test-stop",
  "test-report",
  "test-recover",
  "test-release",
]);

export function apply(ctx: Context): void {
  const recovery: RecoveryActions = {
    readRecovery: async (signal) => {
      const response = await fetch("/test-recovery", {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("隔离状态读取失败");
      return (await response.json()) as RecoverySnapshot;
    },
    recover: async (token) => {
      const sessionId = ctx.sidebarRight.mounted.getSnapshot();
      if (!sessionId)
        throw new Error(
          "请先关闭设置并打开一个对话，再进入测试插件设置释放环境。",
        );
      const result = await ctx.remote.commands.execute(
        sessionId,
        `/test-recover --confirm ${token}`,
        [],
      );
      if (!result.ok) throw new Error(result.error.message);
      if (!result.value || result.value.result.kind === "error")
        throw new Error(result.value?.result.text ?? "释放命令未被识别");
      for (const record of faces.values()) record.setNotice("");
      return result.value.result.text ?? "测试环境已释放，请重新发送测试命令。";
    },
  };
  ctx.inject(["configForms"], (settings) => {
    settings.slots.inject("settings.section", () =>
      settings.slots.register(
        {
          name: "settings.section",
          id: "harness-test",
          order: 35,
          label: () => "测试插件",
          inject: () => ({ forms: settings.configForms, ...recovery }),
        },
        PreviewSettingsPage,
      ),
    );
  });
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-test-plugin";
    style.textContent = progressStyle;
    document.head.append(style);
    return () => style.remove();
  });
  for (const [id, kind, title] of [
    [progressId, progressKind, "测试进度"],
    [previewId, previewKind, "浏览器实时画面"],
  ] as const)
    ctx.effect(() =>
      ctx.sidebarRightTabs.register({ id, kind, title: () => title }),
    );

  const faces = new Map<
    string,
    {
      actions: ProgressActions;
      setNotice: (message: string) => void;
    }
  >();
  const face = (sessionId: string): ProgressActions => {
    const existing = faces.get(sessionId);
    if (existing) return existing.actions;
    let notice = "";
    const listeners = new Set<() => void>();
    const setNotice = (message: string) => {
      if (notice === message) return;
      notice = message;
      for (const listener of listeners) listener();
    };
    const opened = new Set<string>();
    let tabId: TabId | undefined;
    let previewRun: string | undefined;
    const foreground = () =>
      ctx.sidebarRight.mounted.getSnapshot() === sessionId;
    const openPreview = (state: ProgressSnapshot) => {
      if (!foreground() || !state.preview.ready || state.phase === "finished")
        return;
      const expanded = ctx.sidebarRight.isExpanded();
      ctx.sidebarRight.openTab(previewKind);
      const tab = ctx.sidebarRight.active();
      if (tab?.kind !== previewKind) return;
      tabId = tab.id;
      previewRun = state.run_id;
      opened.add(state.run_id);
      ctx.sidebarRight.float(tab.id);
      if (!expanded && ctx.sidebarRight.isExpanded())
        ctx.sidebarRight.toggleExpanded();
    };
    const actions: ProgressActions = {
      notice: {
        getSnapshot: () => notice,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        dismiss: () => setNotice(""),
      },
      read: async (signal) => {
        const response = await fetch(
          `/test-progress/${encodeURIComponent(sessionId)}`,
          { signal, cache: "no-store" },
        );
        if (!response.ok) throw new Error("进度读取失败");
        const state = (await response.json()) as ProgressSnapshot | null;
        if (state && state.session_id !== sessionId)
          throw new Error("进度会话不匹配");
        return state;
      },
      openDetails: () => {
        if (foreground())
          ctx.sidebarRight.openTab(progressKind, { preferNewPane: true });
      },
      openPreview,
      followPreview: (state) => {
        if (!foreground()) return;
        if (
          tabId &&
          (state.run_id !== previewRun || state.phase === "finished")
        ) {
          ctx.sidebarRight.close(tabId);
          tabId = undefined;
          previewRun = undefined;
        }
        if (
          state.preview.ready &&
          state.phase !== "finished" &&
          !opened.has(state.run_id)
        )
          openPreview(state);
      },
    };
    faces.set(sessionId, { actions, setNotice });
    return actions;
  };
  ctx.on("command/executed", (sessionId, command, result) => {
    if (!testCommands.has(command)) return;
    face(sessionId);
    faces
      .get(sessionId)!
      .setNotice(
        result.kind === "error"
          ? (result.text ?? "测试命令执行失败").replace(/^Error:\s*/, "")
          : "",
      );
  });
  ctx.slots.inject("conversation.input.dock", () =>
    ctx.slots.register(
      {
        name: "conversation.input.dock",
        id: "harness-test-progress",
        order: 20,
        inject: (sessionId) => face(sessionId),
      },
      ProgressDock,
    ),
  );
  ctx.slots.inject("conversation.session.header.actions", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.actions",
        id: "harness-test-progress",
        order: 20,
        inject: (sessionId) => face(sessionId),
      },
      ProgressHeader,
    ),
  );
  ctx.slots.inject("sidebar.right.pane.tab", () =>
    ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: progressId,
        inject: (sessionId) => face(sessionId),
      },
      ProgressDetails,
    ),
  );
  ctx.slots.inject("sidebar.right.pane.tab", () =>
    ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: previewId,
        inject: (sessionId) => face(sessionId),
      },
      PreviewPanel,
    ),
  );
}
