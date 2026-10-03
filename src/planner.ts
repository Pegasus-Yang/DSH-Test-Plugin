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
): Promise<TestSuite> {
  if (!task.trim()) throw new Error("请提供动作、输入和可验证预期");
  let plan: TestSuite | undefined,
    question: string | undefined,
    attempts = 0;
  const source = {
    id: "user_task",
    kind: "user",
    uri: "user:task",
    version: "1",
    locator: "原始输入",
    excerpt: task,
  };
  const handle = await ctx.agents.create({
    sessionId: SessionId("test-plan-" + randomUUID()),
    meta: { cwd: workspace },
    agentOptions: ctx.agentDefaultModel.currentSelection(),
    setup: (scope) => {
      scope.effect(() => scope.tools.restrict({ allow: [] }));
      scope.effect(() =>
        scope.tools.guard((exec) =>
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
            if (++attempts > 3) {
              exec.concludeTurn();
              throw new Error("计划纠正次数已耗尽");
            }
            const value = structuredClone(args) as TestSuite;
            value.source_refs = [source];
            plan = parsePlan(value);
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
            exec.concludeTurn();
            return { blocked: true, question };
          },
        }),
      );
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    handle.agent.followup({
      role: "user",
      id: MessageId(randomUUID()),
      source: { kind: "user" },
      content: [
        {
          type: "text",
          text: `将以下用户任务转成测试计划。仅提交JSON合同，不执行网页动作。用户原文：${task}\n所有规则rule_ref固定为user_task，不能编造预期或更改用户数值。步骤分准备/业务/清理，至少一个required业务断言。输入缺预期或存在冲突调用test_need_clarification。DOM采集capture由冻结CSS selector和mode组成(kind dom; mode text/number/count/visible/url/attribute)，数值必须严格number；HTTP采集kind http,url,field(如body.count)；关闭浏览器采集kind browser_close返回boolean。每个必要输出必须有capture并列入completion_requirements。捕获网址用mode url；资源仅browser_context。allowed_targets使用完整URL；无授权不要写网站数据。断言observation_ref格式step_id.output_name，literal或expected_ref(data.expected.key)二选一。不要将事实值当作预期。source_refs=${JSON.stringify([source])}`,
        },
      ],
    });
    await Promise.race([
      handle.agent.whenIdle(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("规划超时")), timeoutMs);
      }),
    ]);
    if (question) throw new Error("需要确认：" + question);
    if (!plan) throw new Error("未产生合法计划，已停止");
    return plan;
  } finally {
    if (timer) clearTimeout(timer);
    handle.agent.cancel({ kind: "user" });
    await handle.dispose();
  }
}
