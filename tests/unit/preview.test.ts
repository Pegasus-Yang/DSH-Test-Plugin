import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PreviewManager } from "../../src/preview.js";
import type { SuiteRun } from "../../src/contracts.js";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { checkBrowscreen } from "../../src/browscreen-command.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<any>()),
  spawn: vi.fn(),
}));
vi.mock("node:net", () => ({ createServer: vi.fn() }));
vi.mock("../../src/browscreen-command.js", async (original) => ({
  ...(await original<any>()),
  checkBrowscreen: vi.fn(),
}));
const managers: PreviewManager[] = [];
const children: any[] = [];
beforeEach(() => {
  vi.mocked(checkBrowscreen).mockReset().mockResolvedValue({
    ok: true,
    executable: "/installed/browscreen",
    version: "0.3.0",
    message: "已安装",
  });
  vi.mocked(createServer)
    .mockReset()
    .mockImplementation(() => {
      const server: any = new EventEmitter();
      server.unref = () => server;
      server.listen = (_port: number, _host: string, ready: () => void) => {
        queueMicrotask(ready);
        return server;
      };
      server.close = (done: () => void) => done();
      return server;
    });
  vi.mocked(spawn)
    .mockReset()
    .mockImplementation((_executable, args: any) => {
      const child: any = new EventEmitter();
      child.pid = 700 + children.length;
      child.exitCode = null;
      child.signalCode = null;
      child.stderr = new EventEmitter();
      child.recordPath = args.includes("--record-output")
        ? args[args.indexOf("--record-output") + 1]
        : undefined;
      if (child.recordPath)
        copyFileSync(
          new URL("../fixtures/minimal.mp4", import.meta.url),
          child.recordPath,
        );
      child.kill = vi.fn((signal) => {
        if (!child.ignoreTerm || signal === "SIGKILL")
          queueMicrotask(() => {
            if (child.recordPath && signal !== "SIGKILL")
              child.stderr.emit(
                "data",
                Buffer.from(`录制完成，视频文件：${child.recordPath}\n`),
              );
            child.signalCode = signal;
            child.emit("exit", null, signal);
            child.emit("close", null, signal);
          });
        return true;
      });
      children.push(child);
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("Uvicorn run"));
        child.stderr.emit(
          "data",
          Buffer.from("ning on http://127.0.0.1:18800"),
        );
      });
      return child;
    });
});

const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.shutdown();
  children.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
function setup(browser = true, recording = false, previewEnabled = true) {
  const directory = mkdtempSync(join(tmpdir(), "preview-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const manager = new PreviewManager({
    workDir: directory,
    browscreenUrl: "http://127.0.0.1:18800",
    recordingEnabled: recording,
    previewEnabled,
  });
  managers.push(manager);
  const run = {
    suite_run_id: "run-one",
    lifecycle: "RUNNING",
    resource_quarantined: false,
    instances: [
      {
        case_run_id: "case-one",
        resources: browser ? { browser_context: { state: "exists" } } : {},
      },
    ],
  } as unknown as SuiteRun;
  const emit = vi.fn();
  const context = { directory, deadline: () => Date.now() + 1000, emit };
  manager.sync(run, context);
  const metadata = {
    run_id: "run-one",
    case_run_id: "case-one",
    target_id: "page-one",
    endpoint: "ws://127.0.0.1:9222/devtools/page/page-one",
    browser_endpoint: "http://127.0.0.1:9222",
    published_at: new Date(Date.now() - 1000).toISOString(),
  };
  const publish = (patch = {}) => {
    const value = { ...metadata, ...patch };
    writeFileSync(join(directory, "cdp.json"), JSON.stringify(value));
    writeFileSync(join(directory, ".cdp"), value.endpoint);
  };
  return { directory, manager, run, metadata, publish, emit, context };
}
it("纯API、无CDP和另一运行的CDP都不会请求画面或启用浮窗", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const api = setup(false);
  api.publish();
  expect(await api.manager.state("run-one")).toEqual({ ready: false });
  const browser = setup();
  expect((await browser.manager.state("run-one")).ready).toBe(false);
  browser.publish({ run_id: "run-old" });
  expect((await browser.manager.state("run-one")).ready).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(checkBrowscreen).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  expect(
    JSON.parse(readFileSync(join(browser.directory, "owner.json"), "utf8")),
  ).toMatchObject({ run_id: "run-one" });
});

