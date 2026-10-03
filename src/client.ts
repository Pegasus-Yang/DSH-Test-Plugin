/** 使用宿主原生对话扩展点显示测试进度，不操作聊天页内部DOM。 */
import { createElement as h, useState, useEffect } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ChatNodeViewProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-commands/types";
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
import type { TestProgress } from "./progress-types.js";

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "test-progress": TestProgress;
  }
}
export const inject = [
  "uiConversation",
  "slots",
  "uiWorkspace",
  "sessions",
  "remote",
  "remote.commands",
];
export const progressDefinition: ConversationNodeDefinition<{
  seq: number;
  progress: TestProgress;
}> = {
  kind: "test-progress",
  target: "chat",
  match: (event) => {
    if (
      event.type === "command/run" &&
      ["test", "test-run", "test-report"].includes(event.data.name)
    )
      return { id: event.data.commandId, role: "start" };
    if (event.type === "command/done")
      return { id: event.data.commandId, role: "update" };
    return null;
  },
  start: (_context, match) => {
    if (match.event.type !== "command/run")
      throw new Error("测试命令事件类型错误");
    return {
      seq: match.event.seq,
      progress: {
        id: match.event.data.commandId,
        sessionId: "",
        title: "测试执行",
        state: "planning",
        detail: "正在读取测试进度",
        updatedAt: "",
        instances: [],
      },
    };
  },
  update: (context, match) =>
    context.state && match.event.type === "command/done"
      ? {
          ...context.state,
          progress: {
            ...context.state.progress,
            state: "error",
            detail: match.event.data.text ?? "命令已结束",
          },
        }
      : context.state,
  buildViewNode: (context) =>
    context.state
      ? {
          key: context.key,
          kind: "test-progress",
          id: context.id,
          target: "chat",
          anchorSeq: context.state.seq,
          location: context.start?.location ?? { kind: "unresolved" },
          visibility: "visible",
          data: context.state.progress,
        }
      : null,
};
const labels: Record<string, string> = {
  planning: "正在规划",
  running: "测试执行中",
  cancelling: "正在停止与清理",
  finished: "测试已结束",
  error: "测试未能执行",
  setup: "准备",
  business: "业务",
  test: "业务",
  cleanup: "清理",
  PENDING: "等待",
  RUNNING: "执行中",
  SUCCEEDED: "完成",
  PASS: "通过",
  FAIL: "失败",
  ERROR: "错误",
  BLOCKED: "阻塞",
  INCONCLUSIVE: "证据不足",
  CANCELLED: "已取消",
  SKIPPED: "跳过",
};
const buttonStyle = {
  font: "inherit",
  cursor: "pointer",
  color: "inherit",
  background: "transparent",
  border: "1px solid currentColor",
  borderRadius: 6,
  padding: "3px 8px",
};
function ProgressView({
  progress,
  open,
  stop,
}: {
  progress: TestProgress;
  open: (id: string) => Promise<void>;
  stop: (progress: TestProgress) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<TestProgress>();
  const p = snapshot ?? progress;
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      let finished = false;
      try {
        const response = await fetch(
          `./test-reports/conversation/${encodeURIComponent(progress.id)}.json`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (response.status === 404 && progress.state === "error")
          finished = true;
        if (response.ok) {
          const next = (await response.json()) as TestProgress;
          if (!disposed) setSnapshot(next);
          finished = next.state === "finished" || next.state === "error";
        }
      } catch {
        /* 短暂断连后继续读取已落盘的进度。 */
      }
      if (!disposed && !finished) timer = setTimeout(poll, 500);
    };
    void poll();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [progress.id, progress.state]);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const session = (id: string | undefined, label: string) =>
    id
      ? h(
          "button",
          {
            type: "button",
            style: buttonStyle,
            onClick: async () => {
              try {
                await open(id);
              } catch (error) {
                setError(String(error));
              }
            },
          },
          label,
        )
      : null;
  return h(
    "section",
    {
      "aria-label": "测试执行进度",
      style: {
        margin: "12px 0",
        padding: "12px 0",
        borderTop: "1px solid #8885",
        overflowWrap: "anywhere",
      },
    },
    h("strong", null, `${labels[p.state]} · ${p.title}`),
    h("p", { role: "status", "aria-live": "polite" }, p.detail),
    p.runId ? h("small", null, `运行ID：${p.runId}`) : null,
    h(
      "div",
      { style: { display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" } },
      session(p.planningSession, "查看规划会话"),
      p.state === "planning" || p.state === "running"
        ? h(
            "button",
            {
              type: "button",
              style: buttonStyle,
              disabled: stopping,
              onClick: async () => {
                setStopping(true);
                setError("");
                try {
                  await stop(p);
                } catch (e) {
                  setError(String(e));
                  setStopping(false);
                }
              },
            },
            stopping ? "停止请求已提交" : "停止测试",
          )
        : null,
    ),
    error ? h("p", { role: "alert" }, error) : null,
    ...p.instances.map((i) =>
      h(
        "div",
        { key: i.id, style: { margin: "12px 0" } },
        h(
          "strong",
          null,
          `${i.name} / ${i.dataId} · ${labels[i.status] ?? i.status}`,
        ),
        h(
          "div",
          { style: { display: "flex", gap: 8, margin: "6px 0" } },
          session(i.sessionId, "查看工具与审批"),
          session(i.cleanupSession, "查看清理会话"),
        ),
        h(
          "ol",
          { style: { paddingLeft: 24 } },
          ...i.steps.map((s) =>
            h(
              "li",
              { key: `${s.phase}/${s.id}`, style: { margin: "10px 0" } },
              h(
                "div",
                null,
                `[${labels[s.phase] ?? s.phase}] ${s.description} — ${labels[s.status] ?? s.status}`,
              ),
              s.tool
                ? h(
                    "small",
                    null,
                    `工具：${s.tool.name} · ${s.tool.finished ? (s.tool.error ? "错误" : "已完成") : "执行中"}`,
                  )
                : null,
              ...s.values.map((v) =>
                h(
                  "div",
                  { key: v.name },
                  `采集 ${v.name}：${JSON.stringify(v.value)}`,
                ),
              ),
              s.assertion
                ? h(
                    "div",
                    null,
                    `断言 ${labels[s.assertion.status] ?? s.assertion.status}：实际 ${JSON.stringify(s.assertion.actual)} ${s.assertion.operator} 预期 ${JSON.stringify(s.assertion.expected)}`,
                  )
                : null,
              s.reason ? h("div", null, s.reason) : null,
            ),
          ),
        ),
      ),
    ),
    p.report
      ? h(
          "div",
          null,
          h(
            "a",
            {
              href: p.report.url,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            "查看测试报告",
          ),
          h("p", null, `保存位置：${p.report.path}`),
        )
      : null,
    h("small", null, `更新时间：${p.updatedAt}`),
  );
}
export function apply(
  ctx: Omit<Context, "sessions"> & { sessions: ISessions },
): void {
  ctx.uiConversation.events.register(progressDefinition);
  ctx.slots.inject("conversation.chat.node", () =>
    ctx.slots.register(
      { name: "conversation.chat.node", key: "test-progress" },
      ({ node }: Pick<ChatNodeViewProps<"test-progress">, "node">) =>
        h(ProgressView, {
          progress: node.data,
          open: async (id) => {
            await ctx.sessions.refresh();
            ctx.uiWorkspace.openSession(id as SessionId);
          },
          stop: async (progress) => {
            const result = await ctx.remote.commands.execute(
              progress.sessionId as SessionId,
              `/test-stop ${progress.runId ?? progress.id}`,
              [],
            );
            if (!result.ok) throw new Error(result.error.message);
            if (result.value?.result.kind === "error")
              throw new Error(result.value.result.text);
          },
        }),
    ),
  );
}
