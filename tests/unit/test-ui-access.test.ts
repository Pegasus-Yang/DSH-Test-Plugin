import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeTests } from "../../src/native-test.js";
import { Recorder } from "../../src/recorder.js";
import { expand, parsePlan, type SuiteRun } from "../../src/contracts.js";
import { TestUiAccess } from "../../src/test-ui-access.js";
import { sample } from "../fixtures/plan.js";
const roots: string[] = [];
const services: TestUiAccess[] = [];
afterEach(() => {
  services.splice(0).forEach((s) => s.dispose());
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true }));
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), "test-ui-"));
  roots.push(root);
  const tests = new NativeTests({} as never, {
    workspace: root,
    outputRoot: join(root, "runs"),
  });
  const recover = vi.fn(
    async (_sid: string, _token: string, _signal: AbortSignal) => "已释放",
  );
  const inputPath = vi.fn((input: string) => join(root, input));
  const service = new TestUiAccess(tests, inputPath, recover);
  services.push(service);
  const save = (id = "run-one", session = "one", finished = true) => {
    const plan = parsePlan(sample());
    const run: SuiteRun = {
      schema_version: "1",
      suite_run_id: id,
      name: "报告重建验收",
      created_at: new Date().toISOString(),
      lifecycle: finished ? "FINISHED" : "RUNNING",
      plan,
      instances: expand(plan),
      evidence: [],
      incomplete: false,
      resource_quarantined: false,
      manifest: { origin_session_id: session },
    };
    const recorder = new Recorder(tests.config.outputRoot, id);
    recorder.snapshot(run);
    writeFileSync(join(recorder.directory, "report.html"), "原始报告");
    return { run, directory: recorder.directory };
  };
  return { root, tests, service, recover, inputPath, save };
}
function begin(
  service: TestUiAccess,
  action: string,
  body: unknown = {},
  method = "POST",
) {
  const req = Object.assign(new PassThrough(), {
    url: `/test-ui/${action}`,
    method,
  });
  const headers: Record<string, string> = {};
  const res: any = new EventEmitter();
  let status = 200,
    data = "";
  res.setHeader = (name: string, value: string) => {
    headers[name] = value;
  };
  res.writeHead = (value: number) => {
    status = value;
  };
  res.end = (value = "") => {
    data = value;
  };
  const pending = service.serve(req as never, res);
  req.end(typeof body === "string" ? body : JSON.stringify(body));
  return {
    res,
    pending: pending.then(() => ({
      status,
      data: data ? JSON.parse(data) : undefined,
      headers,
    })),
  };
}
const request = (
  service: TestUiAccess,
  action: string,
  body: unknown = {},
  method = "POST",
) => begin(service, action, body, method).pending;
it("重建当前会话或指定历史报告只读取账本，保留原报告、原结果和事件", async () => {
  const t = setup();
  const one = t.save();
  t.save("run-two", "other");
  const original = ["events.jsonl", "results.json", "report.html"].map((file) =>
    readFileSync(join(one.directory, file), "utf8"),
  );
  const result = await request(t.service, "report", { session_id: "one" });
  expect(result.status).toBe(200);
  expect(result.data).toMatchObject({
    ok: true,
    value: {
      run_id: "run-one",
      url: expect.stringContaining("/test-reports/run-one/report-rebuilt.html"),
    },
  });
  expect(existsSync(join(one.directory, "report-rebuilt.html"))).toBe(true);
  expect(
    JSON.parse(
      readFileSync(join(one.directory, "results-rebuilt.json"), "utf8"),
    ),
  ).toMatchObject({ suite_run_id: "run-one" });
  expect(
    ["events.jsonl", "results.json", "report.html"].map((file) =>
      readFileSync(join(one.directory, file), "utf8"),
    ),
  ).toEqual(original);
  expect(
    (await request(t.service, "report", { session_id: "new" })).status,
  ).toBe(400);
  expect(
    (await request(t.service, "report", { run_id: "run-two" })).data.value
      .run_id,
  ).toBe("run-two");
  expect(t.recover).not.toHaveBeenCalled();
  expect(result.headers["Cache-Control"]).toBe("no-store");
});
it("中断记录仍能生成明确不完整的报告，活动测试拒绝重建", async () => {
  const t = setup();
  const one = t.save("run-interrupted", "one", false);
  expect(
    (await request(t.service, "report", { run_id: "run-interrupted" })).status,
  ).toBe(200);
  expect(
    JSON.parse(
      readFileSync(join(one.directory, "results-rebuilt.json"), "utf8"),
    ),
  ).toMatchObject({ lifecycle: "INTERRUPTED", incomplete: true });
  t.tests.sessions.set("one", { run: one.run, closed: false } as never);
  expect(
    (await request(t.service, "report", { run_id: "run-interrupted" })).data
      .message,
  ).toContain("尚未结束");
});
it.each([
  { run_id: "../outside" },
  { run_id: 3 },
  { session_id: [] },
  { run_id: "run-missing" },
])("无效报告请求 %j 不写报告", async (body) => {
  const t = setup();
  t.save();
  expect((await request(t.service, "report", body)).status).toBe(400);
  expect(
    existsSync(join(t.tests.config.outputRoot, "run-one/report-rebuilt.html")),
  ).toBe(false);
});
it("确认恢复仅传递所选会话、当前编号及取消信号；缺少确认或会话不调用恢复", async () => {
  const t = setup();
  const token = "a".repeat(64);
  for (const body of [
    { session_id: "one" },
    { session_id: "one", token: "old" },
    { token },
  ])
    expect((await request(t.service, "recover", body)).status).toBe(400);
  expect(t.recover).not.toHaveBeenCalled();
  expect(
    (await request(t.service, "recover", { session_id: "one", token })).data,
  ).toEqual({ ok: true, value: "已释放" });
  expect(t.recover).toHaveBeenCalledWith("one", token, expect.any(AbortSignal));
  t.recover.mockRejectedValueOnce(new Error("审批拒绝，隔离仍保留"));
  expect(
    (await request(t.service, "recover", { session_id: "one", token })).data,
  ).toEqual({ ok: false, message: "审批拒绝，隔离仍保留" });
});
it("证据提交验证真实处置声明与当前隔离编号，过期确认不能解除新隔离", async () => {
  const t = setup();
  const one = t.save();
  t.tests.recovery.mark(one.run, "需核实外部环境");
  const token = t.tests.recovery.status().quarantine!.token;
  writeFileSync(
    join(t.root, "proof.json"),
    JSON.stringify({
      external_stopped: true,
      environment_reset: true,
      operator: "测试替身",
      details: "外部停止已确认",
      evidence: { fixture: true },
    }),
  );
  t.tests.recovery.mark({ ...one.run, suite_run_id: "run-new" }, "另一次隔离");
  expect(
    (
      await request(t.service, "release", {
        evidence_file: "proof.json",
        token,
      })
    ).data.message,
  ).toContain("已变化");
  const current = t.tests.recovery.status().quarantine!.token;
  writeFileSync(
    join(t.root, "invalid.json"),
    JSON.stringify({ external_stopped: false }),
  );
  expect(
    (
      await request(t.service, "release", {
        evidence_file: "invalid.json",
        token: current,
      })
    ).status,
  ).toBe(400);
  expect(t.tests.recovery.status().quarantine).not.toBeNull();
  t.tests.recovery.busy = true;
  expect(
    (
      await request(t.service, "release", {
        evidence_file: "proof.json",
        token: current,
      })
    ).status,
  ).toBe(400);
  t.tests.recovery.busy = false;
  expect(
    (
      await request(t.service, "release", {
        evidence_file: "proof.json",
        token: current,
      })
    ).data.ok,
  ).toBe(true);
  expect(t.inputPath).toHaveBeenCalledWith("proof.json");
  expect(t.tests.recovery.status().quarantine).toBeNull();
  expect(
    readdirSync(t.tests.config.outputRoot).filter((f) =>
      f.startsWith("release-"),
    ),
  ).toHaveLength(1);
  expect(t.recover).not.toHaveBeenCalled();
});
it.each([
  ["report", "GET", 405],
  ["recover", "GET", 405],
  ["release", "GET", 405],
  ["unknown", "POST", 404],
])("操作 %s 方法 %s 被拒绝", async (action, method, code) => {
  const t = setup();
  expect((await request(t.service, action, {}, method)).status).toBe(code);
  expect(t.recover).not.toHaveBeenCalled();
});
it.each(["not-json", "null", "[]", "x".repeat(4097)])(
  "非法或过大请求不触发恢复",
  async (body) => {
    const t = setup();
    expect((await request(t.service, "recover", body)).status).toBe(400);
    expect(t.recover).not.toHaveBeenCalled();
  },
);
it.each(["disconnect", "dispose"])("%s 取消在途恢复", async (kind) => {
  const t = setup();
  t.recover.mockImplementation(
    (_sid, _token, signal) =>
      new Promise((_done, reject) =>
        signal.addEventListener("abort", () =>
          reject(new Error("已取消，隔离仍保留")),
        ),
      ),
  );
  const operation = begin(t.service, "recover", {
    session_id: "one",
    token: "a".repeat(64),
  });
  await vi.waitFor(() => expect(t.recover).toHaveBeenCalled());
  if (kind === "disconnect") {
    operation.res.destroyed = true;
    operation.res.emit("close");
  } else t.service.dispose();
  await operation.pending;
  expect(t.recover.mock.calls[0][2].aborted).toBe(true);
});
