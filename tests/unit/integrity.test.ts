import { it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sample } from "../fixtures/plan.js";
import {
  parsePlan,
  expand,
  aggregate,
  type SuiteRun,
  type StepResult,
} from "../../src/contracts.js";
import { evaluate } from "../../src/assertions.js";
import { Recorder, rebuild } from "../../src/recorder.js";
import { applyRevision } from "../../src/revisions.js";
const fixture = () => {
  const plan = parsePlan(sample());
  const run: SuiteRun = {
    schema_version: "1",
    suite_run_id: "run",
    name: "test",
    created_at: "now",
    lifecycle: "RUNNING",
    plan,
    instances: expand(plan),
    evidence: [],
    incomplete: false,
    resource_quarantined: false,
    manifest: {},
  };
  const recorder = new Recorder(
    mkdtempSync(join(tmpdir(), "integrity-")),
    "run",
  );
  return { run, recorder };
};
const observe = (run: SuiteRun) => {
  const i = run.instances[0];
  const s: StepResult = {
    step_id: "read",
    phase: "test",
    description: "读取",
    required: true,
    status: "SUCCEEDED",
    started_at: "now",
    duration_ms: 0,
    calls: [],
    observations: [
      {
        observation_id: "o",
        binding: {
          suite_run_id: "run",
          case_run_id: i.case_run_id,
          phase: "test",
          step_id: "read",
          attempt_id: "1",
        },
        producer: { call_id: "c", adapter: "fixture", field: "likes" },
        context_id: "ctx",
        output_name: "likes",
        value: 3,
        evidence_refs: [],
        observed_at: "now",
      },
    ],
  };
  i.steps.push(s);
  return s;
};
it("default数据行不会丢失", () => {
  const p = sample();
  p.cases[0].datasets = [];
  p.cases[0].steps[1].assertion = {
    observation_ref: "read.likes",
    operator: "neq",
    literal: 0,
    rule_ref: "r",
  } as never;
  expect(expand(parsePlan(p))[0].data_id).toBe("default");
});
it.each(["duplicate", "case", "context"])("拒绝非法观察 %s", (mode) => {
  const { run } = fixture();
  const s = observe(run);
  if (mode === "duplicate")
    s.observations.push(structuredClone(s.observations[0]));
  if (mode === "case") s.observations[0].binding.case_run_id = "other";
  if (mode === "context") run.instances[0].session_id = "new-context";
  expect(evaluate(run.plan.cases[0].steps[1], run.instances[0]).status).toBe(
    "ERROR",
  );
});
it("断言快照不跟随后续实际观察变化", () => {
  const { run } = fixture();
  const s = observe(run);
  const result = evaluate(run.plan.cases[0].steps[1], run.instances[0]);
  s.observations[0].value = 0;
  expect(result.actual).toBe(3);
  expect(result.status).toBe("PASS");
});
it("适用必要清理失败遮蔽主状态但保留原FAIL", () => {
  const { run } = fixture();
  const s = observe(run);
  s.observations[0].value = 0;
  const a = evaluate(run.plan.cases[0].steps[1], run.instances[0]);
  run.instances[0].steps.push(
    { ...s, step_id: "check", observations: [], status: "FAIL", assertion: a },
    {
      ...s,
      step_id: "cleanup",
      phase: "cleanup",
      status: "ERROR",
      cleanup_applicable: true,
    },
  );
  expect(aggregate(run.instances[0])).toBe("ERROR");
  expect(a.status).toBe("FAIL");
});
it("修订应用记录缺失即使最终快照PASS也必须ERROR", () => {
  const { run, recorder } = fixture();
  run.instances[0].applied_revisions = [0, 1];
  run.instances[0].status = "PASS";
  run.instances[0].lifecycle = "FINISHED";
  run.lifecycle = "FINISHED";
  recorder.snapshot(run);
  const restored = rebuild(recorder.directory);
  expect(restored.incomplete).toBe(true);
  expect(restored.instances[0].status).toBe("ERROR");
});
it("在途派发后中断恢复隔离而不重放", () => {
  const { run, recorder } = fixture();
  recorder.snapshot(run);
  recorder.event(
    "tool_bound",
    { call_id: "never" },
    {
      suite_run_id: "run",
      case_run_id: run.instances[0].case_run_id,
      phase: "test",
      step_id: "read",
      attempt_id: "1",
    },
  );
  const restored = rebuild(recorder.directory);
  expect(restored.resource_quarantined).toBe(true);
  expect(restored.instances[0].unsettled_call_ids).toEqual(["never"]);
});
it("修订不能包括已终结实例或引入新来源", () => {
  const { run, recorder } = fixture();
  const proposal = {
    reason: "明确规则",
    source_refs: run.plan.source_refs,
    added_steps: [{ ...run.plan.cases[0].steps[1], step_id: "new" }],
    target_instance_ids: [run.instances[0].case_run_id],
    insertion_boundary: "end",
    post_hoc: false,
  };
  run.instances[0].lifecycle = "FINISHED";
  expect(() => applyRevision(run, recorder, proposal, 10)).toThrow("终结");
  run.instances[0].lifecycle = "CREATED";
  proposal.source_refs = [{ ...run.plan.source_refs[0], excerpt: "模型猜测" }];
  expect(() => applyRevision(run, recorder, proposal, 10)).toThrow("来源");
});
it("账本拒写后保持失败状态", () => {
  const { recorder } = fixture();
  writeFileSync(join(recorder.directory, "events.jsonl"), "");
  recorder.failed = new Error("模拟磁盘故障");
  expect(() => recorder.event("must_not_dispatch", {})).toThrow("磁盘");
  expect(readFileSync(join(recorder.directory, "events.jsonl"), "utf8")).toBe(
    "",
  );
});
