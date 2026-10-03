import { expect, it } from "vitest";
import { parseTextPlan, textReview } from "../../src/text-plan.js";
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
