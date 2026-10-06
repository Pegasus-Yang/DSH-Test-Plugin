import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expand,
  parsePlan,
  type ActualOperation,
  type Binding,
  type StepResult,
  type SuiteRun,
} from "../../src/contracts.js";
import {
  projectActualCase,
  operationTool,
  compositeOperation,
} from "../../src/actual-operations.js";
import {
  actualStepsDocument,
  manualCasesMarkdown,
  writeManualCases,
} from "../../src/manual-case.js";
import { Recorder, rebuild } from "../../src/recorder.js";
import { sample } from "../fixtures/plan.js";

const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
function fixture() {
  const plan = parsePlan(sample());
  const run: SuiteRun = {
    schema_version: "1",
    suite_run_id: "run-actual",
    name: "搜索用例",
    created_at: "2026-10-06T00:00:00Z",
    lifecycle: "FINISHED",
    plan,
    instances: expand(plan),
    evidence: [],
    incomplete: false,
    resource_quarantined: false,
    manifest: { actual_operations_schema: "1" },
  };
  const i = run.instances[0]!;
  i.status = "PASS";
  i.lifecycle = "FINISHED";
  const binding: Binding = {
    suite_run_id: run.suite_run_id,
    case_run_id: i.case_run_id,
    phase: "test",
    step_id: "read",
    attempt_id: "1",
  };
  const op = (id: string): ActualOperation => ({
    operation_id: id,
    order_in_step: Number(id.at(-1)),
    binding: { ...binding },
    description: "输入搜索关键字",
    description_source: "model",
    parent_call_id: "parent-" + id,
    tool_call_id: "child-" + id,
    granularity: "atomic",
    dispatch_observed: true,
    state: "SUCCEEDED",
    created_at: run.created_at,
  });
  const step: StepResult = {
    step_id: "read",
    description: "搜索 agent",
    phase: "test",
    required: true,
    status: "SUCCEEDED",
    started_at: run.created_at,
    duration_ms: 1,
    observations: [],
    actual_operations: [op("op1"), op("op2")],
    calls: [1, 2].map((n) => ({
      call_id: "child-op" + n,
      name: "mcp__playwright__browser_type",
      binding,
      args_redacted: { element: "搜索框", ref: "e10", text: "agent" },
      started_at: run.created_at,
      body_started: "unknown",
    })),
  };
  i.steps = [
    step,
    {
      ...step,
      step_id: "check",
      description: "核对点赞不为0",
      actual_operations: [],
      calls: [],
      assertion: {
        assertion_id: "check",
        status: "PASS",
        operator: "neq",
        expected: 0,
        actual: 3,
        reason: "符合",
        operand_snapshot: { actual_path: "read.likes" },
        evidence_refs: [],
        plan_revision: 0,
      },
    },
  ];
  return { run, i, step, op, binding };
}

it("按实例连续编号，保留同名重试与原位置检查；输入及预期各自来自调用和断言", () => {
  const { run, i, step } = fixture();
  step.actual_operations![0]!.state = "ERROR";
  step.actual_operations![0]!.description = "输入的是 python";
  const c = projectActualCase(run, i);
  expect(c.steps.map((r) => r.number)).toEqual([1, 2, 3]);
  expect(c.steps.map((r) => r.state)).toEqual(["ERROR", "SUCCEEDED", "PASS"]);
  expect(c.steps[0]!.inputs).toEqual({ element: "搜索框", text: "agent" });
  expect(c.steps[0]!.expected).toContain("待补充");
  expect(c.steps[2]!.expected).toMatchObject({
    operator: "neq",
    value: 0,
    rule_ref: "r",
  });
  expect(c.call_records[0]!.args_redacted).toHaveProperty("ref", "e10");
  expect(c.completeness).toBe("COMPLETE");
  expect(c.needs_review).toBe(true);
  const other = structuredClone(i);
  other.case_run_id = "other--row2";
  other.steps[0]!.actual_operations!.forEach((o) => {
    o.binding.case_run_id = other.case_run_id;
  });
  other.steps[0]!.calls.forEach((c) => {
    (c.args_redacted as any).text = "testing";
  });
  run.instances.push(other);
  const doc = actualStepsDocument(run);
  expect(doc.cases[1]!.steps[0]!.number).toBe(1);
  expect(doc.cases[1]!.steps[0]!.inputs.text).toBe("testing");
  expect(doc.cases[0]!.steps[0]!.inputs.text).toBe("agent");
});

it("未派发不占编号，准备与业务清理另列，自动复位关闭不成为手工操作", () => {
  const { run, i, step } = fixture();
  step.actual_operations![0]!.state = "NOT_DISPATCHED";
  step.actual_operations![0]!.dispatch_observed = false;
  for (const [id, phase] of [
    ["prepare", "setup"],
    ["cleanup-user", "cleanup"],
    ["__reset", "setup"],
    ["__close", "cleanup"],
  ] as const) {
    const s = structuredClone(step);
    s.step_id = id;
    s.phase = phase;
    s.actual_operations = [s.actual_operations![1]!];
    s.actual_operations[0]!.binding = {
      ...s.actual_operations[0]!.binding,
      step_id: id,
      phase,
    };
    i.steps.push(s);
  }
  const c = projectActualCase(run, i);
  expect(c.steps.map((r) => r.number)).toEqual([1, 2]);
  expect(c.not_dispatched).toHaveLength(1);
  expect(c.not_dispatched[0]!.number).toBeUndefined();
  expect(c.preconditions.recorded).toHaveLength(1);
  expect(c.cleanup.recorded).toHaveLength(1);
  expect(JSON.stringify(c.steps)).not.toContain("__close");
});

