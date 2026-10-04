import { expect, it } from "vitest";
import type {
  ProgressSnapshot,
  ProgressStep,
} from "../../src/progress-model.js";
import {
  focusStep,
  progressTone,
  stepRows,
} from "../../src/client/progress-view.js";

function state(count = 24): ProgressSnapshot {
  return {
    session_id: "one",
    run_id: "run-one",
    title: "测试",
    phase: "executing",
    created_at: "2026-10-04T00:00:00Z",
    server_now: "2026-10-04T00:00:10Z",
    current_instance_id: "case-one",
    current_step_id: "step-9",
    total_steps: count,
    settled_steps: 8,
    preview: { ready: false },
    instances: [
      {
        id: "case-one",
        name: "示例",
        data_id: "data-one",
        status: "RUNNING",
        setup: [],
        cleanup: [],
        steps: Array.from({ length: count }, (_, index) => ({
          id: `step-${index + 1}`,
          description: `操作 ${index + 1}`,
          status: index < 8 ? "SUCCEEDED" : index === 8 ? "RUNNING" : "PENDING",
          duration_ms: 0,
          checks: [],
        })),
      },
    ],
  };
}
it("24步与1000步仍按完整顺序定位当前步骤，不截断编号或修改快照", () => {
  for (const count of [24, 1000]) {
    const s = state(count);
    s.current_step_id = `step-${count}`;
    const before = JSON.stringify(s);
    const rows = stepRows(s);
    expect(rows).toHaveLength(count);
    expect(focusStep(s, rows)).toMatchObject({
      label: "当前步骤",
      row: { number: count, key: `case-one/step-${count}` },
    });
    expect(JSON.stringify(s)).toBe(before);
  }
});
it("多个实例复用相同步骤ID时，定位与展开身份不冲突，编号按全批次累计", () => {
  const s = state(8);
  s.instances.push({ ...s.instances[0], id: "case-two", name: "第二实例" });
  s.current_instance_id = "case-two";
  s.current_step_id = "step-1";
  s.total_steps = 16;
  const rows = stepRows(s);
  expect(new Set(rows.map((row) => row.key)).size).toBe(16);
  expect(focusStep(s)).toMatchObject({
    row: { number: 9, instance: { id: "case-two" } },
    next: { id: "step-2" },
  });
});
it("规划与审核不把未执行的第一步假称为当前运行步骤", () => {
  const s = state();
  for (const phase of ["planning", "reviewing"] as const) {
    s.phase = phase;
    expect(focusStep(s).row).toBeUndefined();
    expect(focusStep(s).step).toBeUndefined();
    expect(focusStep(s).next).toBeUndefined();
  }
});
it("0步规划和单步执行都有明确焦点，不生成不存在的下一步", () => {
  const s = state(0);
  s.phase = "planning";
  expect(stepRows(s)).toEqual([]);
  expect(focusStep(s).label).toBe("正在规划");
  const one = state(1);
  one.current_step_id = "step-1";
  expect(focusStep(one)).toMatchObject({ row: { number: 1 } });
  expect(focusStep(one).next).toBeUndefined();
});
it("准备与清理显示真实资源动作，不能冒用业务步骤编号", () => {
  const s = state();
  const resource: ProgressStep = {
    id: "reset",
    description: "创建专用浏览器",
    status: "RUNNING",
    duration_ms: 0,
    checks: [],
  };
  s.instances[0].setup = [resource];
  s.current_step_id = "reset";
  expect(focusStep(s)).toMatchObject({
    label: "环境准备",
    description: resource.description,
  });
  expect(focusStep(s).row).toBeUndefined();
  s.phase = "cleanup";
  s.instances[0].cleanup = [
    { ...resource, id: "close", description: "关闭专用浏览器" },
  ];
  s.current_step_id = "close";
  expect(focusStep(s)).toMatchObject({
    label: "资源清理",
    description: "关闭专用浏览器",
  });
  expect(focusStep(s).row).toBeUndefined();
});
it("业务通过但必要清理失败时明确显示清理异常，不展示全部通过", () => {
  const s = state();
  s.phase = "finished";
  s.instances[0].status = "ERROR";
  s.instances[0].steps.forEach((step) => (step.status = "SUCCEEDED"));
  s.instances[0].cleanup = [
    {
      id: "close",
      description: "关闭浏览器",
      status: "ERROR",
      duration_ms: 1000,
      checks: [],
    },
  ];
  expect(progressTone(s)).toBe("error");
  expect(focusStep(s)).toMatchObject({
    label: "清理异常",
    step: { id: "close", status: "ERROR" },
  });
});
it("结束后优先展示失败步骤；取消和未运行的结束记录不会成为通过状态", () => {
  const s = state();
  s.phase = "finished";
  s.instances[0].status = "FAIL";
  s.instances[0].steps[3].status = "FAIL";
  expect(focusStep(s)).toMatchObject({ label: "异常步骤", row: { number: 4 } });
  s.instances[0].status = "CANCELLED";
  expect(progressTone(s)).toBe("muted");
  s.instances = [];
  expect(progressTone(s)).toBe("muted");
});
it("中断及连接故障可见，执行阶段没有运行步骤时保持等待，不猜测首个待执行步骤", () => {
  const s = state();
  s.current_step_id = undefined;
  s.instances[0].steps.forEach((step) => (step.status = "PENDING"));
  expect(focusStep(s).label).toBe("等待下一步");
  s.phase = "interrupted";
  expect(focusStep(s).label).toBe("已中断");
  expect(progressTone(s)).toBe("error");
  expect(progressTone(state(), true)).toBe("error");
});
