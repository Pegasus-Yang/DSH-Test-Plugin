/** 旧 DOM 数据格式的工具绑定；来源取自实际调用，不按厂商品牌选择。 */
import type { TestToolCatalog } from "./tool-runtime.js";
import type { ToolRequest } from "./tool-resource.js";
import type { ToolExtract } from "./tool-results.js";
export interface DomToolBinding extends ToolRequest {
  selector_argument?: string;
  attribute_argument?: string;
  index_argument?: string;
  extract: ToolExtract;
  url: ToolExtract;
}

type Entry = ReturnType<TestToolCatalog["snapshot"]>[number];
export function toolSource(entry: Pick<Entry, "name" | "connection">): string {
  return (
    entry.connection?.id ??
    entry.name.match(/^(mcp__.+__)[^_].*$/)?.[1] ??
    entry.name
  );
}
export interface LegacyBrowserTools {
  capture?: string;
  evaluate?: string;
  close?: string;
  screenshot?: string;
}
export function legacyBrowserTools(
  entries: Entry[],
  selected?: string,
): LegacyBrowserTools {
  const source = selected && entries.find((entry) => entry.name === selected);
  if (
    !source &&
    new Set(
      entries
        .filter((entry) => /__browser_(evaluate|capture)$/.test(entry.name))
        .map(toolSource),
    ).size > 1
  )
    return {};
  const candidates = source
    ? entries.filter((entry) => toolSource(entry) === toolSource(source))
    : entries;
  const find = (suffix: string): string | undefined => {
    const matches = candidates.filter((entry) =>
      entry.name.endsWith("__" + suffix),
    );
    return matches.length === 1 ? matches[0]!.name : undefined;
  };
  return {
    capture: find("browser_capture"),
    evaluate: find("browser_evaluate"),
    close: find("browser_close"),
    screenshot: find("browser_take_screenshot"),
  };
}
