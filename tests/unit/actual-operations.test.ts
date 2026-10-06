import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
import { ManualSource, readManualSource } from "../../src/manual-source.js";
import { createTextInput } from "../../src/case-input.js";
import { writeReport } from "../../src/report.js";
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
  expect(manualCasesMarkdown(run)).not.toContain("| 1 |");
});

it("Markdown转义特殊字符，原与只读重建导出一致且不覆盖原文件", async () => {
  const { run, i, step } = fixture();
  const root = mkdtempSync(join(tmpdir(), "manual-case-"));
  roots.push(root);
  const recorder = new Recorder(root, run.suite_run_id);
  recorder.protect({ password: "secret-pass" });
  step.calls[0]!.name = "mcp__playwright__browser_run_code";
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
  expect(markdown).toContain("\\|");
  expect(markdown).not.toMatch(/&#\d+;/);
  expect(markdown).not.toContain("<br>");
  expect(markdown).toContain("**关键词**");
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

it("手工用例只含五部分和三列，成功动作合并真实输入，无预期留空", () => {
  const { run, step } = fixture();
  run.plan.planning = {
    original_task: "搜索 qa_user_1，确认点赞数不为0",
    rationale: "拆解依据不能进入原始用例",
  };
  step.actual_operations![0]!.state = "ERROR";
  step.actual_operations![0]!.description = "失败尝试，不应要求执行人重做";
  step.calls[1]!.args_redacted = {
    element: "搜索框",
    ref: "e10",
    text: "qa_user_1",
  };
  const md = manualCasesMarkdown(run);
  expect(md.match(/^#+ .+$/gm)).toEqual([
    "# 用例名称：测试",
    "## 原始用例",
    "## 前置用例",
    "## 实际步骤",
    "## 收尾",
  ]);
  expect(md.match(/^\| 序号 \| 操作步骤 \| 预期结果 \|$/gm)).toHaveLength(3);
  expect(md).toContain("| 1 | 在搜索框中输入「qa_user_1」 |  |");
  expect(md).toContain("| 2 | 核对点赞不为0 | 不等于 0 |");
  for (const text of [
    "本次状态",
    "完整性",
    "实际输入",
    "来源规划",
    "本次记录",
    "测试数据",
    "原规划",
    "run-one",
    "失败尝试",
    "拆解依据",
    "&#95;",
  ])
    expect(md).not.toContain(text);
  expect(md).toContain(run.plan.planning.original_task);
});

it("JSON 没有原始文字描述时留空，不使用套件名或任务包装", () => {
  const { run } = fixture();
  run.name = "系统自动拼出的执行说明";
  expect(manualCasesMarkdown(run)).toContain("## 原始用例\n\n\n\n## 前置用例");
  expect(manualCasesMarkdown(run)).not.toContain(run.name);
});

it("CSV 原始用例保留用户模板，不混入背景、替换后的任务或参数快照", () => {
  const { run, i } = fixture();
  const input = createTextInput(
    {
      context: "全局背景",
      templates: [{ id: "t", text: "输入 ${keyword} 并检查结果", line: 1 }],
    },
    { path: "data.csv", content: "keyword\nagent\n" },
  );
  i.case_id = input.instances[0]!.id;
  run.plan.cases[0]!.case_id = i.case_id;
  run.plan.planning = {
    original_task: "参数化运行的系统包装",
    rationale: "分析",
    input,
  };
  const md = manualCasesMarkdown(run);
  expect(md).toContain("## 原始用例\n\n输入 ${keyword} 并检查结果\n");
  expect(md).not.toContain("全局背景");
  expect(md).not.toContain("参数化运行的系统包装");
});

it("原始手工资料保留输入和地址，审计仍脱敏，重建及单例下载一致", async () => {
  const { run, i, step } = fixture();
  const root = mkdtempSync(join(tmpdir(), "manual-original-"));
  roots.push(root);
  const recorder = new Recorder(root, run.suite_run_id);
  const password = "manual-test-only-password",
    url = "http://example.test/sign_in?token=manual_test_token";
  recorder.protect({ password });
  run.plan.planning = {
    original_task: "访问 " + url + "，登录并检查",
    rationale: "原文与规划分开",
  };
  step.calls[0]!.args_redacted = {
    element: "密码框",
    ref: "e1",
    text: password,
  };
  step.calls[1]!.name = "mcp__playwright__browser_navigate";
  step.calls[1]!.args_redacted = { url };
  const source = new ManualSource(recorder.directory, run.suite_run_id);
  for (const op of step.actual_operations!) {
    const call = step.calls.find((c) => c.call_id === op.tool_call_id)!;
    source.record(op, call.name, call.args_redacted, op.description);
  }
  source.save(run);
  recorder.snapshot(run);
  const safe = recorder.sanitize(run) as unknown as SuiteRun;
  writeManualCases(recorder.directory, safe);
  writeReport(recorder.directory, safe);
  const md = readFileSync(join(recorder.directory, "manual-cases.md"), "utf8");
  expect(md).toContain(`在密码框中输入「${password}」`);
  expect(md).toContain(`访问 ${url}`);
  expect(md).not.toContain("[已脱敏]");
  expect(md).not.toMatch(/&#\d+;/);
  expect(
    readFileSync(join(recorder.directory, "manual-cases-1.md"), "utf8"),
  ).toBe(md);
  for (const name of [
    "manual-source.json",
    "manual-cases.md",
    "manual-cases-1.md",
  ])
    expect(statSync(join(recorder.directory, name)).mode & 0o777).toBe(0o600);
  for (const name of [
    "events.jsonl",
    "results.json",
    "actual-steps.json",
    "report.html",
  ])
    expect(readFileSync(join(recorder.directory, name), "utf8")).not.toContain(
      password,
    );
  const html = readFileSync(join(recorder.directory, "report.html"), "utf8");
  expect(html).toContain('href="manual-cases-1.md?download=1"');
  const downloads = JSON.parse(
    /id="report-data">([^<]+)/.exec(html)![1]!,
  ).downloads;
  for (const data of Object.values(downloads) as { base64: string }[])
    expect(Buffer.from(data.base64, "base64").toString()).not.toContain(
      password,
    );
  writeManualCases(recorder.directory, await rebuild(recorder.directory), true);
  expect(
    readFileSync(join(recorder.directory, "manual-cases-rebuilt.md"), "utf8"),
  ).toBe(md);
  expect(
    readFileSync(join(recorder.directory, "manual-cases-1-rebuilt.md"), "utf8"),
  ).toBe(md);
  expect(i.status).toBe("PASS");
});

it("前置与收尾按原定义排序、分别编号，声明的预期保留", () => {
  const { run } = fixture();
  run.plan.cases[0]!.preconditions = [
    {
      step_id: "condition",
      kind: "assertion",
      description: "确认账号可用",
      required: true,
      depends_on: [],
      assertion: {
        observation_ref: "read.likes",
        operator: "eq",
        literal: 0,
        rule_ref: "r",
      },
    },
  ];
  run.plan.cases[0]!.cleanup = [
    {
      step_id: "close",
      kind: "intent",
      description: "退出登录",
      required: true,
      depends_on: [],
    },
  ];
  const md = manualCasesMarkdown(run);
  expect(md).toContain(
    "## 前置用例\n\n| 序号 | 操作步骤 | 预期结果 |\n| --- | --- | --- |\n| 1 | 确认账号可用 | 等于 0 |",
  );
  expect(md).toContain("| 1 | 退出登录 |  |");
});

it("损坏或其他运行的原始手工资料明确报错，不猜测还原", () => {
  const { run } = fixture();
  const root = mkdtempSync(join(tmpdir(), "manual-invalid-"));
  roots.push(root);
  writeFileSync(join(root, "manual-source.json"), "{invalid");
  expect(() => readManualSource(root, run.suite_run_id)).toThrow(
    "原始资料无效",
  );
  writeFileSync(
    join(root, "manual-source.json"),
    JSON.stringify({
      schema_version: "1",
      suite_run_id: "another",
      cases: {},
      operations: {},
    }),
  );
  expect(() => readManualSource(root, run.suite_run_id)).toThrow(
    "不属于本次运行",
  );
});
