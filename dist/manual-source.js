/** 手工用例专用原始资料；与脱敏账本分开保存，不作为运行结果。 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { field, } from "./contracts.js";
import { operationArguments } from "./actual-operations.js";
import { atomicWrite } from "./recorder.js";
export function manualCaseSource(run) {
    const input = run.plan.planning?.input;
    return Object.fromEntries(run.instances.map((instance) => {
        const definition = run.plan.cases.find((c) => c.case_id === instance.case_id);
        const item = input?.instances.find((i) => i.id === instance.case_id);
        return [
            instance.case_run_id,
            {
                name: definition?.name ?? instance.name,
                original_case: item
                    ? (input.templates.find((t) => t.id === item.template_id)?.text ??
                        "")
                    : (run.plan.planning?.original_task ?? ""),
                preconditions: phaseDefinitions(definition?.preconditions ?? [], instance),
                cleanup: phaseDefinitions(definition?.cleanup ?? [], instance),
                checks: Object.fromEntries(instance.steps
                    .filter((s) => s.assertion)
                    .map((s) => [
                    s.step_id,
                    {
                        description: s.description,
                        operator: s.assertion.operator,
                        value: s.assertion.expected,
                    },
                ])),
            },
        ];
    }));
}
function phaseDefinitions(steps, instance) {
    return steps
        .filter((s) => !["__reset", "__close"].includes(s.step_id))
        .map((s) => {
        const assertion = s.assertion;
        const value = assertion?.expected_ref
            ? field({ data: instance.data }, assertion.expected_ref)
            : assertion?.literal;
        return {
            step_id: s.step_id,
            description: s.description,
            ...(assertion && value !== undefined
                ? { expected: { operator: assertion.operator, value: value } }
                : {}),
        };
    });
}
export class ManualSource {
    directory;
    lastSaved;
    data;
    constructor(directory, runId) {
        this.directory = directory;
        this.data = {
            schema_version: "1",
            suite_run_id: runId,
            cases: {},
            operations: {},
        };
    }
    record(operation, name, args, description) {
        this.data.operations[operation.operation_id] = {
            description,
            name,
            inputs: operationArguments(args),
        };
    }
    save(run) {
        this.data.cases = manualCaseSource(run);
        const text = JSON.stringify(this.data, null, 2) + "\n";
        if (text === this.lastSaved)
            return;
        // 不调用账本的 sanitize；用户执行手工用例需要原始业务输入。
        atomicWrite(join(this.directory, "manual-source.json"), text);
        this.lastSaved = text;
    }
}
export function readManualSource(directory, runId) {
    const path = join(directory, "manual-source.json");
    if (!existsSync(path))
        return;
    try {
        const rel = relative(realpathSync(directory), realpathSync(path));
        if (rel === ".." || rel.startsWith(".." + sep))
            throw new Error();
        const data = JSON.parse(readFileSync(path, "utf8"));
        if (data.schema_version !== "1" ||
            data.suite_run_id !== runId ||
            !data.cases ||
            Array.isArray(data.cases) ||
            typeof data.cases !== "object" ||
            !data.operations ||
            Array.isArray(data.operations) ||
            typeof data.operations !== "object" ||
            !Object.values(data.cases).every((c) => c &&
                typeof c.name === "string" &&
                typeof c.original_case === "string" &&
                [c.preconditions, c.cleanup].every((steps) => Array.isArray(steps) &&
                    steps.every((s) => s &&
                        typeof s.step_id === "string" &&
                        typeof s.description === "string" &&
                        (!s.expected ||
                            (typeof s.expected.operator === "string" &&
                                Object.hasOwn(s.expected, "value"))))) &&
                c.checks &&
                typeof c.checks === "object" &&
                !Array.isArray(c.checks) &&
                Object.values(c.checks).every((check) => check &&
                    typeof check.description === "string" &&
                    typeof check.operator === "string" &&
                    Object.hasOwn(check, "value"))) ||
            !Object.values(data.operations).every((o) => o &&
                typeof o.description === "string" &&
                typeof o.name === "string" &&
                o.inputs &&
                typeof o.inputs === "object" &&
                !Array.isArray(o.inputs)))
            throw new Error();
        return data;
    }
    catch {
        throw new Error("手工用例原始资料无效或不属于本次运行，请保留原文件后核对。");
    }
}
