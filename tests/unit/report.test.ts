import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expand, parsePlan, type SuiteRun } from "../../src/contracts.js";
import { writeReport } from "../../src/report.js";
import { sample } from "../fixtures/plan.js";
function render(change: (run: SuiteRun) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "report-test-"));
  const plan = parsePlan(sample());
  const run: SuiteRun = {
    schema_version: "1",
    suite_run_id: "run-ui",
    name: "测试报告",
    created_at: "2026-10-03T12:00:00Z",
    finished_at: "2026-10-03T12:01:00Z",
    lifecycle: "FINISHED",
    plan,
    instances: expand(plan),
    evidence: [],
    incomplete: false,
    resource_quarantined: false,
    manifest: {},
  };
  change(run);
  try {
    writeReport(dir, run);
    return readFileSync(join(dir, "report.html"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
it("报告分别展示取消与异常，不能把结束或零断言视为通过", () => {
  const html = render((run) => {
    run.instances[0].status = "CANCELLED";
    run.instances[0].lifecycle = "FINISHED";
  });
  expect(html).toContain("0.0% 用例通过率");
  expect(html).toContain("0 / 0 条已执行断言通过");
  expect(html).toContain('data-filter-status="CANCELLED"');
  expect(html).toContain("未通过 / 未完成");
  expect(html).not.toContain("100% 结果结算率");
});
it("用户字段安全转义，报告脚本与图标离线自包含", () => {
  const html = render((run) => {
    run.name = "</h1><script>alert(1)</script>";
    run.instances[0].name = '" onfocus="bad';
  });
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toMatch(/<script[^>]+src=/);
  expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
  expect(html).toContain("data:image/svg+xml;base64,");
});
it("缺失证据显示明确提示，不产生无效预览或捏造附件", () => {
  const html = render((run) => {
    run.instances[0].steps = [
      {
        step_id: "read",
        phase: "test",
        description: "读取",
        required: true,
        status: "SUCCEEDED",
        started_at: run.created_at,
        duration_ms: 1,
        calls: [],
        observations: [
          {
            observation_id: "o",
            binding: {
              suite_run_id: "run-ui",
              case_run_id: "one--a",
              phase: "test",
              step_id: "read",
              attempt_id: "1",
            },
            producer: { call_id: "c", adapter: "dom", field: "likes" },
            context_id: "origin",
            output_name: "likes",
            value: 1,
            evidence_refs: ["missing-id"],
            observed_at: run.created_at,
          },
        ],
      },
    ];
  });
  expect(html).toContain("缺少附件索引：missing-id");
  expect(html).not.toContain('class="preview"');
});
