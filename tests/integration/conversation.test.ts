import { it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { apply, TestRunner } from "../../src/index.js";
import type { SessionDriver } from "../../src/runner.js";
import type { TestProgress } from "../../src/progress-types.js";
import * as recorderModule from "../../src/recorder.js";
import { sample } from "../fixtures/plan.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function setup(value: number, brokenDisplay = false) {
  const root = mkdtempSync(join(tmpdir(), "conversation-test-"));
  roots.push(root);
  const steps = gate(),
    cleanup = gate();
  let runner!: TestRunner;
  type Definition = Parameters<Context["commands"]["register"]>[0];
  const commands = new Map<string, Definition>();
  const updates: { first: boolean; progress: TestProgress }[] = [];
  const originalWrite = recorderModule.atomicJson;
  vi.spyOn(recorderModule, "atomicJson").mockImplementation((path, data) => {
    if (path.includes("/conversation/")) {
      if (brokenDisplay && updates.length > 1) throw new Error("展示写入失败");
      updates.push({
        first: updates.length === 0,
        progress: structuredClone(data) as TestProgress,
      });
    }
    originalWrite(path, data);
  });
  // 不向宿主会话写入自定义事件，防止重启后未知事件破坏历史读取。
  const agent = {
    id: "origin",
    session: {
      append: () => {
        throw new Error("禁止写入自定义会话事件");
      },
    },
  };
  apply(
    {
      provide: (_name: string, r: TestRunner) => {
        runner = r;
      },
      inject: () => {},
      effect: (fn: () => unknown) => fn(),
      commands: {
        register: (d: Definition) => {
          commands.set(d.name, d);
          return () => {};
        },
      },
    } as unknown as Context,
    { workspace: root, outputRoot: join(root, "runs") },
  );
  Object.assign(runner, {
    factory: async () =>
      ({
        id: "execution",
        run: async (active) => {
          if (active.result.step_id === "read") await steps.promise;
          if (active.result.phase === "cleanup") await cleanup.promise;
          active.result.observations.push({
            observation_id: "observed-" + active.result.step_id,
            binding: active.binding,
            producer: { call_id: "call", adapter: "fixture", field: "likes" },
            context_id: "execution",
            output_name: "likes",
            value,
            evidence_refs: [],
            observed_at: new Date().toISOString(),
          });
          active.finish = true;
        },
        cancel() {},
        resume() {},
        seal() {},
        drain: async () => true,
        dispose: async () => {},
      }) satisfies SessionDriver,
  });
  const plan = sample();
  plan.cases[0].datasets[0].inputs = { password: "private-secret" } as never;
  plan.cases[0].steps[0].description = "读取 private-secret";
  writeFileSync(join(root, "plan.json"), JSON.stringify(plan));
  const abort = new AbortController();
  const command = (name: string, input = "") =>
    commands.get(name)!.handler({
      agent,
      commandId: "command-1",
      rawInput: input,
      signal: abort.signal,
    } as never);
  return { root, runner, updates, steps, cleanup, abort, command };
}

it.each([1, 0])(
  "同步命令等待清理，实际值 %s 与对话、断言、报告一致",
  async (value) => {
    const s = setup(value);
    let settled = false;
    const result = Promise.resolve(s.command("test-run", "plan.json")).then(
      (r) => {
        settled = true;
        return r;
      },
    );
    await vi.waitFor(() =>
      expect(
        s.updates
          .at(-1)
          ?.progress.instances[0]?.steps.some((step) => step.id === "read"),
      ).toBe(true),
    );
    expect(settled).toBe(false);
    expect(s.updates.at(-1)?.progress.state).toBe("running");
    s.steps.release();
    await vi.waitFor(() =>
      expect(
        s.updates
          .at(-1)
          ?.progress.instances[0]?.steps.some(
            (step) => step.phase === "cleanup",
          ),
      ).toBe(true),
    );
    expect(settled).toBe(false);
    s.cleanup.release();
    expect(await result).toMatchObject({
      kind: "success",
      text: expect.stringContaining("查看测试报告"),
    });
    const p = s.updates.at(-1)!.progress;
    const recorded = JSON.parse(
      readFileSync(join(s.runner.recorder!.directory, "results.json"), "utf8"),
    );
    expect(p.instances[0].status).toBe(value ? "PASS" : "FAIL");
    expect(
      p.instances[0].steps.find((step) => step.id === "check")?.assertion,
    ).toMatchObject({
      actual: value,
      expected: 0,
      status: value ? "PASS" : "FAIL",
    });
    expect(p.instances[0].status).toBe(recorded.instances[0].status);
    expect(p.state).toBe("finished");
    expect(
      JSON.parse(
        readFileSync(join(s.root, "runs/conversation/command-1.json"), "utf8"),
      ),
    ).toEqual(p);
    expect(p.report?.url).toContain(p.runId);
    expect(JSON.stringify(s.updates)).not.toContain("private-secret");
    expect(s.updates.filter((u) => u.first)).toHaveLength(1);
    expect(s.updates.every((u) => u.progress.sessionId === "origin")).toBe(
      true,
    );
  },
);

it("停止时保留在途结算与清理进度，拒绝旧运行的停止请求", async () => {
  const s = setup(1);
  const result = s.command("test-run", "plan.json");
  await vi.waitFor(() =>
    expect(
      s.runner.run?.instances[0].steps.some((x) => x.step_id === "read"),
    ).toBe(true),
  );
  expect(await s.command("test-stop", "old-run")).toMatchObject({
    kind: "error",
  });
  expect(s.runner.run!.lifecycle).toBe("RUNNING");
  s.abort.abort();
  expect(s.updates.at(-1)?.progress.state).toBe("cancelling");
  s.steps.release();
  s.cleanup.release();
  await result;
  expect(s.updates.at(-1)?.progress.instances[0].status).toBe("CANCELLED");
  expect(
    s.updates
      .at(-1)
      ?.progress.instances[0].steps.some((step) => step.phase === "cleanup"),
  ).toBe(true);
});

it("进度回传失败不改变执行结果，也不阻止清理", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const s = setup(1, true);
    s.steps.release();
    s.cleanup.release();
    await s.command("test-run", "plan.json");
    expect(s.runner.run?.instances[0].status).toBe("PASS");
    expect(
      s.runner.run?.instances[0].steps.some((step) => step.phase === "cleanup"),
    ).toBe(true);
    expect(s.runner.recorder?.failed).toBeUndefined();
  } finally {
    warn.mockRestore();
  }
});
