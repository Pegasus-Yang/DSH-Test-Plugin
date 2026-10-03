/** 静态报告索引和受宿主登录保护的只读HTTP访问。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, sep, extname } from "node:path";
import type { SuiteRun } from "./contracts.js";
import { statistics } from "./contracts.js";

export const reportPrefix = "/test-reports";
export class ReportAccess {
  private selected?: { run: SuiteRun; filename: string; settled: boolean };
  constructor(readonly outputRoot: string) {
    for (const id of readdirSync(outputRoot)
      .filter((n) => /^run-[\w-]+$/.test(n))
      .sort()
      .reverse()) {
      try {
        const run = JSON.parse(
          readFileSync(join(outputRoot, id, "results.json"), "utf8"),
        ) as SuiteRun;
        if (
          run.suite_run_id === id &&
          run.lifecycle === "FINISHED" &&
          existsSync(join(outputRoot, id, "report.html"))
        ) {
          this.select(run);
          break;
        }
      } catch {
        /* 损坏记录不作为可浏览的最近报告。 */
      }
    }
  }
  select(run: SuiteRun, filename = "report.html", settled = true): void {
    this.selected = { run, filename, settled };
  }
  finish(run: SuiteRun): void {
    if (this.selected?.run.suite_run_id === run.suite_run_id)
      this.selected.settled = true;
  }
  get latestId(): string | undefined {
    return this.selected?.run.suite_run_id;
  }
  url(id: string, filename = "report.html"): string {
    return `./test-reports/${encodeURIComponent(id)}/${filename}`;
  }
  state() {
    if (!this.selected) return null;
    const { run, filename, settled } = this.selected;
    const path = join(this.outputRoot, run.suite_run_id, filename);
    const ready = settled && existsSync(path);
    const counts = statistics(run);
    const labels: Record<string, string> = {
      total: "共",
      PASS: "通过",
      FAIL: "失败",
      ERROR: "错误",
      BLOCKED: "阻塞",
      INCONCLUSIVE: "结论不足",
      CANCELLED: "已取消",
      RUNNING: "运行中",
      PENDING: "等待中",
    };
    return {
      run_id: run.suite_run_id,
      lifecycle: settled ? "FINISHED" : run.lifecycle,
      title: !settled
        ? "测试运行中"
        : ready
          ? "测试完成 · 报告已生成"
          : "测试已结束 · 报告生成失败",
      summary: Object.entries(counts)
        .map(([k, v]) => `${labels[k] ?? k} ${v} 项`)
        .join(" · "),
      path,
      ready,
      url: this.url(run.suite_run_id, filename),
    };
  }
  /** 仅在外层完成宿主认证后调用；拒绝目录、符号链接逃逸与写请求。 */
  serve(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD"].includes(req.method ?? "")) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://local").pathname,
      );
      if (pathname === reportPrefix + "/status") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          req.method === "HEAD" ? undefined : JSON.stringify(this.state()),
        );
        return;
      }
      const suffix = pathname.slice(reportPrefix.length + 1);
      if (
        !pathname.startsWith(reportPrefix + "/") ||
        !/^run-[\w-]+\/(?:report(?:-rebuilt)?\.html|results(?:-rebuilt)?\.json|plan\.json|events\.jsonl|evidence\/[\w.-]+)$/.test(
          suffix,
        )
      )
        throw new Error("不支持的报告路径");
      const target = realpathSync(join(this.outputRoot, suffix));
      const rel = relative(realpathSync(this.outputRoot), target);
      if (
        rel === ".." ||
        rel.startsWith(".." + sep) ||
        !statSync(target).isFile()
      )
        throw new Error("路径逃逸");
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".jsonl": "text/plain; charset=utf-8",
        ".png": "image/png",
      };
      res.setHeader(
        "Content-Type",
        types[extname(target)] ?? "application/octet-stream",
      );
      if (extname(target) === ".html")
        res.setHeader(
          "Content-Security-Policy",
          "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:",
        );
      res.end(req.method === "HEAD" ? undefined : readFileSync(target));
    } catch {
      res.writeHead(404);
      res.end("报告或附件不存在");
    }
  }
}
