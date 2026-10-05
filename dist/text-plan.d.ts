/** 自然语言只规划业务短句；运行时再把当前步骤绑定到执行和断言契约。 */
import { type AssertionSpec, type Json, type TestSuite } from "./contracts.js";
import type { TextInput } from "./case-input.js";
export declare const textPlanSchema: {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
        name: {
            type: string;
            minLength: number;
            description: string;
        };
        rationale: {
            type: string;
            minLength: number;
            description: string;
        };
        steps: {
            type: string;
            minItems: number;
            items: {
                type: string;
                required: string[];
                additionalProperties: boolean;
                properties: {
                    description: {
                        type: string;
                        minLength: number;
                        description: string;
                    };
                    checks: {
                        type: string;
                        items: {
                            type: string;
                            minLength: number;
                        };
                        description: string;
                    };
                };
            };
        };
    };
};
export declare const batchTextPlanSchema: {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
        name: {
            type: string;
            minLength: number;
            description: string;
        };
        rationale: {
            type: string;
            minLength: number;
            description: string;
        };
        cases: {
            type: string;
            minItems: number;
            items: {
                type: string;
                required: string[];
                additionalProperties: boolean;
                properties: {
                    name: {
                        type: string;
                        minLength: number;
                        description: string;
                    };
                    rationale: {
                        type: string;
                        minLength: number;
                        description: string;
                    };
                    steps: {
                        type: string;
                        minItems: number;
                        items: {
                            type: string;
                            required: string[];
                            additionalProperties: boolean;
                            properties: {
                                description: {
                                    type: string;
                                    minLength: number;
                                    description: string;
                                };
                                checks: {
                                    type: string;
                                    items: {
                                        type: string;
                                        minLength: number;
                                    };
                                    description: string;
                                };
                            };
                        };
                    };
                    instance_id: {
                        type: string;
                        description: string;
                    };
                };
            };
        };
    };
};
export declare function parseBatchPlan(input: unknown, snapshot: TextInput, task: string, session: string, language?: string, originalTask?: string): TestSuite;
export declare function announcementParts(plan: TestSuite, language: string): string[];
export declare function parseTextPlan(input: unknown, task: string, session: string, originalTask?: string, language?: string): TestSuite;
export declare function textReview(plan: TestSuite, review?: boolean, language?: string): string;
/** 常见标量直接传预期原文，按明确数字条件或可信观察类型解析。 */
export declare function parseTextExpected(text: string, value: string, actual: unknown, operator: string): Json;
/** 在实际绑定时核对数字条件，不在规划时生成操作参数。 */
export declare function validateTextExpectation(text: string, assertion: AssertionSpec): void;