it("有效 CDP 后只检测一次并直接启动命令；启动参数没有 uv 或源码目录", async () => {
  const value = setup();
  value.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("json/list")
        ? new Response(
            JSON.stringify([
              {
                type: "page",
                id: "page-one",
                webSocketDebuggerUrl: value.metadata.endpoint,
              },
            ]),
          )
        : new Response("等待", { status: 503 }),
    ),
  );
  expect((await value.manager.state("run-one")).ready).toBe(false);
  expect(spawn).toHaveBeenCalledWith(
    "/installed/browscreen",
    [
      "--work-dir",
      value.directory,
      "--host",
      "127.0.0.1",
      "--port",
      "18800",
      "--connect-wait-timeout-s",
      "60",
    ],
    { shell: false, stdio: ["ignore", "ignore", "pipe"] },
  );
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 400);
  await value.manager.state("run-one");
  expect(checkBrowscreen).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("命令失败只向当前浏览器运行提示，不随轮询重试或影响另一运行", async () => {
  const value = setup();
  value.publish();
  vi.mocked(checkBrowscreen).mockResolvedValue({
    ok: false,
    code: "NOT_FOUND",
    message: "未找到 Browscreen",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              type: "page",
              id: "page-one",
              webSocketDebuggerUrl: value.metadata.endpoint,
            },
          ]),
        ),
    ),
  );
  expect(await value.manager.state("run-one")).toMatchObject({
    ready: false,
    failed: true,
    reason: "未找到 Browscreen",
  });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 400);
  await value.manager.state("run-one");
  expect(checkBrowscreen).toHaveBeenCalledTimes(1);
  expect(spawn).not.toHaveBeenCalled();
  expect(await value.manager.state("another-run")).toEqual({ ready: false });
});

it("配置失败只在产生浏览器资源时提示，关闭预览后清除失败原因", async () => {
  const value = setup(false);
  await value.manager.configure(undefined);
  value.manager.unavailable("预览配置失败");
  value.manager.sync(value.run);
  expect(await value.manager.state("run-one")).toEqual({ ready: false });
  value.manager.sync({
    ...value.run,
    instances: [
      {
        ...value.run.instances[0]!,
        resources: { browser_context: { state: "exists" } },
      },
    ],
  });
  expect(await value.manager.state("run-one")).toMatchObject({
    ready: false,
    failed: true,
    reason: "预览配置失败",
  });
  await value.manager.configure(undefined);
  value.manager.sync(value.run);
  expect(await value.manager.state("run-one")).toEqual({ ready: false });
});

it("版本检测晚到不会启动已失去归属的采集进程", async () => {
  const value = setup();
  value.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              type: "page",
              id: "page-one",
              webSocketDebuggerUrl: value.metadata.endpoint,
            },
          ]),
        ),
    ),
  );
  let complete!: (value: any) => void;
  vi.mocked(checkBrowscreen).mockImplementationOnce(
    () =>
      new Promise((done) => {
        complete = done;
      }),
  );
  const pending = value.manager.state("run-one");
  await vi.waitFor(() => expect(checkBrowscreen).toHaveBeenCalledTimes(1));
  value.manager.sync({ ...value.run, suite_run_id: "run-next" });
  complete({ ok: true, executable: "/installed/browscreen" });
  expect(await pending).toEqual({ ready: false });
  expect(spawn).not.toHaveBeenCalled();
});

it("占用端口不会请求未知服务画面，也不会反复启动命令", async () => {
  const value = setup();
  value.publish();
  vi.mocked(createServer).mockImplementationOnce(() => {
    const server: any = new EventEmitter();
    server.unref = () => {};
    server.listen = () =>
      queueMicrotask(() => server.emit("error", { code: "EADDRINUSE" }));
    return server;
  });
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify([
          {
            type: "page",
            id: "page-one",
            webSocketDebuggerUrl: value.metadata.endpoint,
          },
        ]),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await value.manager.state("run-one")).toMatchObject({
    ready: false,
    failed: true,
    reason: expect.stringContaining("端口 18800 已被占用"),
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(spawn).not.toHaveBeenCalled();
});

it("等待首帧的总预算到期后回收自有进程，SIGTERM 不退出时使用 SIGKILL", async () => {
  const value = setup();
  value.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("json/list")
        ? new Response(
            JSON.stringify([
              {
                type: "page",
                id: "page-one",
                webSocketDebuggerUrl: value.metadata.endpoint,
              },
            ]),
          )
        : new Response("等待", { status: 503 }),
    ),
  );
  await value.manager.state("run-one");
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60001);
  expect(await value.manager.state("run-one")).toMatchObject({
    ready: false,
    failed: true,
    reason: expect.stringContaining("超过 60 秒"),
  });
  await value.manager.shutdown();
  expect(children[0].kill).toHaveBeenCalledWith("SIGTERM");
  clock.mockRestore();
  value.manager.sync(value.run);
  value.publish();
  await value.manager.state("run-one");
  const child = children.at(-1);
  child.ignoreTerm = true;
  vi.useFakeTimers();
  const stopped = value.manager.shutdown();
  await vi.advanceTimersByTimeAsync(1500);
  await stopped;
  expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  expect(child.kill).toHaveBeenCalledWith("SIGKILL");
});

