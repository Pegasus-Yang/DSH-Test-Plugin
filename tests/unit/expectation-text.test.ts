import { expect, it } from "vitest";
import { expectationText } from "../../src/expectation-text.js";

it.each([
  ["eq", 0, "该检查采集到的值应等于 0"],
  ["neq", 0, "该检查采集到的值应不等于 0"],
  ["contains", "a|b", "该检查采集到的文本应包含「a|b」"],
  ["text", "", "该检查采集到的文本应等于 空字符串"],
  ["visible", true, "该检查对象应在页面上可见"],
  ["visible", false, "该检查对象应在页面上不可见"],
  ["exists", true, "该检查对应的数据应存在"],
  ["exists", false, "该检查对应的数据应不存在"],
] as const)("%s 保留原检查上下文与冻结条件", (operator, value, condition) => {
  const sentence = expectationText({
    description: "检查对象。",
    operator,
    value,
  });
  expect(sentence).toBe(`检查对象；${condition}。`);
});

it("范围保留上下界、单位和零容差，不将不等于替换成大小比较", () => {
  expect(
    expectationText({
      description: "检查耗时",
      operator: "range",
      value: [1, 2],
      unit: "秒",
      tolerance: 0,
    }),
  ).toBe(
    "检查耗时；该检查采集到的值应介于 1 与 2 之间（包含边界），单位为秒，容差为 0。",
  );
  expect(
    expectationText({ description: "检查数量", operator: "neq", value: 0 }),
  ).not.toContain("大于");
});

it("无效范围使用原业务预期，不补造另一边界或有效机器规则", () => {
  expect(
    expectationText({
      description: "项目数量不少于10个",
      operator: "range",
      value: { min: 10 },
    }),
  ).toBe("项目数量不少于10个。");
  expect(
    expectationText({ description: "", operator: "range", value: { min: 10 } }),
  ).toContain('该检查采集到的值应满足 range 规则，冻结预期为 {"min":10}');
});

it("字符串换行及特殊字符保留含义，不输出 HTML 实体", () => {
  const sentence = expectationText({
    description: "检查文本",
    operator: "eq",
    value: "a\nb|<c>_*",
  });
  expect(sentence).toContain("「a\\nb|<c>_*」");
  expect(sentence).not.toContain("&#");
});
