import { describe, it, expect } from "vitest";
import { parsePlan, expand, aggregate } from "../../src/contracts.js";
import { evaluate } from "../../src/assertions.js";
import { Recorder, rebuild, safePath } from "../../src/recorder.js";
import {
  mkdtempSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sample } from "../fixtures/plan.js";
describe("计划与确定性判定", () => {
  it("每行恰生成一例", () => {
    const plan = sample();
    plan.cases[0].datasets.push({
      data_id: "b",
      inputs: {},
      expected: { likes: 0 },
    });
    expect(expand(parsePlan(plan))).toHaveLength(2);
  });
  it.each(["duplicate", "missing", "optional", "zero", "forward"])(
    "拒绝非法计划 %s",
    (mode) => {
      const p = sample();
      const c = p.cases[0];
      if (mode === "duplicate") c.steps.push(c.steps[0]);
      if (mode === "missing") c.datasets[0].expected = {};
      if (mode === "optional") c.steps[0].required = false;
      if (mode === "zero") c.steps.pop();
      if (mode === "forward") c.steps[0].depends_on = ["check"];
      expect(() => parsePlan(p)).toThrow();
    },
  );
  it.each([
    [0, "FAIL"],
    [3, "PASS"],
    ["3", "FAIL"],
    [undefined, "INCONCLUSIVE"],
  ])("严格比较 %s => %s", (value, status) => {
    const p = parsePlan(sample()),
      r = expand(p)[0];
    if (value !== undefined)
      r.steps.push({
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
            observation_id: "o1",
            binding: {
              suite_run_id: "s",
              case_run_id: r.case_run_id,
              phase: "test",
              step_id: "read",
              attempt_id: "1",
            },
            producer: { call_id: "c1", adapter: "test", field: "likes" },
            context_id: "ctx",
            output_name: "likes",
            value,
            evidence_refs: [],
            observed_at: "now",
          },
        ],
      });
    expect(evaluate(p.cases[0].steps[1], r).status).toBe(status);
  });
  it("零断言和用户取消不报通过", () => {
    const r = expand(parsePlan(sample()))[0];
    expect(aggregate(r)).toBe("INCONCLUSIVE");
    r.cancelled = true;
    expect(aggregate(r)).toBe("CANCELLED");
    r.incomplete = true;
    expect(aggregate(r)).toBe("ERROR");
  });
});
describe("文件账本", () => {
  it("摘要匹配，去重且脱敏", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-test-")),
      r = new Recorder(root, "run");
    r.event("test", { password: "secret" }, undefined, "x");
    r.event("test", { password: "secret" }, undefined, "x");
    const text = readFileSync(join(r.directory, "events.jsonl"), "utf8");
    expect(text).not.toContain("secret");
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(r.evidence("ok.txt", "ok", "text/plain").sha256).toHaveLength(64);
  });
  it("拒绝目录和符号链接逃逸", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-test-"));
    expect(() => safePath(root, "../escape")).toThrow();
    symlinkSync(tmpdir(), join(root, "link"));
    expect(() => safePath(root, "link/escape")).toThrow();
  });
  it("尾部损坏标中断，中间损坏拒绝", async () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-test-")),
      r = new Recorder(root, "run");
    const plan = parsePlan(sample());
    r.snapshot({
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
    });
    appendFileSync(join(r.directory, "events.jsonl"), "{bad");
    expect((await rebuild(r.directory)).incomplete).toBe(true);
    appendFileSync(join(r.directory, "events.jsonl"), "\n{}\n");
    await expect(rebuild(r.directory)).rejects.toThrow("中间损坏");
  });
});

it("冻结前拒绝数字输出配字符串预期，避免非零断言类型错误", () => {
  const plan = sample();
  (plan.cases[0].datasets[0].expected as any).likes = "0";
  expect(() => parsePlan(plan)).toThrow("预期类型");
});

it("拒绝用页面url模式采集元素链接，避免把首页地址当成第一条结果", () => {
  const plan = sample();
  (plan.cases[0].steps[0].action!.capture as any).likes = {
    kind: "dom",
    mode: "url",
    selector: "a.result",
    index: 0,
  };
  expect(() => parsePlan(plan)).toThrow("只读取当前页面地址");
});
it("读取元素属性时必须指定属性名，不能退回textContent", () => {
  const plan = sample();
  (plan.cases[0].steps[0].action!.capture as any).likes = {
    kind: "dom",
    mode: "attribute",
    selector: "a.result",
  };
  expect(() => parsePlan(plan)).toThrow("必须声明attribute");
});

it("断言引用不能只有输出声明而没有采集定义", () => {
  const plan = sample();
  plan.cases[0].steps[0].action!.completion_requirements = [];
  plan.cases[0].steps[0].action!.capture = {};
  expect(() => parsePlan(plan)).toThrow("断言引用的输出缺少可信采集定义");
});

it("必需断言引用的观察必须在动作完成前采集", () => {
  const plan = sample();
  plan.cases[0].steps[0].action!.completion_requirements = [];
  expect(() => parsePlan(plan)).toThrow("必须列入completion_requirements");
});
