/** 同一个插件包的浏览器端入口，使用 DSH 官方插槽与浮窗。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type { TabId } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { PreviewSettingsPage } from "./preview-settings.js";
import type { ProgressSnapshot } from "../progress-model.js";
import {
  PreviewPanel,
  ProgressDetails,
  ProgressDock,
  ProgressHeader,
  type ProgressActions,
} from "./components.js";
import { progressStyle } from "./style.js";

export const name = "harness-test-ui";
export const inject = ["slots", "sidebarRightTabs", "sidebarRight"] as const;
const progressKind = "harness-test-progress";
const previewKind = "harness-test-preview";
const progressId = "dsh-test-plugin:progress";
const previewId = "dsh-test-plugin:preview";

export function apply(ctx: Context): void {
  ctx.inject(["configForms"], (settings) => {
    settings.slots.inject("settings.section", () =>
      settings.slots.register(
        {
          name: "settings.section",
          id: "harness-test",
          order: 35,
          label: () => "测试插件",
          inject: () => ({ forms: settings.configForms }),
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

  const faces = new Map<string, ProgressActions>();
  const face = (sessionId: string): ProgressActions => {
    const existing = faces.get(sessionId);
    if (existing) return existing;
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
    faces.set(sessionId, actions);
    return actions;
  };
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
