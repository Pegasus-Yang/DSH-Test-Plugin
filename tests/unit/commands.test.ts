import { it, expect, afterEach } from "vitest";
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
function setup() {
  const root = mkdtempSync(join(tmpdir(), "test-commands-"));
  roots.push(root);
  type Definition = Parameters<Context["commands"]["register"]>[0];
  const commands = new Map<string, Definition>();
  const routes = new Map<string, any>();
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
            connection: { authorizeIndex: () => true },
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
    commands
      .get(name)!
      .handler({
        rawInput,
        agent,
        signal: new AbortController().signal,
      } as never);
  return { root, commands, execute, runner, routes };
}

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
  expect(
    await t.execute("test-recover", "", { id: "new", status: "idle" }),
  ).toMatchObject({ kind: "error", text: expect.stringContaining("确认") });
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
  for (const name of ["test", "test-plan", "test-run", "test-report"])
    expect(commands.get(name)?.input?.hint).toBeTruthy();
  for (const name of ["test-status", "test-stop"])
    expect(commands.get(name)?.input).toBeUndefined();
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
