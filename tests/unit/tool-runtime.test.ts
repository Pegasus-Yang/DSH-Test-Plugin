import { expect, it } from "vitest";
import type { ToolRuntime } from "@deepseek-ai/dsh-tools";
import { TestToolCatalog, toolArguments } from "../../src/tool-runtime.js";

it("任意工具名称可进入目录，控制工具及专有生命周期不作为业务入口", () => {
  const entries = new Map(
    [
      "mcp__custom__go_to",
      "plain_tool",
      "test_capture",
      "ask_user_question",
      "reserved",
    ].map((name) => [
      name,
      { name, description: "工具", parameters: { type: "object" } },
    ]),
  );
  const runtime = {
    schemas: () => [...entries.values()],
    get: (name: string) => entries.get(name),
  } as unknown as ToolRuntime;
  const catalog = new TestToolCatalog(runtime, ["reserved"]);
  expect(catalog.names()).toEqual(["mcp__custom__go_to", "plain_tool"]);
  catalog.assert("plain_tool");
  expect(() => catalog.assert("test_capture")).toThrow("目录");
  entries.set("plain_tool", { ...entries.get("plain_tool")! });
  expect(() => catalog.assert("plain_tool")).toThrow("改变");
});
it("目录保存Schema摘要，拒绝同一对象中被修改的定义", () => {
  const tool = {
    name: "custom",
    description: "读取",
    parameters: { type: "object" },
  };
  const catalog = new TestToolCatalog({
    schemas: () => [tool],
    get: () => tool,
  } as unknown as ToolRuntime);
  expect(catalog.snapshot()[0]!.digest).toMatch(/^[a-f0-9]{64}$/);
  tool.description = "写入";
  expect(() => catalog.assert("custom")).toThrow("改变");
});
it("目录和后续校验使用同一 Agent 视图，包含作用域工具并排除不可见全局工具", () => {
  const scope = {} as Parameters<ToolRuntime["schemas"]>[0];
  const own = {
    name: "mcp__runbridge__browser_navigate",
    description: "Agent 内工具",
    parameters: { type: "object" },
  };
  const global = { ...own, name: "global_hidden" };
  let active = true;
  const runtime = {
    schemas: (viewer: unknown) => (viewer === scope ? [own] : [global]),
    get: (name: string, viewer: unknown) =>
      viewer === scope && active && name === own.name ? own : undefined,
  } as unknown as ToolRuntime;
  const catalog = new TestToolCatalog(runtime, [], [], undefined, scope);
  expect(catalog.names()).toEqual([own.name]);
  catalog.assert(own.name);
  expect(catalog.has(global.name)).toBe(false);
  active = false;
  expect(() => catalog.assert(own.name)).toThrow("目录");
});

it("参数字符串只解释JSON且必须恰选一个对象入口", () => {
  expect(toolArguments({ arguments_json: '{"x":[1,{"y":true}]}' })).toEqual({
    x: [1, { y: true }],
  });
  for (const input of [
    {},
    { arguments: {}, arguments_json: "{}" },
    { arguments_json: "process.exit()" },
    { arguments_json: "[]" },
  ])
    expect(() => toolArguments(input)).toThrow();
});
