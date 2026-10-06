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

it("新报告默认显示编号实际步骤和实例下载，旧记录继续使用原步骤页", () => {
  const html = render((run) => {
    run.manifest.actual_operations_schema = "1";
    const binding = {
      suite_run_id: run.suite_run_id,
      case_run_id: run.instances[0]!.case_run_id,
      phase: "test" as const,
      step_id: "read",
      attempt_id: "1",
    };
    run.instances[0]!.steps = [
      {
        step_id: "read",
        phase: "test",
        description: "搜索",
        required: true,
        status: "SUCCEEDED",
        started_at: run.created_at,
        duration_ms: 1,
        observations: [],
        calls: [
          {
            call_id: "child",
            binding,
            name: "mcp__playwright__browser_type",
            args_redacted: { text: "agent", ref: "e2" },
            started_at: run.created_at,
            body_started: "unknown",
          },
        ],
        actual_operations: [
          {
            operation_id: "operation",
            order_in_step: 1,
            binding,
            description: "输入 <agent> | 关键词",
            description_source: "model",
            parent_call_id: "parent",
            tool_call_id: "child",
            granularity: "atomic",
            dispatch_observed: true,
            state: "SUCCEEDED",
            created_at: run.created_at,
          },
        ],
      },
    ];
  });
  expect(html).toContain('aria-selected="true" data-tab="actual"');
  expect(html).toContain('data-panel="steps" hidden');
  expect(html).toContain('data-actual-id="operation"');
  expect(html).toContain("输入 &lt;agent&gt; | 关键词");
  expect(html).toContain("下载手工用例 Markdown");
  expect(html).not.toContain('data-tab="recordings"');
  expect(html).not.toContain('id="image-dialog"');
  const old = render(() => {});
  expect(old).not.toMatch(/<button[^>]+data-tab="actual"/);
  expect(old).toContain('aria-selected="true" data-tab="steps"');
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
  expect(html).toContain('href="events.jsonl?download=1"');
  expect(html).not.toContain("data:application/gzip;base64,");
  expect(html).toContain('download="results.json"');
});

it("只有持有真实录像的实例显示录像入口；接口实例不显示媒体区域", () => {
  const html = render((run, dir) => {
    mkdirSync(join(dir, "evidence"));
    const video = readFileSync(
      new URL("../fixtures/minimal.mp4", import.meta.url),
    );
    writeFileSync(join(dir, "evidence/browser-one.mp4"), video);
    const ui = run.instances[0];
    const api = structuredClone(ui);
    api.case_run_id = "api-instance";
    api.case_id = "api";
    run.instances.push(api);
    run.evidence.push({
      evidence_id: "video",
      relative_path: "evidence/browser-one.mp4",
      media_type: "video/mp4",
      sha256: "fixture",
      redacted: false,
    });
    run.recordings = [
      {
        recording_id: "one",
        case_run_id: ui.case_run_id,
        target_id: "page-one",
        status: "COMPLETE",
        started_at: run.created_at,
        finished_at: run.finished_at,
        evidence_id: "video",
        relative_path: "evidence/browser-one.mp4",
        bytes: video.length,
        duration_ms: 1000,
      },
    ];
  });
  const articles = html.match(/<article class="case"[\s\S]*?<\/article>/g)!;
  expect(articles[0]).toContain('data-tab="recordings"');
  expect(articles[0]).toContain(
    '<video controls preload="metadata" src="evidence/browser-one.mp4"',
  );
  expect(articles[1]).not.toContain('data-tab="recordings"');
  expect(articles[1]).not.toContain("<video");
  expect(articles[1]).not.toContain("录像提示");
  expect(html).not.toContain('<dialog id="image-dialog"');
  expect(html).not.toContain("data:video/");
});
it("纯接口、录像关闭或没有已归档视频时没有空播放器或截图对话框", () => {
  const html = render(() => {});
  expect(html).not.toContain("<video");
  expect(html).not.toContain('data-tab="recordings"');
  expect(html).not.toContain('<dialog id="image-dialog"');
});
it("已取消与部分录像、录像失败原因保持原样且不冒充完整视频", () => {
  const html = render((run, dir) => {
    mkdirSync(join(dir, "evidence"));
    const bytes = readFileSync(
      new URL("../fixtures/minimal.mp4", import.meta.url),
    );
    writeFileSync(join(dir, "evidence/browser-one.mp4"), bytes);
    run.instances[0].cancelled = true;
    run.instances[0].status = "CANCELLED";
    run.evidence.push({
      evidence_id: "video",
      relative_path: "evidence/browser-one.mp4",
      media_type: "video/mp4",
      sha256: "fixture",
      redacted: false,
    });
    run.recordings = [
      {
        recording_id: "one",
        case_run_id: run.instances[0].case_run_id,
        target_id: "one",
        status: "PARTIAL",
        started_at: run.created_at,
        finished_at: run.finished_at,
        evidence_id: "video",
        relative_path: "evidence/browser-one.mp4",
        bytes: bytes.length,
        reason: "连接超时",
      },
      {
        recording_id: "two",
        case_run_id: run.instances[0].case_run_id,
        target_id: "two",
        status: "FAILED",
        started_at: run.created_at,
        first_frame_at: run.created_at,
        reason: "依赖缺失",
      },
    ];
  });
  expect(html).toContain("部分录制");
  expect(html).toContain("本次测试已取消");
  expect(html).toContain("依赖缺失");
  expect(html.match(/<video /g) ?? []).toHaveLength(1);
});
