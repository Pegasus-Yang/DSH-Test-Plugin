/** Playwright MCP 的公开页面初始化扩展，只交付当前测试页面的 CDP。 */
import type { Page } from "playwright";
export interface PreviewOwner {
    run_id: string;
    case_run_id: string;
}
export interface PublishedCdp extends PreviewOwner {
    target_id: string;
    endpoint: string;
    browser_endpoint: string;
    published_at: string;
}
/** 初始化扩展失败仅禁用画面，不改变 MCP 的业务操作。 */
export default function publishPage({ page, }: {
    page: Page;
}): Promise<void>;
