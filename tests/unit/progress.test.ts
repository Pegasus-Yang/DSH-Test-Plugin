import { expect, it } from "vitest";
import { expand, parsePlan, type SuiteRun } from "../../src/contracts.js";
import { projectProgress } from "../../src/progress-model.js";
import { sample } from "../fixtures/plan.js";

function run(): SuiteRun {
  const plan = parsePlan(sample());
  return {
    schema_version: "1",
    suite_run_id: "run-progress",
    name: plan.name,
    created_at: "2026-10-04T00:00:00.000Z",
    lifecycle: "RUNNING",
    plan,
    instances: expand(plan),
    evidence: [],
    incomplete: false,
    resource_quarantined: false,
    manifest: { origin_session_id: "session-one" },
  };
}
it("规划草案保持稳定节点身份，不将未批准步骤显示为运行中", () => {
  const value = run();
  value.instances = [];
  const before = projectProgress({ run: value, phase: "reviewing", now: 1000 });
  const after = projectProgress({ run: value, phase: "reviewing", now: 2000 });
  expect(before.instances[0]?.id).toBe(after.instances[0]?.id);
  expect(before.instances[0]?.steps.map((step) => step.status)).toEqual([
    "PENDING",
    "PENDING",
  ]);
  expect(before).toMatchObject({
    phase: "reviewing",
    settled_steps: 0,
    total_steps: 2,
  });
});
it("准备与清理不计入业务步骤，调用参数和原始观察不进入展示快照", () => {
  const value = run();
  value.instances[0]!.data.inputs.password = "secret-value";
  value.instances[0]!.steps.push({
    step_id: "__reset",
    phase: "setup",
    description: "初始化",
    required: true,
    status: "SUCCEEDED",
    started_at: value.created_at,
    finished_at: "2026-10-04T00:00:01.000Z",
    duration_ms: 1000,
    calls: [],
    observations: [],
  });
  const state = projectProgress({ run: value, phase: "executing" });
  expect(state.total_steps).toBe(2);
  expect(state.settled_steps).toBe(0);
  expect(state.instances[0]?.setup[0]).toMatchObject({
    id: "__reset",
    duration_ms: 1000,
  });
  expect(JSON.stringify(state)).not.toContain("secret-value");
});
it("业务动作成功但文字检查失败时图中显示失败，检查点不增加业务步骤数", () => {
  const value = run();
  const parent = { ...value.plan.cases[0]!.steps[0]!, checks: ["点赞不为0"] };
  value.plan.cases[0]!.steps = [parent];
  value.instances[0]!.effective_steps = [
    parent,
    {
      ...value.plan.cases[0]!.steps[0]!,
      step_id: "read_check_1",
      kind: "assertion",
      checks: undefined,
    },
  ];
  value.instances[0]!.steps = [
    {
      step_id: "read",
      phase: "test",
      description: "读取",
      required: true,
      status: "SUCCEEDED",
      started_at: value.created_at,
      finished_at: "2026-10-04T00:00:02.000Z",
      duration_ms: 2000,
      calls: [],
      observations: [],
    },
    {
      step_id: "read_check_1",
      phase: "test",
      description: "检查",
      required: true,
      status: "FAIL",
      started_at: value.created_at,
      finished_at: "2026-10-04T00:00:02.000Z",
      duration_ms: 0,
      calls: [],
      observations: [],
    },
  ];
  const state = projectProgress({ run: value, phase: "executing" });
  expect(state).toMatchObject({ total_steps: 1, settled_steps: 1 });
  expect(state.instances[0]?.steps[0]).toMatchObject({
    status: "FAIL",
    checks: [{ status: "FAIL" }],
  });
  expect(value.instances[0]!.steps[0]!.status).toBe("SUCCEEDED");
});
it("结算后保留真实结束时间与报告，后续读取不会继续增加步骤耗时", () => {
  const value = run();
  value.lifecycle = "FINISHED";
  value.finished_at = "2026-10-04T00:00:08.000Z";
  const state = projectProgress({
    run: value,
    phase: "cleanup",
    now: Date.parse("2026-10-04T01:00:00Z"),
    reportUrl: "/report",
  });
  expect(state).toMatchObject({
    phase: "finished",
    finished_at: value.finished_at,
    report_url: "/report",
    preview: { ready: false },
  });
});
