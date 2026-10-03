/** M0 专用宿主探针，仅由独立验证配置加载，不进入发行包。 */
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { ToolCallId } from "@deepseek-ai/dsh-llm/brand";
export const name = "test-probe";
export const inject = ["agents", "tools", "commands", "agentDefaultModel"];
export function apply(ctx, config) {
  mkdirSync(dirname(config.output), { recursive: true });
  const state = { status: "RUNNING", checks: [], events: [], bodies: 0 };
  const save = () =>
    writeFileSync(config.output, JSON.stringify(state, null, 2));
  ctx.effect(() =>
    ctx.commands.register({
      name: "test-m0-approval",
      description: "验证原生审批",
      handler: ({ agent, rawInput }) => {
        const file =
          dirname(config.output) + "/approval-" + rawInput.trim() + ".json";
        const record = { session_id: agent.id, bodies: 0, status: "RUNNING" };
        const persist = () =>
          writeFileSync(file, JSON.stringify(record, null, 2));
        persist();
        const removeTool = agent.ctx.tools.register({
          name: "m0_approval",
          description: "请求一次无害测试审批，然后结束。",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          output: {
            schema: { type: "object" },
            render: (_, v) => [{ type: "text", text: JSON.stringify(v) }],
          },
          execute: async (_, exec) => {
            record.bodies++;
            persist();
            exec.concludeTurn();
            return { ok: true };
          },
        });
        let asked = false;
        const removeGate = agent.ctx.on(
          "tools/pre-execute",
          async (exec, next) => {
            if (exec.name !== "m0_approval")
              return { kind: "deny", reason: "M0只允许审批探针" };
            if (asked) return { kind: "deny", reason: "不得重试审批" };
            asked = true;
            return {
              kind: "ask",
              reason: "M0原生审批验证：只增加本地计数，不改变网站数据",
            };
          },
        );
        agent.followup({
          content: [
            {
              type: "text",
              text: "只调用一次 m0_approval；无论批准还是拒绝，都不要重试，随后结束。",
            },
          ],
          source: { kind: "user" },
        });
        void agent.whenIdle().then(() => {
          record.status = "FINISHED";
          persist();
          removeGate();
          removeTool();
        });
        return { kind: "success", text: "原生审批探针已启动" };
      },
    }),
  );
  const check = (name, ok, detail) => {
    state.checks.push({ name, ok, detail });
    save();
    if (!ok) throw new Error(name);
  };
  let handle;
  ctx.on("session/event", (session, event) => {
    if (
      session.id === handle?.agent.id ||
      String(session.id).startsWith("m0-")
    ) {
      state.events.push({
        type: event.type,
        data: [
          "tool/call",
          "tool/result",
          "approval/asked",
          "approval/decided",
          "turn/end",
          "assistant/message",
        ].includes(event.type)
          ? event.data
          : {},
      });
      save();
    }
  });
  setTimeout(() => {
    void run().catch((error) => {
      state.status = "ERROR";
      state.error = String(error);
      save();
    });
  }, 1000);
  async function run() {
    save();
    handle = await ctx.agents.create({
      sessionId: SessionId("m0-" + randomUUID()),
      meta: { cwd: config.workspace },
      agentOptions: ctx.agentDefaultModel.currentSelection(),
      setup: (scope) => {
        scope.effect(() =>
          scope.tools.restrict({
            allow: [
              "mcp__playwright__browser_navigate",
              "mcp__playwright__browser_snapshot",
              "mcp__playwright__browser_close",
            ],
          }),
        );
        scope.effect(() =>
          scope.tools.register({
            name: "m0_probe",
            description: "完成兼容性探针，调用一次即可结束。",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            output: {
              schema: { type: "object" },
              render: (_, v) => [{ type: "text", text: JSON.stringify(v) }],
            },
            execute: async (_, exec) => {
              state.bodies++;
              exec.concludeTurn();
              return { ok: true };
            },
          }),
        );
      },
    });
    check("独立Agent已创建", ctx.agents.get(handle.agent.id) === handle.agent, {
      id: handle.agent.id,
    });
    const call = async (name, args, signal = new AbortController().signal) => {
      const callId = ToolCallId(randomUUID());
      state.events.push({ type: "probe-bound", callId, name });
      save();
      return ctx.tools.execute({
        callId,
        name,
        arguments: args,
        agent: handle.agent,
        signal,
      });
    };
    const abort = new AbortController();
    abort.abort();
    const before = state.bodies;
    check(
      "提前取消不执行工具体",
      (await call("m0_probe", {}, abort.signal)).isError &&
        state.bodies === before,
    );
    const deny = handle.agent.ctx.tools.guard((exec) =>
      exec.name === "m0_probe" ? "M0拒绝" : undefined,
    );
    check(
      "拒绝不执行工具体",
      (await call("m0_probe", {})).isError && state.bodies === before,
    );
    deny();
    check("非法参数物化有终态", (await call("m0_probe", undefined)).isError);
    const browser = await call("mcp__playwright__browser_navigate", {
      url: "https://ceshiren.com",
    });
    check("真实PlaywrightMCP可调用", !browser.isError, browser);
    const snapshot = await call("mcp__playwright__browser_snapshot", {});
    check("实际页面观察存在", !snapshot.isError, snapshot);
    await call("mcp__playwright__browser_close", {});
    handle.agent.followup({
      content: [
        {
          type: "text",
          text: "请仅调用一次 m0_probe 工具，然后结束。不要调用其他工具。",
        },
      ],
      source: { kind: "user" },
    });
    await Promise.race([
      handle.agent.whenIdle(),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error("模型探针超时")), 120000);
        t.unref();
      }),
    ]);
    const calls = state.events.filter((e) => e.type === "tool/call");
    check(
      "模型驱动工具并结算",
      state.bodies === before + 1 &&
        calls.some((e) => e.data.name === "m0_probe"),
    );
    const seq = state.events.map((e) => e.type);
    check(
      "会话调用事件先于结果",
      seq.indexOf("tool/call") < seq.indexOf("tool/result"),
    );
    await handle.dispose();
    check("Agent释放", !ctx.agents.get(handle.agent.id));
    state.status = "PASSED";
    save();
  }
}