it("未知、复合、错误归属与旧记录不伪装成完整说明", () => {
  const { run, i, step } = fixture();
  step.actual_operations![0]!.granularity = "composite";
  step.actual_operations![1]!.state = "UNKNOWN";
  expect(projectActualCase(run, i).completeness).toBe("PARTIAL");
  step.actual_operations![0]!.binding.case_run_id = "foreign";
  expect(projectActualCase(run, i).steps).toHaveLength(2);
  delete run.manifest.actual_operations_schema;
  delete step.actual_operations;
  const c = projectActualCase(run, i);
  expect(c.completeness).toBe("NOT_RECORDED");
  expect(c.steps).toEqual([]);
  expect(manualCasesMarkdown(run)).toContain("不根据旧调用事后补写");
});

it("Markdown转义特殊字符，原与只读重建导出一致且不覆盖原文件", async () => {
  const { run, i, step } = fixture();
  const root = mkdtempSync(join(tmpdir(), "manual-case-"));
  roots.push(root);
  const recorder = new Recorder(root, run.suite_run_id);
  recorder.protect({ password: "secret-pass" });
  step.actual_operations![0]!.description =
    "输入 secret-pass | <script>\n**关键词**";
  const safe = recorder.sanitize(run) as unknown as SuiteRun;
  recorder.snapshot(safe);
  writeManualCases(recorder.directory, safe);
  const json = readFileSync(
    join(recorder.directory, "actual-steps.json"),
    "utf8",
  );
  const markdown = readFileSync(
    join(recorder.directory, "manual-cases.md"),
    "utf8",
  );
  expect(markdown).not.toContain("secret-pass");
  expect(markdown).not.toContain("<script>");
  expect(markdown).toContain("&#124;");
  expect(markdown).toContain("<br>");
  expect(markdown).toContain("&#42;&#42;");
  const regenerated = await rebuild(recorder.directory);
  writeManualCases(recorder.directory, regenerated, true);
  expect(
    readFileSync(join(recorder.directory, "actual-steps-rebuilt.json"), "utf8"),
  ).toBe(json);
  expect(
    readFileSync(join(recorder.directory, "manual-cases-rebuilt.md"), "utf8"),
  ).toBe(markdown);
  expect(projectActualCase(safe, i).steps[0]!.number).toBe(1);
  expect(() => parsePlan(JSON.parse(json))).toThrow();
});

it("中断重建封存未知结果，并保留快照后已保存的派发事件", async () => {
  const { run, step } = fixture();
  const root = mkdtempSync(join(tmpdir(), "operation-crash-"));
  roots.push(root);
  const recorder = new Recorder(root, run.suite_run_id);
  run.lifecycle = "RUNNING";
  step.actual_operations![0]!.state = "REGISTERED";
  step.actual_operations![0]!.dispatch_observed = false;
  recorder.snapshot(run);
  const dispatched = {
    ...step.actual_operations![0]!,
    state: "DISPATCHED",
    dispatch_observed: true,
  };
  recorder.event("operation_dispatched", dispatched, dispatched.binding);
  const rebuilt = await rebuild(recorder.directory);
  const op = rebuilt.instances[0]!.steps[0]!.actual_operations![0]!;
  expect(op.state).toBe("UNKNOWN");
  expect(op.dispatch_observed).toBe(true);
  expect(projectActualCase(rebuilt, rebuilt.instances[0]!).completeness).toBe(
    "PARTIAL",
  );
});

it("入口识别浏览器业务操作，复合填表和输入提交必须提示复核", () => {
  expect(operationTool("test_api_get")).toBe(false);
  expect(operationTool("mcp__playwright__browser_snapshot")).toBe(false);
  expect(
    operationTool("mcp__playwright__browser_tabs", { action: "list" }),
  ).toBe(false);
  expect(operationTool("mcp__playwright__browser_click")).toBe(true);
  expect(
    compositeOperation("mcp__playwright__browser_type", { submit: true }),
  ).toBe(true);
  expect(
    compositeOperation("mcp__playwright__browser_fill_form", { fields: [] }),
  ).toBe(true);
});
it("复合表单的短期ref只留在调用依据，不成为手工输入", () => {
  const { run, i, step } = fixture();
  step.calls[0]!.args_redacted = {
    fields: [{ name: "用户名", ref: "e12", value: "agent" }],
  };
  expect(projectActualCase(run, i).steps[0]!.inputs).toEqual({
    fields: [{ name: "用户名", value: "agent" }],
  });
  expect(
    projectActualCase(run, i).call_records[0]!.args_redacted,
  ).toHaveProperty("fields.0.ref", "e12");
});
