import { expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expand, parsePlan, type SuiteRun } from "../../src/contracts.js";
import { writeReport } from "../../src/report.js";
import { sample } from "../fixtures/plan.js";
function render(change: (run: SuiteRun, directory: string) => void): string {
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
  change(run, dir);
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

it("附件预览与下载自包含，不发起会丢失宿主登录态的请求", () => {
  const html = render((run, dir) => {
    mkdirSync(join(dir, "evidence"));
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6qtwAAAAASUVORK5CYII=",
      "base64",
    );
    writeFileSync(join(dir, "evidence/a.png"), png);
    writeFileSync(join(dir, "events.jsonl"), '{"type":"fixture"}\n');
    run.evidence = [
      {
        evidence_id: "shot",
        relative_path: "evidence/a.png",
        media_type: "image/png",
        sha256: "fixture",
        redacted: false,
      },
    ];
    run.instances[0].steps = [
      {
        step_id: "read",
        phase: "test",
        description: "截图",
        required: true,
        status: "SUCCEEDED",
        started_at: run.created_at,
        duration_ms: 1,
        calls: [],
        observations: [
          {
            observation_id: "o",
            binding: {
              suite_run_id: run.suite_run_id,
              case_run_id: "one--a",
              phase: "test",
              step_id: "read",
              attempt_id: "1",
            },
            producer: { call_id: "c", adapter: "dom", field: "likes" },
            context_id: "origin",
            output_name: "likes",
            value: 1,
            evidence_refs: ["shot"],
            observed_at: run.created_at,
          },
        ],
      },
    ];
  });
  expect(html).toContain('src="data:image/png;base64,');
  expect(html).not.toContain('href="evidence/a.png"');
  expect(html).toContain('download="a.png"');
  expect(html).toContain('download="events.jsonl.gz"');
  expect(html).toContain('download="results.json"');
});
