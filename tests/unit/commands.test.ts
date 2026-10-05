import { it, expect, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { NativeTests } from "../../src/native-test.js";
import { apply } from "../../src/index.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function setup(authorized = true) {
  const root = mkdtempSync(join(tmpdir(), "test-commands-"));
  roots.push(root);
  type Definition = Parameters<Context["commands"]["register"]>[0];
  const commands = new Map<string, Definition>();
  const routes = new Map<string, any>();
  const agents = new Map<string, unknown>();
  const withInitiator = vi.fn((_agent: unknown, operation: () => unknown) =>
    operation(),
  );
  let runner!: NativeTests;
  apply(
    {
      provide: (_name: string, value: NativeTests) => {
        runner = value;
      },
      inject: (keys: string[], effect: Function) => {
        if (keys.includes("webServer"))
          effect({
            effect: (fn: () => unknown) => fn(),
            connection: { authorizeIndex: () => authorized },
            agents: { get: (id: string) => agents.get(id), withInitiator },
            webServer: {
              port: 3080,
              register: (route: any) => {
                routes.set(route.path, route.handler);
                return () => {};
              },
            },
          });
      },
      effect: (fn: () => unknown) => fn(),
      commands: {
        register: (command: Definition) => {
          commands.set(command.name, command);
          return () => {};
        },
      },
    } as unknown as Context,
    { workspace: root, outputRoot: join(root, "runs") },
  );
  const execute = (name: string, rawInput: string, agent?: unknown) =>
    commands.get(name)!.handler({
      rawInput,
      agent,
      signal: new AbortController().signal,
    } as never);
  return { root, commands, execute, runner, routes, agents, withInitiator };
}

function uiRequest(t: ReturnType<typeof setup>, action: string, body: object) {
  const req = Object.assign(new PassThrough(), {
    method: "POST",
    url: `/test-ui/${action}`,
  });
  const res: any = new EventEmitter();
  res.setHeader = () => {};
  res.writeHead = () => {};
  return new Promise<any>((done) => {
    res.end = (value: string) => done(JSON.parse(value));
    t.routes.get("/test-ui")(req, res);
    req.end(JSON.stringify(body));
  });
}

it("设置恢复复用所选对话的已有 Agent 和原生发起者上下文，不创建执行会话", async () => {
  const t = setup();
  const agent = { id: "origin", status: "idle" };
  t.agents.set("origin", agent);
  const recover = vi
    .spyOn(t.runner.recovery, "recover")
    .mockResolvedValue("已释放");
  const token = "a".repeat(64);
  expect(
    await uiRequest(t, "recover", { session_id: "origin", token }),
  ).toEqual({ ok: true, value: "已释放" });
  expect(t.withInitiator).toHaveBeenCalledWith(agent, expect.any(Function));
  expect(recover).toHaveBeenCalledWith(agent, token, expect.any(AbortSignal));
  expect(
    (await uiRequest(t, "recover", { session_id: "missing", token })).ok,
  ).toBe(false);
  expect(recover).toHaveBeenCalledTimes(1);
});

it("界面操作沿用宿主认证，未授权不能读取参数或触发写入", () => {
  const t = setup(false);
  const touched = vi.fn();
  t.routes.get("/test-ui")(
    { method: "POST", url: "/test-ui/release", on: touched, once: touched },
    { setHeader: touched, end: touched },
  );
  expect(touched).not.toHaveBeenCalled();
});

it("界面证据文件保持工作区边界，不能通过符号链接引用外部文件", async () => {
  const t = setup();
  symlinkSync(tmpdir(), join(t.root, "outside"));
  const release = vi.spyOn(t.runner.recovery, "release");
  expect(
    await uiRequest(t, "release", {
      evidence_file: "outside",
      token: "a".repeat(64),
    }),
  ).toMatchObject({
    ok: false,
    message: expect.stringContaining("输入文件必须位于项目工作区"),
  });
  expect(release).not.toHaveBeenCalled();
});

it("安装检测路由继承宿主认证，未授权请求不能触发探测", () => {
  const t = setup(false);
  let touched = false;
  t.routes.get("/test-preview-settings")(
    { method: "POST", url: "/test-preview-settings/check" },
    {
      setHeader: () => {
        touched = true;
      },
      end: () => {
        touched = true;
      },
    },
  );
  expect(touched).toBe(false);
});

