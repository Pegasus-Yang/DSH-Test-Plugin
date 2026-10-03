/** 有界自然语言规划，只提交计划或明确提出缺口，不执行业务动作。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent-default-model";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { MessageId } from "@deepseek-ai/dsh-llm/brand";
import { randomUUID } from "node:crypto";
import { parsePlan, planSchema, type TestSuite } from "./contracts.js";
export async function planTask(
  ctx: Context,
  task: string,
  workspace: string,
  timeoutMs = 120000,
  signal?: AbortSignal,
): Promise<TestSuite> {
  if (!task.trim()) throw new Error("请提供动作、输入和可验证预期");
  let plan: TestSuite | undefined,
    question: string | undefined,
    attempts = 0;
  let closed = false,
    lastError = "",
    modelSteps = 0;
  const source = {
    id: "user_task",
    kind: "user",
    uri: "user:task",
    version: "1",
    locator: "原始输入",
    excerpt: task,
  };
  const example = {
    schema_version: "1",
    suite_id: "demo",
    name: "结构示例（值不能照抄）",
    source_refs: [source],
    cases: [
      {
        case_id: "demo",
        name: "读取数值",
        preconditions: [],
        cleanup: [],
        datasets: [],
        steps: [
          {
            step_id: "read",
            kind: "action",
            description: "读取用户指定网页元素",
            required: true,
            depends_on: [],
            action: {
              goal: "访问用户指定网址、等待元素后test_capture、test_finish_step",
              capability: "browser",
              allowed_targets: ["https://example.invalid"],
              inputs: {},
              outputs: { value: { type: "number" } },
              capture: {
                value: {
                  kind: "dom",
                  mode: "number",
                  selector: "#用户指定元素",
                },
              },
              completion_requirements: ["value"],
            },
          },
          {
            step_id: "check",
            kind: "assertion",
            description: "按用户预期核对",
            required: true,
            depends_on: ["read"],
            assertion: {
              observation_ref: "read.value",
              operator: "eq",
              literal: 7,
              rule_ref: "user_task",
            },
          },
        ],
      },
    ],
  };
  const handle = await ctx.agents.create({
    sessionId: SessionId("test-plan-" + randomUUID()),
    meta: { cwd: workspace },
    agentOptions: ctx.agentDefaultModel.currentSelection(),
    setup: (scope) => {
      scope.on("agent/pre-step", async (_, next) =>
        closed || ++modelSteps > 8 ? { kind: "reject" } : next(),
      );
      scope.effect(() => scope.tools.restrict({ allow: [] }));
      scope.effect(() =>
        scope.tools.guard((exec) =>
          !closed &&
          ["test_submit_plan", "test_need_clarification"].includes(exec.name)
            ? undefined
            : "规划器仅可提交计划或问题",
        ),
      );
      const output = {
        schema: { type: "object" as const },
        render: (_: unknown, value: unknown) => [
          { type: "text" as const, text: JSON.stringify(value) },
        ],
      };
      scope.effect(() =>
        scope.tools.register({
          name: "test_submit_plan",
          description: "提交完整可执行计划；缺字段会返回错误，最多三次。",
          parameters: planSchema,
          output,
          execute: async (args, exec) => {
            attempts++;
            const value = structuredClone(args) as TestSuite;
            value.source_refs = [source];
            try {
              plan = parsePlan(value);
            } catch (error) {
              lastError = String(error);
              if (attempts >= 3) {
                closed = true;
                exec.concludeTurn();
              }
              return {
                accepted: false,
                error: lastError,
                remaining_attempts: 3 - attempts,
              };
            }
            closed = true;
            exec.concludeTurn();
            return { accepted: true };
          },
        }),
      );
      scope.effect(() =>
        scope.tools.register({
          name: "test_need_clarification",
          description:
            "任务缺少预期、来源冲突或无法确定可信采集方式时提出问题并停止。",
          parameters: {
            type: "object",
            required: ["question"],
            properties: { question: { type: "string" } },
            additionalProperties: false,
          },
          output,
          execute: async (args, exec) => {
            question = (args as { question: string }).question;
            closed = true;
            exec.concludeTurn();
            return { blocked: true, question };
          },
        }),
      );
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: () => void = () => {};
  try {
    handle.agent.followup({
      role: "user",
      id: MessageId(randomUUID()),
      source: { kind: "user" },
      content: [
        {
          type: "text",
          text: `使用简体中文将以下用户任务转成最小测试计划。必须调用test_submit_plan工具提交合同，不要只在聊天里输出JSON文本，不执行网页动作。用户原文：${task}\n所有规则rule_ref固定为user_task，不能编造预期或更改用户数值。schema_version必须为字符串"1"。无业务前置或特有清理时preconditions和cleanup必须是空数组，runner自动初始化/释放浏览器（包含用户要求关闭浏览器），不要输出自造的browser_context，也不要给普通步骤添加resource_ref。步骤分准备/业务/清理，至少一个required业务断言。输入缺预期或存在冲突调用test_need_clarification。\noutputs只能写JSON Schema，不能写采集配置。例如 action.outputs={"value":{"type":"number"}}，另外 action.capture={"value":{"kind":"dom","mode":"number","selector":"#value"}}，completion_requirements=["value"]。此例只演示结构，选择器和预期必须遵循用户输入。动作goal写清导航、等待、采集；无需拆出空的上下文步骤。\nDOM采集capture由冻结CSS selector和mode组成(kind dom; mode text/number/count/visible/url/attribute)，数值必须严格number；HTTP采集kind http,url,field(如body.count)；关闭浏览器采集kind browser_close返回boolean。每个必要输出必须有capture并列入completion_requirements。捕获网址用mode url；资源仅browser_context。allowed_targets使用完整URL；无授权不要写网站数据。断言observation_ref格式step_id.output_name，literal或expected_ref(data.expected.key)二选一。不要将事实值当作预期。source_refs=${JSON.stringify([source])}\n以下为完整结构示例，网址、选择器和literal必须替换为用户实际任务，单行固定预期使用literal，不必引入expected_ref：${JSON.stringify(example)}`,
        },
      ],
    });
    await Promise.race([
      (async () => {
        for (let n = 0; n < 3; n++) {
          await handle.agent.whenIdle();
          if (plan || question || closed) return;
          handle.agent.followup({
            role: "user",
            id: MessageId(randomUUID()),
            source: { kind: "user" },
            content: [
              {
                type: "text",
                text: "请现在调用test_submit_plan工具提交，不要输出JSON文本。preconditions=[]，cleanup=[]，runner负责关闭浏览器。字段错误请依据工具反馈纠正，不向用户询问实现合同。",
              },
            ],
          });
        }
        await handle.agent.whenIdle();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("规划超时")), timeoutMs);
        aborted = () => reject(new Error("规划已取消"));
        if (signal?.aborted) aborted();
        else signal?.addEventListener("abort", aborted, { once: true });
      }),
    ]);
    if (question)
      throw new Error(
        (/schema|expected_ref|datasets|合同.*拒/i.test(question)
          ? "规划合同错误："
          : "需要确认：") + question,
      );
    if (!plan) throw new Error("未产生合法计划，已停止。" + lastError);
    return plan;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", aborted);
    handle.agent.cancel({ kind: "user" });
    await handle.dispose();
  }
}
