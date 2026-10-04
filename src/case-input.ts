/** 确定性读取用例边界与参数；文件内容只作为任务材料，不执行表达式。 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { parse } from "csv-parse/sync";

export interface InputFile {
  path: string;
  content: string;
}
export interface CaseTemplate {
  id: string;
  text: string;
  line: number;
}
export interface TextInstance {
  id: string;
  template_id: string;
  case_number: number;
  data_row?: number;
  parameters: Record<string, string>;
  task: string;
}
export interface TextInput {
  case_file?: InputFile;
  csv_file?: InputFile;
  context: string;
  templates: CaseTemplate[];
  headers: string[];
  rows: Record<string, string>[];
  instances: TextInstance[];
}

export function workspaceFile(workspace: string, input: string): string {
  const full = realpathSync(resolve(workspace, input));
  const rel = relative(realpathSync(workspace), full);
  if (rel === ".." || rel.startsWith(".." + sep))
    throw new Error("输入文件必须位于项目工作区");
  if (!statSync(full).isFile()) throw new Error("输入路径必须是文件");
  return full;
}
function readInput(workspace: string, path: string): InputFile {
  const full = workspaceFile(workspace, path);
  try {
    return {
      path: full,
      content: new TextDecoder("utf-8", { fatal: true }).decode(
        readFileSync(full),
      ),
    };
  } catch (error) {
    if (error instanceof TypeError)
      throw new Error("输入文件必须使用UTF-8编码：" + path);
    throw error;
  }
}

export function parseCases(content: string, extension: string) {
  const source = content.replace(/^\uFEFF/, "");
  const templates: CaseTemplate[] = [];
  let context = "";
  const add = (text: string, line: number) => {
    if (!text.trim()) throw new Error(`第${line}行用例为空`);
    templates.push({
      id: `case_${templates.length + 1}`,
      text: text.trim(),
      line,
    });
  };
  if (extension === ".txt") {
    source.split(/\r\n|\n|\r/).forEach((text, index) => {
      if (text.trim()) add(text, index + 1);
    });
  } else if ([".md", ".markdown"].includes(extension)) {
    const tree = fromMarkdown(source);
    const background: string[] = [];
    for (const node of tree.children) {
      if (node.type !== "list") {
        background.push(
          source.slice(node.position!.start.offset, node.position!.end.offset),
        );
        continue;
      }
      for (const item of node.children) {
        // 保留列表项的原始结构，包含嵌套列表、表格及代码块。
        if (!item.children.length)
          throw new Error(`第${item.position!.start.line}行用例为空`);
        add(
          source.slice(item.position!.start.offset, item.position!.end.offset),
          item.position!.start.line,
        );
      }
    }
    context = background.join("\n\n");
  } else throw new Error("文字用例文件仅支持.txt、.md或.markdown");
  if (!templates.length)
    throw new Error(
      "没有找到用例：TXT每个非空行一条，Markdown每个最外层列表项一条",
    );
  return { templates, context };
}

export function parseParameters(content: string) {
  let records: string[][];
  try {
    records = parse(content, { bom: true, skip_empty_lines: true });
  } catch (error) {
    throw new Error(
      "CSV格式错误（检查引号和每行列数）：" + (error as Error).message,
    );
  }
  const headers = records.shift()?.map((value) => value.trim()) ?? [];
  if (!headers.length || headers.some((value) => !value))
    throw new Error("CSV表头不能为空");
  if (new Set(headers).size !== headers.length)
    throw new Error("CSV参数名重复");
  if (!records.length) throw new Error("CSV至少需要一条数据记录");
  const rows = records.map((record, index) => {
    if (record.length !== headers.length)
      throw new Error(`CSV数据行${index + 1}列数与表头不一致`);
    return Object.fromEntries(headers.map((header, n) => [header, record[n]!]));
  });
  return { headers, rows };
}

export function substitute(
  template: string,
  parameters: Record<string, string>,
): string {
  return template.replace(/\$\{([^{}]+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(parameters, key))
      throw new Error("CSV缺少模板参数列：" + key);
    return parameters[key]!;
  });
}

export function createTextInput(
  source: { templates: CaseTemplate[]; context: string; case_file?: InputFile },
  csv_file?: InputFile,
): TextInput {
  const { headers, rows } = csv_file
    ? parseParameters(csv_file.content)
    : { headers: [], rows: [] };
  const instances = source.templates.flatMap((item, index) => {
    const task = [source.context, item.text].filter(Boolean).join("\n\n");
    return (csv_file ? rows : [{}]).map((parameters, row) => ({
      id: csv_file ? `${item.id}_row_${row + 1}` : item.id,
      template_id: item.id,
      case_number: index + 1,
      ...(csv_file ? { data_row: row + 1 } : {}),
      parameters: structuredClone(parameters),
      task: csv_file ? substitute(task, parameters) : task,
    }));
  });
  return {
    ...source,
    ...(csv_file ? { csv_file } : {}),
    headers,
    rows,
    instances,
  };
}

export function loadTextInput(workspace: string, file: string): TextInput {
  const case_file = readInput(workspace, file);
  return createTextInput({
    ...parseCases(case_file.content, extname(file).toLowerCase()),
    case_file,
  });
}

/** 仅对路径识别引号；余下的任务文字不做shell解析。 */
export function takePath(input: string): { path: string; rest: string } {
  const text = input.trimStart();
  if (!text) throw new Error("请提供文件路径");
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    if (end < 0 || (text[end + 1] && !/\s/.test(text[end + 1]!)))
      throw new Error("路径引号未正确闭合");
    return { path: text.slice(1, end), rest: text.slice(end + 1).trim() };
  }
  const match = /^(\S+)([\s\S]*)$/.exec(text)!;
  return { path: match[1]!, rest: match[2]!.trim() };
}
export function fileArgument(input: string): string {
  if (/^["']/.test(input.trim())) {
    const { path, rest } = takePath(input);
    if (rest)
      throw new Error("文件路径后不能再追加任务；含空格的路径请整体加引号");
    return path;
  }
  return input.trim();
}
export function loadDataInput(workspace: string, input: string): TextInput {
  const { path, rest } = takePath(input);
  if (extname(path).toLowerCase() !== ".csv")
    throw new Error("参数文件必须是.csv");
  if (!rest || rest === "--file")
    throw new Error(
      "用法：/test-data data.csv <任务模板> 或 /test-data data.csv --file cases.md",
    );
  const csv_file = readInput(workspace, path);
  const file = /^--file\s+([\s\S]+)$/.exec(rest);
  const source = file
    ? loadTextInput(workspace, fileArgument(file[1]!))
    : { templates: [{ id: "case_1", text: rest, line: 1 }], context: "" };
  return createTextInput(
    {
      templates: source.templates,
      context: source.context,
      ...("case_file" in source ? { case_file: source.case_file } : {}),
    },
    csv_file,
  );
}