it("服务退出或明确采集失败后撤销画面，轮询不重复启动", async () => {
  const value = setup();
  value.publish();
  const fetch = vi.fn(async (url) =>
    String(url).includes("json/list")
      ? new Response(
          JSON.stringify([
            {
              type: "page",
              id: "page-one",
              webSocketDebuggerUrl: value.metadata.endpoint,
            },
          ]),
        )
      : new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
          headers: {
            "X-Frame-Id": "4",
            "X-Capture-Started-At": new Date().toISOString(),
          },
        }),
  );
  vi.stubGlobal("fetch", fetch);
  expect((await value.manager.state("run-one")).ready).toBe(true);
  children[0].exitCode = 1;
  children[0].emit("exit", 1, null);
  children[0].emit("close", 1, null);
  await new Promise((done) => setImmediate(done));
  expect(await value.manager.state("run-one")).toMatchObject({
    ready: false,
    failed: true,
    reason: expect.stringContaining("进程已退出"),
  });
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 400);
  await value.manager.state("run-one");
  expect(spawn).toHaveBeenCalledTimes(1);
  const next = setup();
  next.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("json/list")
        ? new Response(
            JSON.stringify([
              {
                type: "page",
                id: "page-one",
                webSocketDebuggerUrl: next.metadata.endpoint,
              },
            ]),
          )
        : new Response(
            JSON.stringify({ code: "capture_failed", message: "采集异常" }),
            { status: 503 },
          ),
    ),
  );
  expect(await next.manager.state("run-one")).toMatchObject({
    ready: false,
    failed: true,
    reason: expect.stringContaining("采集异常"),
  });
});
it("CDP可达但没有首帧时仍保持关闭；多标签不选错页面", async () => {
  const value = setup();
  value.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("json/list")
        ? new Response(
            JSON.stringify([
              {
                type: "page",
                id: "page-one",
                webSocketDebuggerUrl: value.metadata.endpoint,
              },
            ]),
          )
        : new Response("未就绪", { status: 503 }),
    ),
  );
  expect((await value.manager.state("run-one")).ready).toBe(false);
  const multiple = setup();
  multiple.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              type: "page",
              id: "page-one",
              webSocketDebuggerUrl: multiple.metadata.endpoint,
            },
            { type: "page", id: "page-two" },
          ]),
        ),
    ),
  );
  expect(await multiple.manager.state("run-one")).toMatchObject({
    ready: false,
    reason: "多标签页面暂不启用实时预览",
  });
});
it("正确页面的有效新帧才就绪，结束或下一运行立即撤销画面", async () => {
  const value = setup();
  value.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("json/list")
        ? new Response(
            JSON.stringify([
              {
                type: "page",
                id: "page-one",
                webSocketDebuggerUrl: value.metadata.endpoint,
              },
            ]),
          )
        : new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
            headers: {
              "X-Frame-Id": "3",
              "X-Capture-Started-At": new Date().toISOString(),
            },
          }),
    ),
  );
  expect(await value.manager.state("run-one")).toMatchObject({
    ready: true,
    frame_id: "3",
  });
  value.manager.sync({ ...value.run, lifecycle: "FINISHED" });
  expect(await value.manager.state("run-one")).toEqual({ ready: false });
  expect(await value.manager.screenshot("run-one")).toBeUndefined();
});
it("旧请求晚到不能为新运行发布首帧", async () => {
  const value = setup();
  value.publish();
  let complete: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          complete = done;
        }),
    ),
  );
  const pending = value.manager.state("run-one");
  value.manager.sync({ ...value.run, suite_run_id: "run-next" });
  complete(
    new Response(
      JSON.stringify([
        {
          type: "page",
          id: "page-one",
          webSocketDebuggerUrl: value.metadata.endpoint,
        },
      ]),
    ),
  );
  expect(await pending).toEqual({ ready: false });
});

