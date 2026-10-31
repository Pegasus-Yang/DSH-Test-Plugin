import { expect, it } from "vitest";
import { expand, type StepResult, type SuiteRun } from "../../src/contracts.js";
import { parseTextPlan } from "../../src/text-plan.js";
import { projectActualCase } from "../../src/actual-operations.js";
import { executionGroups } from "../../src/report-process.js";

function fixture() {
  const plan = parseTextPlan(
    {
      name: "分组",
      steps: [
        { description: "登录系统", checks: ["显示首页"] },
        { description: "查看项目", checks: ["项目数量不少于10个"] },
      ],
    },
    "登录后查看项目数量",
    "session",
  );
  const run: SuiteRun = {
    schema_version: "1",
    suite_run_id: "run-process",
    name: "分组",
    created_at: "2026-10-31T00:00:00Z",
    lifecycle: "FINISHED",
    plan,
    instances: expand(plan),
    evidence: [],
    incomplete: false,
    resource_quarantined: false,
    manifest: { actual_operations_schema: "1" },
  };
  const instance = run.instances[0]!;
  const step = (
    id: string,
    status: StepResult["status"] = "SUCCEEDED",
    phase: StepResult["phase"] = "test",
  ): StepResult => ({
    step_id: id,
    description: id,
    phase,
    required: true,
    status,
    started_at: run.created_at,
    duration_ms: 1,
    observations: [],
    calls: [],
  });
  const check = (
    id: string,
    rule: string,
    status: "PASS" | "ERROR" = "PASS",
  ) => {
    instance.effective_steps.push({
      step_id: id,
      kind: "assertion",
      description: id,
      required: true,
      depends_on: [],
      assertion: {
        observation_ref: "step_1.value",
        operator: "neq",
        literal: 0,
        rule_ref: rule,
      },
    });
    const result = step(id, status);
    result.assertion = {
      assertion_id: id,
      status,
      operator: "neq",
      actual: 3,
      expected: 0,
      reason: status,
      operand_snapshot: { actual_path: "step_1.value" },
      evidence_refs: [],
      plan_revision: 0,
    };
    return result;
  };
  const groups = () =>
    executionGroups(run, instance, projectActualCase(run, instance));
  return { run, instance, step, check, groups };
}

it("规划与检查按冻结来源归组，动态检查名称不同也可追溯，不修改运行事实", () => {
  const f = fixture();
  f.instance.steps = [
    f.step("step_1"),
    f.check("runtime-login-check", "step_1_check_1"),
    f.step("step_2"),
    f.check("runtime-project-check", "step_2_check_1", "ERROR"),
  ];
  const before = JSON.stringify(f.run);
  const groups = f.groups();
  expect(groups.map((group) => group.id)).toEqual(["step_1", "step_2"]);
  expect(groups[0]!.steps.map((step) => step.step_id)).toEqual([
    "step_1",
    "runtime-login-check",
  ]);
  expect(groups.map((group) => group.status)).toEqual(["PASS", "ERROR"]);
  expect(groups[1]!.needs_review).toBe(true);
  expect(JSON.stringify(f.run)).toBe(before);
});

it("相似标题和 ID 后缀不会使无来源检查被吞入其他规划", () => {
  const f = fixture();
  const unrelated = f.check("step_1_check_1_extra", "other-rule");
  unrelated.description = "登录系统";
  f.instance.steps = [f.step("step_1"), unrelated];
  expect(f.groups().map((group) => group.id)).toEqual([
    "step_1",
    "step_2",
    "step_1_check_1_extra",
  ]);
});

it("重试、未知及未派发动作全部保留，并与最终检查结果分别表达", () => {
  const f = fixture();
  const action = f.step("step_1");
  action.actual_operations = (
    ["ERROR", "SUCCEEDED", "UNKNOWN", "NOT_DISPATCHED"] as const
  ).map((state, n) => ({
    operation_id: `op-${n}`,
    order_in_step: n + 1,
    binding: {
      suite_run_id: f.run.suite_run_id,
      case_run_id: f.instance.case_run_id,
      phase: "test",
      step_id: "step_1",
      attempt_id: "1",
    },
    description: "登录",
    description_source: "model",
    parent_call_id: `parent-${n}`,
    tool_call_id: `tool-${n}`,
    granularity: "atomic",
    state,
    dispatch_observed: state !== "NOT_DISPATCHED",
    created_at: f.run.created_at,
  }));
  f.instance.steps = [action, f.check("login-check", "step_1_check_1")];
  const group = f.groups()[0]!;
  expect(group.rows.map((row) => row.state)).toEqual([
    "ERROR",
    "SUCCEEDED",
    "UNKNOWN",
    "PASS",
    "NOT_DISPATCHED",
  ]);
  expect(group.rows.map((row) => row.id)).toEqual([
    "op-0",
    "op-1",
    "op-2",
    "login-check",
    "op-3",
  ]);
  expect(group.status).toBe("PASS");
  expect(group.needs_review).toBe(true);
});

it("动作完成但原检查未执行时不能给业务组显示通过", () => {
  const f = fixture();
  f.instance.steps = [f.step("step_1")];
  expect(f.groups()[0]).toMatchObject({ status: "PENDING", rows: [] });
  expect(f.groups()[1]).toMatchObject({ status: "PENDING", steps: [] });
});

it("历史无实际动作时仍保留运行依据，系统清理与业务分开", () => {
  const f = fixture();
  f.run.manifest = {};
  f.instance.steps = [
    f.step("step_1"),
    f.step("__close", "SUCCEEDED", "cleanup"),
  ];
  const groups = f.groups();
  expect(groups[0]!.rows).toEqual([]);
  expect(groups[0]!.steps).toHaveLength(1);
  expect(groups.find((group) => group.id === "__close")).toMatchObject({
    system: true,
    phase: "cleanup",
    status: "SUCCEEDED",
  });
  expect(groups.filter((group) => !group.system)).toHaveLength(2);
});

it("规则相同但阶段不同的检查仍按真实阶段单独保留", () => {
  const f = fixture();
  const check = f.check("cleanup-check", "step_1_check_1");
  check.phase = "cleanup";
  f.instance.steps = [check];
  expect(f.groups().at(-1)).toMatchObject({
    id: "cleanup-check",
    phase: "cleanup",
  });
  expect(f.groups()[0]!.steps).toEqual([]);
});
