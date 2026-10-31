/** 报告各区域共用的转义、状态和时间格式。 */
import { redact } from "./recorder.js";
import { reportIcons } from "./report-icons.js";
import type { AssertionResult } from "./contracts.js";

export const escape = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export const json = (value: unknown) =>
  escape(JSON.stringify(redact(value), null, 2));
export const labels: Record<string, string> = {
  PASS: "通过",
  SUCCEEDED: "完成",
  FAIL: "失败",
  ERROR: "执行异常",
  BLOCKED: "阻塞",
  SKIPPED: "跳过",
  CANCELLED: "已取消",
  INCONCLUSIVE: "结论不足",
  RUNNING: "运行中",
  PENDING: "待执行",
  WAITING_APPROVAL: "待审批",
};
export const badge = (status: string, label = labels[status] ?? status) =>
  `<span class="badge ${escape(status)}" title="${escape(status)}">${escape(label)}</span>`;
export const icon = (name: keyof typeof reportIcons, className = "icon") =>
  `<img class="${className}" src="${reportIcons[name]}" alt="" aria-hidden="true">`;
export const duration = (ms: number) =>
  !Number.isFinite(ms) || ms < 0
    ? "—"
    : ms >= 60000
      ? `${Math.floor(ms / 60000)}分${Math.round((ms % 60000) / 1000)}秒`
      : `${(ms / 1000).toFixed(1)}秒`;

export const checkReason = (result: AssertionResult): string =>
  result.status === "ERROR" &&
  result.reason === "range需要数字、上下界、单位和容差"
    ? "范围比较参数不完整，本次检查未能得出结论。"
    : result.reason;
