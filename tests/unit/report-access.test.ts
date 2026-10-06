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

it("网页报告使用宿主HTTP地址，避免相对链接被聊天渲染器解释为工作区文件", () => {
  const { access } = setup();
  access.origin = () => "http://127.0.0.1:3080";
  expect(access.url("run-example")).toBe(
    "http://127.0.0.1:3080/test-reports/run-example/report.html",
  );
});

it("实际步骤及手工用例文件仅开放规定名称，Markdown以附件下载", () => {
  const { access, root } = setup();
  for (const suffix of ["", "-rebuilt"]) {
    writeFileSync(
      join(root, `run-example/actual-steps${suffix}.json`),
      '{"format":"dsh-actual-steps"}',
    );
    writeFileSync(
      join(root, `run-example/manual-cases${suffix}.md`),
      "# 手工用例",
    );
    const json = get(
      access,
      `/test-reports/run-example/actual-steps${suffix}.json`,
    );
    expect(json.status).toBe(200);
    expect(json.headers["Content-Type"]).toContain("application/json");
    const md = get(
      access,
      `/test-reports/run-example/manual-cases${suffix}.md`,
    );
    expect(md.status).toBe(200);
    expect(md.headers["Content-Type"]).toBe("text/markdown; charset=utf-8");
    expect(md.headers["Content-Disposition"]).toContain("attachment");
    expect(
      get(access, `/test-reports/run-example/manual-cases${suffix}.md`, "HEAD")
        .body,
    ).toBeUndefined();
    expect(
      get(access, `/test-reports/run-example/manual-cases${suffix}.md`, "POST")
        .status,
    ).toBe(405);
  }
  writeFileSync(join(root, "run-example/private.md"), "private");
  expect(get(access, "/test-reports/run-example/private.md").status).toBe(404);
});
