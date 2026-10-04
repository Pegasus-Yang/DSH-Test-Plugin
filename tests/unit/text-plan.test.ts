import { expect, it } from "vitest";
import {
  parseTextPlan,
  parseTextExpected,
  textReview,
  validateTextExpectation,
} from "../../src/text-plan.js";
import { aggregate, expand, parsePlan } from "../../src/contracts.js";

const input = {
  name: "搜索帖子",
  steps: [
    { description: "访问测试社区" },
    { description: "搜索agent" },
    { description: "打开第一条结果" },
    { description: "查看帖子点赞", checks: ["点赞数不为0"] },
  ],
};
it("只接受业务短句，规划不要求也不接受执行参数", () => {
  const plan = parseTextPlan(
    input,
    "访问社区搜索agent，打开第一条结果，点赞数不为0",
    "session",
  );
  expect(plan.cases[0].steps).toHaveLength(4);
  expect(plan.cases[0].steps.every((s) => !s.action && !s.assertion)).toBe(
    true,
  );
  const md = textReview(plan);
  expect(md).toContain("2. 搜索agent");
  expect(md).toContain("检查：点赞数不为0");
  expect(md).not.toContain("```json");
  expect(md).not.toContain("allowed_targets");
  expect(() =>
    parseTextPlan(
      {
        ...input,
        steps: [{ description: "访问", action: { selector: "#foo" } }],
      },
      "任务",
      "session",
    ),
  ).toThrow();
  expect(() => parsePlan(plan)).toThrow();
});
it("文字检查在运行前纳入必需集合，不能以零断言判通过", () => {
  const [run] = expand(parseTextPlan(input, "任务", "session"));
  expect(run!.effective_required_assertion_ids).toEqual(["step_4_check_1"]);
  expect(aggregate(run!)).toBe("INCONCLUSIVE");
  expect(() =>
    parseTextPlan(
      { name: "任务", steps: [{ description: "访问" }] },
      "任务",
      "session",
    ),
  ).toThrow("文字");
});

it("明确数字条件在运行时按数值校验，不能改为数字字符串或其他预期", () => {
  const a = {
    observation_ref: "step_1.likes",
    operator: "neq" as const,
    literal: 0,
    rule_ref: "r",
  };
  expect(() => validateTextExpectation("点赞数不为0", a)).not.toThrow();
  expect(() =>
    validateTextExpectation("点赞数不为0", { ...a, literal: "0" }),
  ).toThrow("数字");
  expect(() =>
    validateTextExpectation("点赞数不为0", { ...a, literal: 1 }),
  ).toThrow();
  expect(() =>
    validateTextExpectation("点赞数不为0", { ...a, operator: "eq" }),
  ).toThrow();
  expect(() =>
    validateTextExpectation('文本等于"0"', {
      ...a,
      operator: "eq",
      literal: "0",
    }),
  ).not.toThrow();
});

it("标量预期不需要JSON包装，保持字符串和数字原意", () => {
  expect(parseTextExpected("keyword为agent", "agent", "agent", "eq")).toBe(
    "agent",
  );
  expect(parseTextExpected("状态码为200", "200", 200, "eq")).toBe(200);
  expect(() =>
    parseTextExpected("状态码为200", '["200"]', 200, "eq"),
  ).toThrow();
  expect(() =>
    validateTextExpectation("点赞数不能为0", {
      observation_ref: "x.y",
      operator: "neq",
      literal: 0,
      rule_ref: "r",
    }),
  ).not.toThrow();
});

it("审核与直接执行通报都保留原始任务和简短拆分思路", () => {
  const task = "访问网站，搜索agent，查看点赞数";
  const plan = parseTextPlan(
    {
      ...input,
      rationale:
        "按访问、搜索、打开的顺序获取帖子，再核对点赞数，定位细节留到运行时。",
    },
    task + "\n补充要求：不点赞",
    "session",
    task,
  );
  const review = textReview(plan);
  expect(review).toContain("## 原始任务\n\n> " + task);
  expect(review).toContain("## 拆分思路");
  expect(review).toContain("按访问、搜索、打开的顺序");
  expect(review).toContain("## 步骤清单");
  const notice = textReview(plan, false);
  expect(notice).toContain("文字规划已完成");
  expect(notice).not.toContain("请审核");
  expect(textReview(plan, true, "en")).toContain("## Original task");
});

it("批量计划严格覆盖每个展开实例，原文参数和规则独立且审核完整", async () => {
  const { createTextInput, parseCases } = await import(
    "../../src/case-input.js"
  );
  const { parseBatchPlan, batchTextPlanSchema } = await import(
    "../../src/text-plan.js"
  );
  const source = createTextInput(
    parseCases("检查${编号}\n再次核对${编号}", ".txt"),
    { path: "data.csv", content: '编号,说明\n001,"a,b"\n002,"第一行\n第二行"' },
  );
  const draft = {
    name: "批量任务",
    cases: source.instances.map((i) => ({
      instance_id: i.id,
      name: "核对" + i.parameters.编号,
      steps: [
        { description: i.task, checks: ["编号等于" + i.parameters.编号] },
      ],
    })),
  };
  const plan = parseBatchPlan(
    draft,
    source,
    "原始命令\n补充说明",
    "session",
    "zh",
    "原始命令",
  );
  expect(plan.planning!.original_task).toBe("原始命令");
  expect(plan.cases).toHaveLength(4);
  expect(new Set(plan.source_refs.map((s) => s.id)).size).toBe(
    plan.source_refs.length,
  );
  expect(
    new Set(plan.cases.flatMap((c) => c.steps.map((s) => s.step_id))).size,
  ).toBe(4);
  const review = textReview(plan);
  expect(review).toContain("原始用例数: 2; CSV数据行数: 2; 执行实例总数: 4");
  expect(review).toContain('"001"');
  expect(review).toContain("第一行\\n第二行");
  for (const i of source.instances) expect(review).toContain(i.id);
  expect(textReview(plan, true, "en")).toContain("Execution instances: 4");
  expect(
    batchTextPlanSchema.properties.cases.items.properties,
  ).not.toHaveProperty("parameters");
  source.rows[0]!.编号 = "999";
  expect(plan.planning!.input!.rows[0]!.编号).toBe("001");
  expect(() =>
    parseBatchPlan(
      { ...draft, cases: draft.cases.slice(1) },
      source,
      "任务",
      "s",
    ),
  ).toThrow("不能遗漏");
  expect(() =>
    parseBatchPlan(
      {
        ...draft,
        cases: [draft.cases[0], draft.cases[0], ...draft.cases.slice(2)],
      },
      source,
      "任务",
      "s",
    ),
  ).toThrow("不能遗漏");
  expect(() =>
    parseBatchPlan(
      {
        ...draft,
        cases: draft.cases.map((c, n) =>
          n ? c : { ...c, instance_id: "fake" },
        ),
      },
      source,
      "任务",
      "s",
    ),
  ).toThrow("不能遗漏");
});
