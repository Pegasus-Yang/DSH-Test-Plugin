import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReportAccess } from "../../src/report-access.js";
import type { SuiteRun } from "../../src/contracts.js";
function setup() {
  const root = mkdtempSync(join(tmpdir(), "report-access-"));
  const run = {
    suite_run_id: "run-example",
    lifecycle: "FINISHED",
    instances: [{ status: "PASS" }],
  } as SuiteRun;
  mkdirSync(join(root, run.suite_run_id, "evidence"), { recursive: true });
  writeFileSync(
    join(root, run.suite_run_id, "results.json"),
    JSON.stringify(run),
  );
  writeFileSync(
    join(root, run.suite_run_id, "report.html"),
    "<html>报告</html>",
  );
  const access = new ReportAccess(root);
  return { root, run, access };
}
function get(access: ReportAccess, url: string, method = "GET") {
  let status = 200,
    body: unknown;
  const headers: Record<string, string> = {};
  access.serve(
    { url, method } as never,
    {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      writeHead: (s: number) => {
        status = s;
      },
      end: (b: unknown) => {
        body = b;
      },
    } as never,
  );
  return { status, body, headers };
}
it("重启后不需要运行ID即可恢复最近报告；运行中不提供未完成报告", () => {
  const { access, run } = setup();
  expect(access.latestId).toBe("run-example");
  expect(access.state()?.ready).toBe(true);
  access.select(run, "report.html", false);
  expect(access.state()?.ready).toBe(false);
  access.finish(run);
  expect(access.state()?.ready).toBe(true);
});
it("读取报告和证据，拒绝写入、目录和符号链接逃逸", () => {
  const { access, root } = setup();
  expect(
    String(get(access, "/test-reports/run-example/report.html").body),
  ).toContain("报告");
  expect(
    get(access, "/test-reports/run-example/report.html", "POST").status,
  ).toBe(405);
  expect(get(access, "/test-reports/run-example/../../secret").status).toBe(
    404,
  );
  expect(get(access, "/test-reports/run-example/%2e%2e%2fsecret").status).toBe(
    404,
  );
  expect(get(access, "/test-reports/run-example/").status).toBe(404);
  const outside = mkdtempSync(join(tmpdir(), "outside-report-"));
  writeFileSync(join(outside, "secret.json"), "secret");
  symlinkSync(
    join(outside, "secret.json"),
    join(root, "run-example/evidence/secret.json"),
  );
  expect(
    get(access, "/test-reports/run-example/evidence/secret.json").status,
  ).toBe(404);
});
it("旧批次迟到通知不能覆盖当前报告，HTML采用隔离策略", () => {
  const { access, run } = setup();
  const later = { ...run, suite_run_id: "run-later" };
  access.select(later, "report.html", false);
  access.finish(run);
  expect(access.state()?.ready).toBe(false);
  expect(
    get(access, "/test-reports/run-example/report.html").headers[
      "Content-Security-Policy"
    ],
  ).toContain("sandbox");
});

it("重启读取命令进度，拒绝进度路径逃逸及写请求", () => {
  const { root } = setup();
  mkdirSync(join(root, "conversation"));
  writeFileSync(
    join(root, "conversation/command-1.json"),
    JSON.stringify({ state: "finished", runId: "run-example" }),
  );
  const access = new ReportAccess(root);
  expect(
    JSON.parse(
      String(get(access, "/test-reports/conversation/command-1.json").body),
    ),
  ).toEqual({ state: "finished", runId: "run-example" });
  expect(
    get(access, "/test-reports/conversation/command-1.json", "POST").status,
  ).toBe(405);
  expect(
    get(access, "/test-reports/conversation/%2e%2e%2fsecret.json").status,
  ).toBe(404);
  const outside = mkdtempSync(join(tmpdir(), "outside-progress-"));
  writeFileSync(join(outside, "secret.json"), "secret");
  symlinkSync(
    join(outside, "secret.json"),
    join(root, "conversation/escape.json"),
  );
  expect(get(access, "/test-reports/conversation/escape.json").status).toBe(
    404,
  );
});
