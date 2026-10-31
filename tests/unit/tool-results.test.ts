import { expect, it } from "vitest";
import type { ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { extractToolResult, jsonPointer } from "../../src/tool-results.js";
const result = (value: unknown, text = ""): ToolExecutionResult =>
  ({
    value,
    isError: false,
    content: [{ type: "text", text }],
  }) as ToolExecutionResult;

it("从实际结构化字段保留0、false和null，按RFC6901读取特殊键", () => {
  const r = result({ structuredContent: { "a/b": { "~": [0, false, null] } } });
  expect(
    extractToolResult(r, { from: "structured", pointer: "/a~1b/~0/0" }),
  ).toBe(0);
  expect(
    extractToolResult(r, { from: "structured", pointer: "/a~1b/~0/1" }),
  ).toBe(false);
  expect(
    extractToolResult(r, { from: "structured", pointer: "/a~1b/~0/2" }),
  ).toBeNull();
  expect(() => jsonPointer({}, "/constructor")).toThrow("缺少字段");
  expect(() => jsonPointer({}, "/~2")).toThrow("Pointer");
});
it("纯JSON、完整代码块和旧包装使用明确的不同提取方式", () => {
  for (const text of ['{"count":1}', '```json\n{"count":1}\n```'])
    expect(
      extractToolResult(result({ content: [{ type: "text", text }] }), {
        from: "json",
        pointer: "/count",
      }),
    ).toBe(1);
  const r = result({
    content: [
      { type: "text", text: '### Result\n{"count":1}\n### Snapshot\n其他文字' },
    ],
  });
  expect(
    extractToolResult(r, { from: "playwright-result", pointer: "/count" }),
  ).toBe(1);
  expect(() =>
    extractToolResult(r, { from: "json", pointer: "/count" }),
  ).toThrow();
});
it("只读取指定内容块，不扫描其他块寻找符合预期的值", () => {
  const r = result({
    content: [
      { type: "text", text: "不是JSON" },
      { type: "text", text: '{"value":1}' },
    ],
  });
  expect(() =>
    extractToolResult(r, { from: "json", pointer: "/value" }),
  ).toThrow();
  expect(
    extractToolResult(r, { from: "json", block: 1, pointer: "/value" }),
  ).toBe(1);
  expect(() =>
    extractToolResult(result({ content: [{ type: "image", data: "0" }] }), {
      from: "text",
    }),
  ).toThrow("不是文本");
});
it("文本分隔必须唯一，类型转换拒绝空白、单位、隐式真值和非有限数", () => {
  expect(
    extractToolResult(result({}, "计数：1 个"), {
      from: "text",
      between: { after: "计数：", before: " 个" },
      type: "number",
    }),
  ).toBe(1);
  expect(() =>
    extractToolResult(result({}, "计数：1 个；计数：2 个"), {
      from: "text",
      between: { after: "计数：", before: " 个" },
      type: "number",
    }),
  ).toThrow("唯一");
  for (const value of ["", " ", "1个", "Infinity", "1e999", "0x1"])
    expect(() =>
      extractToolResult(result(value), { from: "value", type: "number" }),
    ).toThrow("数值");
  expect(() =>
    extractToolResult(result("false "), { from: "value", type: "boolean" }),
  ).toThrow("布尔");
  expect(
    extractToolResult(result("false"), { from: "value", type: "boolean" }),
  ).toBe(false);
});
it("传输成功不能掩盖MCP内层失败，缺失字段和类型不符不能成为观察", () => {
  expect(() =>
    extractToolResult(
      result({ isError: true, content: [], structuredContent: { value: 1 } }),
      { from: "structured", pointer: "/value" },
    ),
  ).toThrow("失败");
  expect(() =>
    extractToolResult(
      { isError: true, error: { message: "拒绝" }, content: [] },
      { from: "value" },
    ),
  ).toThrow("失败");
  expect(() => extractToolResult(result({}), { from: "structured" })).toThrow(
    "structuredContent",
  );
  expect(() =>
    extractToolResult(result({}), { from: "value", pointer: "/missing" }),
  ).toThrow("缺少字段");
  expect(() =>
    extractToolResult(result([]), { from: "value", type: "object" }),
  ).toThrow("类型");
});

it("普通业务对象的isError字段可作为实际值，不冒充MCP协议错误", () => {
  expect(
    extractToolResult(result({ isError: true, count: 0 }), {
      from: "value",
      pointer: "/isError",
      type: "boolean",
    }),
  ).toBe(true);
});