function frames(t: ReturnType<typeof setup>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("json/list")
        ? new Response(
            JSON.stringify([
              {
                type: "page",
                id: "page-one",
                webSocketDebuggerUrl: t.metadata.endpoint,
              },
            ]),
          )
        : new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
            headers: {
              "X-Frame-Id": "3",
              "X-Capture-Started-At": new Date().toISOString(),
            },
          }),
    ),
  );
}
it("仅录制模式无需页面读取就启动，并且有效首帧也不发布浮窗 ready", async () => {
  const t = setup(true, true, false);
  frames(t);
  t.publish();
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
  expect(vi.mocked(spawn).mock.calls[0][1]).toContain("--record");
  expect(await t.manager.state("run-one")).toMatchObject({ ready: false });
  t.run.instances[0].resources.browser_context!.state = "absent";
  t.manager.sync(t.run, t.context);
  await t.manager.drain("run-one");
  expect(
    t.emit.mock.calls.find((c) => c[0] === "recording_finished")![1],
  ).toMatchObject({ status: "COMPLETE", case_run_id: "case-one" });
});
it("纯接口即使录制开关打开也不启动服务、创建片段或检测依赖", async () => {
  const t = setup(false, true, false);
  t.publish();
  await new Promise((done) => setTimeout(done, 20));
  expect(spawn).not.toHaveBeenCalled();
  expect(checkBrowscreen).not.toHaveBeenCalled();
  expect(t.emit).not.toHaveBeenCalled();
});
it("录像收尾可超过旧的 1.5 秒限制，但超出剩余清理预算必须封存失败", async () => {
  const t = setup(true, true, false);
  t.context.deadline = () => Date.now() + 5000;
  frames(t);
  t.publish();
  await t.manager.state("run-one");
  const child = children.at(-1);
  child.kill.mockImplementation((signal: string) => {
    if (signal === "SIGTERM")
      setTimeout(() => {
        child.stderr.emit(
          "data",
          Buffer.from(`录制完成，视频文件：${child.recordPath}\n`),
        );
        child.signalCode = signal;
        child.emit("close", null, signal);
      }, 2000);
    return true;
  });
  vi.useFakeTimers();
  const stopped = t.manager.finishRun(t.run);
  await vi.advanceTimersByTimeAsync(1500);
  expect(child.kill).not.toHaveBeenCalledWith("SIGKILL");
  await vi.advanceTimersByTimeAsync(500);
  await stopped;
  expect(t.emit.mock.calls.at(-1)![1].status).toBe("COMPLETE");
  vi.useRealTimers();

  const budget = setup(true, true, false);
  budget.context.deadline = () => Date.now() + 800;
  frames(budget);
  budget.publish();
  await budget.manager.state("run-one");
  const stuck = children.at(-1);
  stuck.ignoreTerm = true;
  vi.useFakeTimers();
  const forced = budget.manager.finishRun(budget.run);
  await vi.advanceTimersByTimeAsync(800);
  await forced;
  expect(stuck.kill).toHaveBeenCalledWith("SIGKILL");
  expect(budget.emit.mock.calls.at(-1)![1]).toMatchObject({
    status: "FAILED",
    reason: expect.stringContaining("清理期限"),
  });
});
it("采集进程重建按实例归属保存，上一片段结算不混入下一实例", async () => {
  const t = setup(true, true, true);
  frames(t);
  t.publish();
  await t.manager.state("run-one");
  const next = {
    ...t.run,
    instances: [{ ...t.run.instances[0], case_run_id: "case-next" }],
  };
  t.manager.sync(next, t.context);
  t.publish({ case_run_id: "case-next" });
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
  await t.manager.finishRun(next);
  const records = t.emit.mock.calls
    .filter((c) => c[0] === "recording_finished")
    .map((c) => c[1]);
  expect(records.map((r) => r.case_run_id)).toEqual(["case-one", "case-next"]);
  expect(records[0].relative_path).not.toBe(records[1].relative_path);
});
it("缺少视频依赖只回退一次预览，并提示精确安装命令", async () => {
  const original = vi.mocked(spawn).getMockImplementation()!;
  vi.mocked(spawn).mockImplementation((...args: any[]) => {
    const child: any = original(...(args as never));
    if ((args[1] as string[]).includes("--record")) {
      queueMicrotask(() => {
        child.stderr.emit(
          "data",
          Buffer.from("无法开启视频录制：缺少或无法加载 PyAV 可选依赖。\n"),
        );
        child.exitCode = 1;
        child.emit("close", 1, null);
      });
    }
    return child;
  });
  const t = setup(true, true, true);
  frames(t);
  t.publish();
  // 模拟启动失败时没有服务器就绪日志。
  const ready = vi.mocked(spawn).getMockImplementation()!;
  vi.mocked(spawn).mockImplementation((...args: any[]) => {
    const child: any = ready(...(args as never));
    if ((args[1] as string[]).includes("--record")) {
      const emit = child.stderr.emit.bind(child.stderr);
      child.stderr.emit = (event: string, data: Buffer) =>
        data.toString().includes("Uvicorn") ? true : emit(event, data);
    }
    return child;
  });
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
  expect(vi.mocked(spawn).mock.calls[1][1]).not.toContain("--record");
  expect(await t.manager.state("run-one")).toMatchObject({
    recording_notice: expect.stringContaining("browscreen[video]==0.3.0"),
  });
  await t.manager.finishRun(t.run);
  expect(spawn).toHaveBeenCalledTimes(2);
});
