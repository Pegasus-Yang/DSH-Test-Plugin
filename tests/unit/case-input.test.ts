import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTextInput,
  parseCases,
  parseParameters,
  substitute,
  loadTextInput,
  loadDataInput,
  fileArgument,
  takePath,
} from "../../src/case-input.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "case-input-"));
  roots.push(root);
  return root;
}

it("TXT兼容BOM与CRLF，忽略空行并保留来源行号", () => {
  const result = parseCases("\uFEFF第一条\r\n\r\n  第二条  \r\n", ".txt");
  expect(result.templates).toEqual([
    { id: "case_1", text: "第一条", line: 1 },
    { id: "case_2", text: "第二条", line: 3 },
  ]);
  expect(() => parseCases(" \n", ".txt")).toThrow("没有找到用例");
});

it("Markdown只拆根列表项，保留嵌套步骤和代码，不把代码中的列表算作用例", () => {
  const text =
    '# 说明\n\n```md\n- 不是用例\n```\n\n- 第一条\n\n  - 子步骤\n\n  ```json\n  {"value":"a,b"}\n  ```\n\n- 第二条\n\n## 另一组\n\n1. 第三条\n2. 第四条\n';
  const result = parseCases(text, ".md");
  expect(result.templates).toHaveLength(4);
  expect(result.templates[0]!.text).toContain("- 子步骤");
  expect(result.templates[0]!.text).toContain('{"value":"a,b"}');
  expect(result.context).toContain("- 不是用例");
  expect(result.context).toContain("另一组");
  expect(() => parseCases("```md\n- 不是用例\n```", ".md")).toThrow(
    "没有找到用例",
  );
  expect(() => parseCases("-\n", ".md")).toThrow("用例为空");
});

it("CSV按标准引号读取逗号、换行、转义引号，保留前导零、空字符串和空格", () => {
  const result = parseParameters(
    '\uFEFF编号,名称,说明\r\n001,"a,b","第一行\n第二行"\r\n002,"a""b",\r\n003, 空格 ,\r\n',
  );
  expect(result.rows).toEqual([
    { 编号: "001", 名称: "a,b", 说明: "第一行\n第二行" },
    { 编号: "002", 名称: 'a"b', 说明: "" },
    { 编号: "003", 名称: " 空格 ", 说明: "" },
  ]);
  expect(parseParameters("a,b\n,\n").rows).toEqual([{ a: "", b: "" }]);
});

it.each([
  "",
  "a,a\n1,2",
  ",b\n1,2",
  "a,b",
  "a,b\n1",
  "a,b\n1,2,3",
  'a\n"unfinished',
])("拒绝无效CSV %j", (text) => {
  expect(() => parseParameters(text)).toThrow();
});

it("按用例优先展开全部数据，单次替换且参数中的列表不改变用例数", () => {
  const source = parseCases(
    "访问${url}，输入${词}并核对${词}\n检查${词}",
    ".txt",
  );
  const result = createTextInput(source, {
    path: "data.csv",
    content:
      'url,词,extra\nhttps://a.test,001,x\nhttps://b.test,"${url}\n- 新列表",y\n',
  });
  expect(result.instances.map((i) => i.id)).toEqual([
    "case_1_row_1",
    "case_1_row_2",
    "case_2_row_1",
    "case_2_row_2",
  ]);
  expect(result.instances[0]!.task).toBe(
    "访问https://a.test，输入001并核对001",
  );
  expect(result.instances[1]!.task).toContain("${url}\n- 新列表");
  expect(result.instances[1]!.parameters.extra).toBe("y");
  expect(() => substitute("${missing}", {})).toThrow("missing");
  expect(substitute("${x}", { x: "$&${x}" })).toBe("$&${x}");
});

it("带引号的路径与任务原文分开处理，文件必须在工作区且快照不随文件变化", () => {
  const root = fixture();
  writeFileSync(join(root, "cases one.txt"), "验证${值}");
  writeFileSync(join(root, "data one.csv"), "值\n001");
  const result = loadDataInput(root, '"data one.csv" --file "cases one.txt"');
  expect(result.instances[0]!.task).toBe("验证001");
  writeFileSync(join(root, "data one.csv"), "值\n999");
  expect(result.rows[0]!.值).toBe("001");
  expect(
    loadDataInput(root, '"data one.csv" 访问${值}').instances[0]!.task,
  ).toBe("访问999");
  const outside = fixture();
  writeFileSync(join(outside, "cases.txt"), "不允许读取的用例");
  symlinkSync(outside, join(root, "outside"));
  expect(() => loadTextInput(root, "outside/cases.txt")).toThrow("工作区");
  expect(() => loadTextInput(root, root)).toThrow("文件");
  expect(fileArgument('"cases one.txt"')).toBe("cases one.txt");
  expect(takePath("'data one.csv' 任务${值}")).toEqual({
    path: "data one.csv",
    rest: "任务${值}",
  });
  expect(() => takePath('"broken')).toThrow("引号");
  expect(() => loadDataInput(root, '"data one.csv"')).toThrow("用法");
  writeFileSync(join(root, "invalid.txt"), Buffer.from([0xff]));
  expect(() => loadTextInput(root, "invalid.txt")).toThrow("UTF-8");
});
