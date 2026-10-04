/** 自然语言只规划业务短句；运行时再把当前步骤绑定到执行和断言契约。 */
import {
  ajv,
  parsePlan,
  type AssertionSpec,
  type Json,
  type TestSuite,
} from "./contracts.js";
import type { TextInput } from "./case-input.js";

export const textPlanSchema = {
  type: "object",
  required: ["name", "steps"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, description: "测试任务的简短名称" },
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "面向用户的一两句拆分说明：说明步骤顺序和检查目的，不展开详细推理，不预设工具参数",
    },
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
  rationale?: string;
  steps: { description: string; checks?: string[] }[];
}
const validate = ajv.compile<TextPlan>(textPlanSchema);

export const batchTextPlanSchema = {
  type: "object",
  required: ["name", "cases"],
  additionalProperties: false,
  properties: {
    name: textPlanSchema.properties.name,
    rationale: textPlanSchema.properties.rationale,
    cases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["instance_id", "name", "steps"],
        additionalProperties: false,
        properties: {
          instance_id: {
            type: "string",
            description:
              "原样使用planning_input.instances中的id；每个实例恰好规划一次",
          },
          ...textPlanSchema.properties,
        },
      },
    },
  },
};
const validateBatch = ajv.compile<{
  name: string;
  rationale?: string;
  cases: (TextPlan & { instance_id: string })[];
}>(batchTextPlanSchema);

export function parseBatchPlan(
  input: unknown,
  snapshot: TextInput,
  task: string,
  session: string,
  language = "zh",
  originalTask = task,
): TestSuite {
  if (!validateBatch(input))
    throw new Error(ajv.errorsText(validateBatch.errors));
  const ids = input.cases.map((c) => c.instance_id);
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== snapshot.instances.length ||
    snapshot.instances.some((i) => !ids.includes(i.id))
  )
    throw new Error(
      "必须为planning_input中的每个instance_id提交一次文字计划，不能遗漏、合并、重复或新增实例",
    );
  const plans = snapshot.instances.map((instance) => {
    const { instance_id: _, ...text } = input.cases.find(
      (c) => c.instance_id === instance.id,
    )!;
    const plan = parseTextPlan(
      text,
      instance.task + "\n用户补充：" + task,
      session,
      instance.task,
      language,
    );
    const c = plan.cases[0]!;
    c.case_id = instance.id;
    c.rationale = plan.planning!.rationale;
    c.datasets = [
      {
        data_id: instance.data_row ? `row_${instance.data_row}` : "default",
        inputs: { ...instance.parameters },
        expected: {},
      },
    ];
    c.steps = c.steps.map((s) => ({
      ...s,
      step_id: `${instance.id}_${s.step_id}`,
      depends_on: s.depends_on.map((id) => `${instance.id}_${id}`),
    }));
    plan.source_refs = plan.source_refs.map((source) => ({
      ...source,
      id: `${instance.id}_${source.id}`,
    }));
    return plan;
  });
  return parsePlan(
    {
      schema_version: "1",
      suite_id: "text_batch",
      name: input.name,
      planning: {
        original_task: originalTask,
        rationale:
          input.rationale ||
          (language.startsWith("zh")
            ? "按来源用例及数据行顺序逐个执行，各自核对文字预期。"
            : "Execute each source case and data row in order, checking its stated expectations."),
        input: structuredClone(snapshot),
      },
      source_refs: plans.flatMap((plan) => plan.source_refs),
      cases: plans.flatMap((plan) => plan.cases),
    },
    true,
  );
}

