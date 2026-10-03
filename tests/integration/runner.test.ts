import { it, expect, describe } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestRunner, type SessionDriver } from "../../src/runner.js";
import { type Json } from "../../src/contracts.js";
import { rebuild } from "../../src/recorder.js";
import { applyRevision } from "../../src/revisions.js";
import { sample } from "../fixtures/plan.js";
function setup(
  value: Json = 3,
  behavior: "normal" | "missing" | "error" | "hang" = "normal",
) {
  const root = mkdtempSync(join(tmpdir(), "harness-run-"));
  let calls = 0;
  let runner: TestRunner;
  let disposed = 0;
  const factory = async () => {
    const sessionId = "session-" + Math.random();
    return {
      id: sessionId,
      run: async (active) => {
        calls++;
        if (active.result.step_id === "__reset") {
          active.finish = true;
          return;
        }
        if (behavior === "error") throw new Error("采集失败");
        if (behavior === "hang") {
          runner.stop();
          return;
        }
        if (behavior !== "missing")
          active.result.observations.push({
            observation_id: "observed-" + calls,
            binding: { ...active.binding },
            producer: {
              call_id: "call-" + calls,
              adapter: "fixture",
              field: "likes",
            },
            context_id: sessionId,
            output_name: "likes",
            value,
            evidence_refs: [],
            observed_at: new Date().toISOString(),
          });
        active.finish = true;
      },
      cancel() {},
      resume() {},
      drain: async () => behavior !== "hang",
      seal() {},
      dispose: async () => {
        disposed++;
      },
    } as SessionDriver;
  };
  runner = new TestRunner(
    {} as never,
    { outputRoot: root, cancelGraceMs: 20 },
    factory,
  );
  return {
    runner,
    root,
    get calls() {
      return calls;
    },
    get disposed() {
      return disposed;
    },
  };
}
describe("真实runner合同（调度替身，非宿主验收）", () => {
  it.each([
    [3, "PASS"],
    [0, "FAIL"],
  ])("冻结非零规则，实际 %s => %s", async (value, status) => {
    const { runner } = setup(value);
    runner.start(sample());
    const run = await runner.done!;
    expect(run.instances[0].status).toBe(status);
    expect(rebuild(runner.recorder!.directory).instances[0].status).toBe(
      status,
    );
    expect(
      readFileSync(join(runner.recorder!.directory, "report.html"), "utf8"),
    ).toContain("实际值 ACTUAL");
  });
  it("缺失业务证据INCONCLUSIVE，采集异常ERROR", async () => {
    for (const [mode, status] of [
      ["missing", "INCONCLUSIVE"],
      ["error", "ERROR"],
    ] as const) {
      const { runner } = setup(3, mode);
      runner.start(sample());
      expect((await runner.done!).instances[0].status).toBe(status);
    }
  });
  it("必需before拒绝BLOCKED，抛错ERROR", async () => {
    for (const mode of ["reject", "throw"]) {
      const { runner } = setup();
      runner.hook("before_step", ({ step }) => {
        if (step?.step_id !== "read") return true;
        if (mode === "throw") throw new Error("hook");
        return false;
      });
      runner.start(sample());
      expect((await runner.done!).instances[0].status).toBe(
        mode === "reject" ? "BLOCKED" : "ERROR",
      );
    }
  });
  it("后置hook不能修改历史，只记警示", async () => {
    const { runner } = setup();
    runner.hook("after_assertion", (v) => {
      v.result!.assertion!.actual = 0;
    });
    runner.start(sample());
    const i = (await runner.done!).instances[0];
    expect(i.status).toBe("PASS");
    expect(i.steps.find((s) => s.step_id === "check")!.assertion!.actual).toBe(
      3,
    );
    expect(i.issues.join()).toContain("警示");
  });
  it("可选断言失败不阻断必需检查", async () => {
    const p = sample();
    p.cases[0].steps.push({
      ...p.cases[0].steps[1],
      step_id: "optional",
      required: false,
      assertion: {
        observation_ref: "read.likes",
        operator: "eq",
        literal: 0,
        rule_ref: "r",
      },
    } as never);
    const { runner } = setup();
    runner.start(p);
    expect((await runner.done!).instances[0].status).toBe("PASS");
  });
  it("两例各2/3数据恰好五例且业务失败继续", async () => {
    const p = sample();
    const c = p.cases[0];
    c.datasets.push({ ...c.datasets[0], data_id: "b" });
    p.cases.push({
      ...structuredClone(c),
      case_id: "two",
      datasets: [...c.datasets, { ...c.datasets[0], data_id: "c" }],
    });
    const { runner } = setup(0);
    runner.start(p);
    const run = await runner.done!;
    expect(run.instances).toHaveLength(5);
    expect(run.instances.every((i) => i.status === "FAIL")).toBe(true);
    expect(new Set(run.instances.map((i) => i.session_id)).size).toBe(5);
  });
  it("收尾超限ERROR持久隔离、后例取消、重启拒绝批次", async () => {
    const env = setup(3, "hang");
    const p = sample();
    p.cases[0].datasets.push({ ...p.cases[0].datasets[0], data_id: "b" });
    env.runner.start(p);
    const run = await env.runner.done!;
    expect(run.instances.map((i) => i.status)).toEqual(["ERROR", "CANCELLED"]);
    expect(env.runner.quarantined).toBe(true);
    expect(() => env.runner.start(p)).toThrow("隔离");
    const restarted = new TestRunner({} as never, { outputRoot: env.root });
    expect(restarted.quarantined).toBe(true);
    expect(env.disposed).toBe(0);
  });
  it("活动批次拒绝重复启动", async () => {
    const { runner } = setup();
    runner.start(sample());
    expect(() => runner.start(sample())).toThrow("活动");
    await runner.done;
  });
  it("新增必需断言可改变结果，已终结目标拒绝", async () => {
    const { runner } = setup();
    let once = false;
    runner.hook("after_observation", ({ instance, step }) => {
      if (once || step?.step_id !== "read") return;
      once = true;
      const p = sample();
      applyRevision(
        runner.run!,
        runner.recorder!,
        {
          reason: "原规则要求非零，增加显式核对",
          source_refs: p.source_refs,
          added_steps: [
            {
              step_id: "extra",
              kind: "assertion",
              description: "新增必需",
              required: true,
              depends_on: ["read"],
              assertion: {
                observation_ref: "read.likes",
                operator: "eq",
                literal: 0,
                rule_ref: "r",
              },
            },
          ],
          target_instance_ids: [instance.case_run_id],
          insertion_boundary: "end",
          post_hoc: true,
        },
        10,
      );
    });
    runner.start(sample());
    const run = await runner.done!;
    expect(run.instances[0].status).toBe("FAIL");
    expect(run.instances[0].applied_revisions).toEqual([0, 1]);
    expect(() => applyRevision(run, runner.recorder!, {} as never, 10)).toThrow(
      "关闭",
    );
  });
  it("报告对注入字符串转义且不含外部脚本", async () => {
    const p = sample();
    p.name = "<script>window.pwned=1</script>";
    const { runner } = setup();
    runner.start(p);
    await runner.done;
    const html = readFileSync(
      join(runner.recorder!.directory, "report.html"),
      "utf8",
    );
    expect(html).not.toContain("<script>window.pwned");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});

it("清理中停止不取消预授权清理，后续实例取消", async () => {
  const root = mkdtempSync(join(tmpdir(), "cleanup-stop-"));
  let cleanupCancelled = 0,
    cleanupRuns = 0;
  let runner: TestRunner;
  runner = new TestRunner(
    {} as never,
    { outputRoot: root },
    async (_r, options) => ({
      id: options.cleanup ? "cleanup" : "business",
      run: async (active) => {
        if (options.cleanup) {
          cleanupRuns++;
          runner.stop();
        }
        active.finish = true;
      },
      cancel: () => {
        if (options.cleanup) cleanupCancelled++;
      },
      drain: async () => true,
      dispose: async () => {},
      seal: () => {},
    }),
  );
  const p = sample();
  p.cases[0].datasets.push({ ...p.cases[0].datasets[0], data_id: "second" });
  runner.start(p);
  const run = await runner.done!;
  expect(cleanupRuns).toBe(1);
  expect(cleanupCancelled).toBe(0);
  expect(run.instances.map((i) => i.status)).toEqual([
    "CANCELLED",
    "CANCELLED",
  ]);
  expect(run.resource_quarantined).toBe(false);
});
it("报告后置hook警示同步写入HTML与结果", async () => {
  const { runner } = setup();
  runner.hook("report_ready", () => {
    throw new Error("通知发送失败");
  });
  runner.start(sample());
  const run = await runner.done!;
  expect(run.instances[0].status).toBe("PASS");
  expect(
    readFileSync(join(runner.recorder!.directory, "report.html"), "utf8"),
  ).toContain("通知发送失败");
});
