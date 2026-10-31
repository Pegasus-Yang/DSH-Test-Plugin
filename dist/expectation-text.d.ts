/** 将冻结预期表达为有上下文的完整语句，不读取本次实际值。 */
import type { Json } from "./contracts.js";
export interface ExpectedDescription {
    description: string;
    operator: string;
    value: Json;
    unit?: string;
    tolerance?: number;
}
export declare const expectedValueText: (value: Json) => string;
/**
 * 保留原检查描述，并为比较条件补齐主语。
 *
 * :param expected: 检查原文及冻结的比较参数，不包含实际值。
 * :returns: 可用于报告及手工用例的完整预期语句。
 */
export declare function expectationText(expected: ExpectedDescription): string;