/** 原文使用动态围栏，避免数据中的Markdown符号改变审核层级。 */
function literalBlock(value: string): string {
  const fence = "`".repeat(
    Math.max(3, ...[...value.matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
  return `${fence}\n${value}\n${fence}`;
}
function batchReview(
  plan: TestSuite,
  review: boolean,
  language: string,
): string {
  const input = plan.planning!.input!;
  const zh = language.startsWith("zh");
  const label = (cn: string, en: string) => (zh ? cn : en);
  return [
    `# ${plan.name}`,
    label(
      review
        ? "请审核全部用例、参数与步骤；批准后执行。"
        : "文字规划已完成，通报全部用例后按顺序执行。",
      review
        ? "Review all cases, parameters and steps before approval."
        : "The text plan is ready; announce all cases before executing them in order.",
    ),
    `## ${label("原始任务", "Original task")}`,
    literalBlock(plan.planning!.original_task),
    `## ${label("拆分思路", "Approach")}`,
    plan.planning!.rationale,
    `## ${label("输入与数量", "Input and counts")}`,
    `${label("原始用例数", "Source cases")}: ${input.templates.length}; ${label("CSV数据行数", "CSV data rows")}: ${input.rows.length}; ${label("执行实例总数", "Execution instances")}: ${input.instances.length}`,
    literalBlock(
      JSON.stringify(
        {
          case_file: input.case_file?.path ?? null,
          csv_file: input.csv_file?.path ?? null,
          parameters: input.headers,
          rows: input.rows.map((values, index) => ({
            data_row: index + 1,
            values,
          })),
        },
        null,
        2,
      ),
    ),
    label(
      "文件内容以读取快照为准；修改文件后请取消并重新提交。",
      "Files use the read snapshot. Cancel and resubmit after editing a file.",
    ),
    `## ${label("原始用例与共享说明", "Source cases and context")}`,
    ...(input.context ? [literalBlock(input.context)] : []),
    ...input.templates.flatMap((t, n) => [
      `### ${label("用例", "Case")} ${n + 1} · ${label("来源行", "Source line")} ${t.line}`,
      literalBlock(t.text),
    ]),
    `## ${label("步骤清单", "Steps")}`,
    ...input.instances.flatMap((instance, n) => {
      const c = plan.cases.find((c) => c.case_id === instance.id)!;
      return [
        `### ${n + 1}. ${c.name} (${instance.id})`,
        `${label("来源用例", "Source case")}: ${instance.case_number}; ${label("数据行", "Data row")}: ${instance.data_row ?? "—"}`,
        ...(Object.keys(instance.parameters).length
          ? [literalBlock(JSON.stringify(instance.parameters, null, 2))]
          : []),
        `**${label("展开后的任务", "Expanded task")}**`,
        literalBlock(instance.task),
        `**${label("拆分思路", "Approach")}**: ${c.rationale}`,
        ...c.steps.map(
          (s, index) =>
            `${index + 1}. ${s.description}${s.checks?.length ? `\n\n   ${label("检查", "Checks")}: ${s.checks.join("；")}` : ""}`,
        ),
      ];
    }),
    label(
      "规划阶段不访问目标；具体操作与采集方式留到当前步骤执行时确定。",
      "Planning does not access the target; concrete operations and captures are determined during each step.",
    ),
  ].join("\n\n");
}

export function announcementParts(plan: TestSuite, language: string): string[] {
  const input = plan.planning?.input;
  return [
    ...(language.startsWith("zh")
      ? ["原始任务", "拆分思路", "步骤清单"]
      : ["Original task", "Approach", "Steps"]),
    plan.planning!.original_task,
    plan.planning!.rationale,
    ...plan.cases.flatMap((c) =>
      c.steps.flatMap((s) => [s.description, ...(s.checks ?? [])]),
    ),
    ...(input
      ? input.instances.flatMap((i) => [
          i.id,
          i.task,
          ...(Object.keys(i.parameters).length
            ? [JSON.stringify(i.parameters, null, 2)]
            : []),
        ])
      : []),
  ];
}

export function parseTextPlan(
  input: unknown,
  task: string,
  session: string,
  originalTask = task,
  language = "zh",
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
      planning: {
        original_task: originalTask,
        rationale:
          input.rationale?.trim() ||
          (language.startsWith("zh")
            ? "按用户描述的业务顺序逐步完成动作，再核对明确预期；具体操作在执行当前步骤时根据实际情况确定。"
            : "Follow the requested business sequence, then verify the stated expectations. Determine concrete operations from the live state of each step."),
      },
      source_refs: [
        {
          ...source,
          id: "user_task",
          locator: "用户原文及补充",
          excerpt: task,
        },
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

export function textReview(
  plan: TestSuite,
  review = true,
  language = "zh",
): string {
  if (plan.planning?.input) return batchReview(plan, review, language);
  const zh = language.startsWith("zh");
  const original =
    plan.planning?.original_task ??
    plan.source_refs.find((s) => s.id === "user_task")?.excerpt ??
    "";
  const rationale = plan.planning?.rationale ?? "";
  return (
    `# ${plan.name}\n\n` +
    (review
      ? zh
        ? "请审核以下文字计划，可要求修改；批准后执行。"
        : "Review this text plan and request changes if needed. Execution starts after approval."
      : zh
        ? "文字规划已完成，接下来按步骤执行。"
        : "The text plan is ready. Execution will proceed step by step.") +
    `\n\n## ${zh ? "原始任务" : "Original task"}\n\n${original
      .split("\n")
      .map((line) => "> " + line)
      .join(
        "\n",
      )}\n\n## ${zh ? "拆分思路" : "Approach"}\n\n${rationale}\n\n## ${zh ? "步骤清单" : "Steps"}\n\n` +
    plan.cases[0]!.steps.map(
      (s, n) =>
        `${n + 1}. ${s.description}` +
        (s.checks?.length
          ? `\n\n   ${zh ? "检查" : "Checks"}：${s.checks.join("；")}`
          : ""),
    ).join("\n\n") +
    (zh
      ? "\n\n规划阶段不访问目标。具体工具、定位和采集方式留到当前步骤执行时确定，预期以原始任务和文字检查点为准。"
      : "\n\nPlanning does not access the target. Tools, selectors and capture methods are determined during each step; expectations stay grounded in the original task and text checks.")
  );
}

/** 仅识别明确的简单数字条件，其余自然语言仍由模型理解。 */
function numericExpectation(text: string) {
  const match =
    /(不能为|不得为|不应为|不为|不等于|等于|为)\s*(-?\d+(?:\.\d+)?)\s*(?:$|[，。；])/.exec(
      text,
    );
  if (
    !match ||
    (match[1] === "为" && /不[^，。；]*$/.test(text.slice(0, match.index)))
  )
    return;
  return {
    expected: Number(match[2]),
    operator: match[1]!.startsWith("不") ? "neq" : "eq",
  };
}

/** 常见标量直接传预期原文，按明确数字条件或可信观察类型解析。 */
export function parseTextExpected(
  text: string,
  value: string,
  actual: unknown,
  operator: string,
): Json {
  if (typeof value !== "string")
    throw new Error(
      "expected_value需要预期原文，例如agent或0，不包数组或value对象",
    );
  if (operator === "range") return JSON.parse(value);
  if (numericExpectation(text) || typeof actual === "number") {
    if (!/^-?\d+(?:\.\d+)?$/.test(value.trim()))
      throw new Error("数字预期直接填写0或200，不加引号或数组包装");
    return Number(value);
  }
  if (operator === "exists" || typeof actual === "boolean") {
    if (value !== "true" && value !== "false")
      throw new Error("布尔预期直接填写true或false");
    return value === "true";
  }
  if (typeof actual === "string") return value;
  return JSON.parse(value);
}

/** 在实际绑定时核对数字条件，不在规划时生成操作参数。 */
export function validateTextExpectation(
  text: string,
  assertion: AssertionSpec,
): void {
  const numeric = numericExpectation(text);
  if (!numeric) return;
  if (
    assertion.operator !== numeric.operator ||
    assertion.literal !== numeric.expected
  )
    throw new Error(
      `文字检查明确要求${numeric.operator}数字${numeric.expected}；用number采集数值，expected_value直接填${numeric.expected}，不能换成数字字符串或按实际值修改预期`,
    );
}
