/** 将冻结预期表达为有上下文的完整语句，不读取本次实际值。 */
import type { Json } from "./contracts.js";

export interface ExpectedDescription {
  description: string;
  operator: string;
  value: Json;
  unit?: string;
  tolerance?: number;
}

export const expectedValueText = (value: Json): string =>
  typeof value === "string"
    ? value === ""
      ? "空字符串"
      : `「${value.replace(/\r\n|\r|\n/g, "\\n")}」`
    : JSON.stringify(value);

/**
 * 保留原检查描述，并为比较条件补齐主语。
 *
 * :param expected: 检查原文及冻结的比较参数，不包含实际值。
 * :returns: 可用于报告及手工用例的完整预期语句。
 */
export function expectationText(expected: ExpectedDescription): string {
  const { operator, value, unit, tolerance } = expected;
  const description = expected.description.trim().replace(/[。；;]+$/, "");
  const formatted = expectedValueText(value);
  const conditions: Record<string, string> = {
    eq: `该检查采集到的值应等于 ${formatted}`,
    neq: `该检查采集到的值应不等于 ${formatted}`,
    contains: `该检查采集到的文本应包含${formatted}`,
    text: `该检查采集到的文本应等于 ${formatted}`,
    visible:
      typeof value === "boolean"
        ? `该检查对象应在页面上${value ? "可见" : "不可见"}`
        : `该检查对象的可见性应等于 ${formatted}`,
    exists:
      typeof value === "boolean"
        ? `该检查对应的数据应${value ? "存在" : "不存在"}`
        : `该检查对应数据的存在性应等于 ${formatted}`,
  };
  let condition = conditions[operator];
  if (operator === "range") {
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((bound) => typeof bound === "number")
    )
      condition = `该检查采集到的值应介于 ${value[0]} 与 ${value[1]} 之间（包含边界）${unit ? `，单位为${unit}` : ""}${tolerance !== undefined ? `，容差为 ${tolerance}` : ""}`;
    // 无效范围保留原检查文字，原始结构及异常仍在运行报告中展示。
    else if (description) return `${description}。`;
  }
  condition ??= `该检查采集到的值应满足 ${operator} 规则，冻结预期为 ${formatted}`;
  return `${description ? description + "；" : ""}${condition}。`;
}