it("新会话没有运行记录时也能读取隔离；启动错误明确说明原因和处理入口", async () => {
  const t = setup();
  const directory = join(t.root, "runs/run-old");
  mkdirSync(directory);
  writeFileSync(
    join(directory, "results.json"),
    JSON.stringify({
      suite_run_id: "run-old",
      instances: [{ resources: { browser_context: { state: "exists" } } }],
    }),
  );
  writeFileSync(
    join(t.root, "runs/quarantine.json"),
    JSON.stringify({
      created_at: new Date(Date.now() - 120000).toISOString(),
      details: { run_id: "run-old", reason: "浏览器释放未获确认" },
    }),
  );
  let body = "";
  const writeHead = () => {};
  t.routes.get("/test-recovery")(
    { method: "GET", url: "/test-recovery" },
    {
      writeHead,
      end: (value: string) => {
        body = value;
      },
    },
  );
  expect(JSON.parse(body).quarantine).toMatchObject({
    run_id: "run-old",
    overdue: true,
    can_recover: true,
  });
  expect(
    await t.execute("test", "访问页面并断言点赞不为0", {
      id: "new",
      status: "idle",
    }),
  ).toMatchObject({
    kind: "error",
    text: expect.stringContaining("设置 → 测试插件 → 测试环境"),
  });
  expect(t.runner.sessions.size).toBe(0);
});

it("隔离读取路由不能以POST请求直接释放", () => {
  const t = setup();
  const codes: number[] = [];
  t.routes.get("/test-recovery")(
    { method: "POST", url: "/test-recovery" },
    { writeHead: (code: number) => codes.push(code), end: () => {} },
  );
  expect(codes).toEqual([405]);
});

it("向网页声明参数输入，菜单选择后等待参数，带参数提交仍属于命令", () => {
  const { commands } = setup();
  expect([...commands.keys()]).toEqual([
    "test",
    "test-plan",
    "test-run",
    "test-data",
  ]);
  for (const name of commands.keys())
    expect(commands.get(name)?.input?.hint).toBeTruthy();
});

it.each([
  "",
  "   ",
  ".",
  "missing.json",
  "访问ceshiren.com，搜索 agent，断言点赞数不为0",
])(
  "/test-run 输入 %j 时提示JSON路径与自然语言入口，不启动运行",
  async (input) => {
    const { execute, runner } = setup();
    const result = await execute("test-run", input);
    expect(result).toMatchObject({
      kind: "error",
      text: expect.stringContaining("/test <任务描述>"),
    });
    expect(runner.sessions.size).toBe(0);
  },
);

it("保留路径边界与JSON解析错误，不把错误改为运行成功", async () => {
  const { root, execute, runner } = setup();
  symlinkSync(tmpdir(), join(root, "outside"));
  expect(await execute("test-run", "outside")).toMatchObject({
    kind: "error",
    text: expect.stringContaining("输入文件必须位于项目工作区"),
  });
  writeFileSync(join(root, "broken.json"), "{broken");
  expect(await execute("test-run", "broken.json")).toMatchObject({
    kind: "error",
    text: expect.stringContaining("SyntaxError"),
  });
  expect(runner.sessions.size).toBe(0);
});

it("TXT与Markdown入口直接规划，文件审核和CSV入口强制原生审核", async () => {
  const { root, execute, runner, commands } = setup();
  const { vi } = await import("vitest");
  const start = vi.spyOn(runner, "start").mockResolvedValue("已接收");
  writeFileSync(join(root, "cases one.txt"), "检查${值}\n再次检查${值}");
  writeFileSync(join(root, "cases.md"), "- 检查${值}\n- 再次检查${值}");
  writeFileSync(join(root, "data.csv"), "值\n001\n002");
  await execute("test-run", '"cases one.txt"');
  expect(start.mock.calls.at(-1)![3]).toBe(false);
  expect(start.mock.calls.at(-1)![4]!.instances).toHaveLength(2);
  await execute("test-plan", "--file cases.md");
  expect(start.mock.calls.at(-1)![3]).toBe(true);
  await execute("test-data", "data.csv --file cases.md");
  expect(start.mock.calls.at(-1)![3]).toBe(true);
  expect(start.mock.calls.at(-1)![4]!.instances).toHaveLength(4);
  expect(commands.get("test-data")!.input?.hint).toBeTruthy();
  start.mockClear();
  expect(await execute("test-data", "data.csv 检查${missing}")).toMatchObject({
    kind: "error",
  });
  expect(start).not.toHaveBeenCalled();
});
