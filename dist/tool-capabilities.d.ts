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
export declare function toolSource(entry: Pick<Entry, "name" | "connection">): string;
export interface LegacyBrowserTools {
    capture?: string;
    evaluate?: string;
    close?: string;
    screenshot?: string;
}
export declare function legacyBrowserTools(entries: Entry[], selected?: string): LegacyBrowserTools;
export {};
