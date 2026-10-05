/** 确定性断言，仅消费绑定输出，不接受模型填写结果。 */
import { isDeepStrictEqual } from "node:util";
import { field, } from "./contracts.js";
function operand(run, ref) {
    const [step, output, ...parts] = ref.split(".");
    const producers = run.steps.filter((s) => s.step_id === step);
    const observations = producers.flatMap((s) => s.observations.filter((o) => o.output_name === output));
    if (producers.length > 1 || observations.length > 1)
        return { value: undefined, invalid: "观察输出槽不唯一" };
    const observation = observations[0];
    if (observation &&
        (observation.binding.case_run_id !== run.case_run_id ||
            observation.binding.step_id !== step ||
            observation.binding.phase !== producers[0].phase ||
            (run.session_id &&
                observation.context_id !== run.session_id &&
                observation.context_id !== run.cleanup_session_id)))
        return { value: undefined, invalid: "观察来自其他实例、步骤或上下文" };
    return {
        value: observation ? field(observation.value, parts.join(".")) : undefined,
        observation,
    };
}
export function evaluate(step, run) {
    const a = step.assertion;
    const actual = operand(run, a.observation_ref);
    const expected = a.expected_observation_ref
        ? operand(run, a.expected_observation_ref)
        : {
            value: a.expected_ref
                ? field({ data: run.data }, a.expected_ref)
                : a.literal,
            observation: undefined,
        };
    const result = {
        assertion_id: step.step_id,
        status: "INCONCLUSIVE",
        operator: a.operator,
        expected: (expected.value ?? null),
        actual: (actual.value ?? null),
        reason: "缺少可信观察",
        operand_snapshot: {
            actual_path: a.observation_ref,
            ...((a.expected_observation_ref ?? a.expected_ref)
                ? { expected_path: a.expected_observation_ref ?? a.expected_ref }
                : {}),
            ...(actual.observation
                ? { actual_observation_id: actual.observation.observation_id }
                : {}),
            ...(expected.observation
                ? { expected_observation_id: expected.observation.observation_id }
                : {}),
        },
        evidence_refs: [
            ...(actual.observation?.evidence_refs ?? []),
            ...(expected.observation?.evidence_refs ?? []),
        ],
        plan_revision: run.applied_revisions.at(-1),
    };
    if (actual.invalid || ("invalid" in expected && expected.invalid)) {
        result.status = "ERROR";
        result.reason = actual.invalid || String(expected.invalid);
        return result;
    }
    if (!actual.observation ||
        expected.value === undefined ||
        (a.expected_observation_ref && !expected.observation))
        return result;
    if (a.operator !== "exists" && actual.value === undefined)
        return result;
    let pass;
    switch (a.operator) {
        case "eq":
        case "text":
        case "visible":
            pass = isDeepStrictEqual(actual.value, expected.value);
            break;
        case "neq":
            pass =
                typeof actual.value === typeof expected.value &&
                    !isDeepStrictEqual(actual.value, expected.value);
            break;
        case "contains":
            if (typeof actual.value !== "string" ||
                typeof expected.value !== "string") {
                result.status = "ERROR";
                result.reason = "contains需要字符串";
                return result;
            }
            pass = actual.value.includes(expected.value);
            break;
        case "exists":
            if (typeof expected.value !== "boolean") {
                result.status = "ERROR";
                result.reason = "exists预期必须为布尔值";
                return result;
            }
            pass = (actual.value !== undefined) === expected.value;
            break;
        case "range": {
            const bounds = expected.value;
            if (typeof actual.value !== "number" ||
                !Array.isArray(bounds) ||
                bounds.length !== 2 ||
                !bounds.every((n) => typeof n === "number") ||
                !a.unit ||
                a.tolerance === undefined) {
                result.status = "ERROR";
                result.reason = "range需要数字、上下界、单位和容差";
                return result;
            }
            pass =
                actual.value >= Number(bounds[0]) - a.tolerance &&
                    actual.value <= Number(bounds[1]) + a.tolerance;
            break;
        }
    }
    result.status = pass ? "PASS" : "FAIL";
    result.reason = pass ? "实际值符合冻结预期" : "实际值与冻结预期不符";
    return result;
}
