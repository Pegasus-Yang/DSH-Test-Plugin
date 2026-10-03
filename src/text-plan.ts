/** 自然语言只规划业务短句；运行时再把当前步骤绑定到执行和断言契约。 */
import {
  ajv,
  parsePlan,
  type AssertionSpec,
  type TestSuite,
} from "./contracts.js";

export const textPlanSchema = {
  type: "object",
  required: ["name", "steps"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, description: "测试任务的简短名称" },
    steps: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["description"],
        additionalProperties: false,
        properties: {
          description: {
            type: "string",
            minLength: 1,
            description: "一个业务动作短句，不编造工具参数或页面细节",
          },
          checks: {
            type: "array",
            items: { type: "string", minLength: 1 },
            description:
              "本步应核对的文字预期；无检查点可省略。保留用户给出的预期含义",
          },
        },
      },
    },
  },
};
interface TextPlan {
  name: string;
  steps: { description: string; checks?: string[] }[];
}
const validate = ajv.compile<TextPlan>(textPlanSchema);

export function parseTextPlan(
  input: unknown,
  task: string,
  session: string,
): TestSuite {
  if (!validate(input)) throw new Error(ajv.errorsText(validate.errors));
  const steps = input.steps.map((s, n) => ({
    step_id: `step_${n + 1}`,
    kind: "intent" as const,
    description: s.description.trim(),
    checks: (s.checks ?? []).map((t) => t.trim()),
    required: true,
    depends_on: n ? [`step_${n}`] : [],
  }));
  if (!steps.some((s) => s.checks.length))
    throw new Error(
      "请用文字保留用户要求的检查点；没有明确预期时正常追问，不要编造断言参数",
    );
  const source = { kind: "user", uri: `session:${session}`, version: "1" };
  return parsePlan(
    {
      schema_version: "1",
      suite_id: "text_plan",
      name: input.name.trim(),
      source_refs: [
        { ...source, id: "user_task", locator: "用户原文", excerpt: task },
        ...steps.flatMap((s) =>
          s.checks.map((check, n) => ({
            ...source,
            id: `${s.step_id}_check_${n + 1}`,
            locator: s.description,
            excerpt: check,
          })),
        ),
      ],
      cases: [
        {
          case_id: "scenario",
          name: input.name.trim(),
          datasets: [{ data_id: "default", inputs: {}, expected: {} }],
          preconditions: [],
          cleanup: [],
          steps,
        },
      ],
    },
    true,
  );
}

export function textReview(plan: TestSuite): string {
  return (
    `# ${plan.name}\n\n请审核以下业务步骤和检查点；可要求修改，批准后再逐步确定具体操作。\n\n` +
    plan.cases[0]!.steps.map(
      (s, n) =>
        `${n + 1}. ${s.description}` +
        (s.checks?.length ? `\n\n   检查：${s.checks.join("；")}` : ""),
    ).join("\n\n") +
    "\n\n规划阶段不访问目标。工具、定位、请求参数和数据提取方式在执行当前步骤时根据实际情况确定；检查预期仍以这里的文字和用户原文为准。"
  );
}

/** 只在绑定时核对明确的简单数字条件，不在规划时要求执行参数。 */
export function validateTextExpectation(
  text: string,
  assertion: AssertionSpec,
): void {
  const match =
    /(不为|不等于|等于|为)\s*(-?\d+(?:\.\d+)?)\s*(?:$|[，。；])/.exec(text);
  if (!match) return;
  const expected = Number(match[2]);
  const operator = match[1]!.startsWith("不") ? "neq" : "eq";
  if (assertion.operator !== operator || assertion.literal !== expected)
    throw new Error(
      `文字检查明确要求${operator}数字${expected}；用number采集数值，expected_json传${JSON.stringify(String(expected))}，不能换成数字字符串或按实际值修改预期`,
    );
}
