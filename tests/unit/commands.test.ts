import { it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
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
  let runner!: NativeTests;
  apply(
    {
      provide: (_name: string, value: NativeTests) => {
        runner = value;
      },
      inject: () => {},
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
  const execute = (name: string, rawInput: string) =>
    commands.get(name)!.handler({ rawInput } as never);
  return { root, commands, execute, runner };
}

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
