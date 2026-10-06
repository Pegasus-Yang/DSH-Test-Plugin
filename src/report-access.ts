/** 静态报告索引和受宿主登录保护的只读HTTP访问。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  createReadStream,
} from "node:fs";
import { join, relative, sep, extname } from "node:path";
import type { SuiteRun } from "./contracts.js";
import { statistics } from "./contracts.js";

export const reportPrefix = "/test-reports";
export class ReportAccess {
  origin?: () => string;
  private mediaKey = randomBytes(32);
  private fileToken(path: string, expires: number): string {
    return createHmac("sha256", this.mediaKey)
      .update(`${path}:${expires}`)
      .digest("hex");
  }
  /** 已认证报告签发单个录像、账本或手工用例票据，兼容严格 Cookie。 */
  authorizeFile(req: IncomingMessage): boolean {
    if (!["GET", "HEAD"].includes(req.method ?? "")) return false;
    try {
      const url = new URL(req.url ?? "/", "http://local");
      if (
        !/^\/test-reports\/run-[\w-]+\/(?:evidence\/browser-[\w-]+\.mp4|events\.jsonl(?:\.gz)?|manual-cases(?:-[1-9]\d*)?(?:-rebuilt)?\.md)$/.test(
          url.pathname,
        )
      )
        return false;
      const token = url.searchParams.get("media")?.split(".");
      if (
        !token ||
        token.length !== 2 ||
        !/^\d+$/.test(token[0]!) ||
        !/^[a-f0-9]{64}$/.test(token[1]!)
      )
        return false;
      const expiry = Number(token[0]);
      return (
        expiry > Date.now() &&
        expiry <= Date.now() + 86400000 &&
        timingSafeEqual(
          Buffer.from(token[1]!, "hex"),
          Buffer.from(this.fileToken(url.pathname, expiry), "hex"),
        )
      );
    } catch {
      return false;
    }
  }
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
    const path = `/test-reports/${encodeURIComponent(id)}/${filename}`;
    return this.origin ? new URL(path, this.origin()).href : `.${path}`;
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
        !/^run-[\w-]+\/(?:report(?:-rebuilt)?\.html|results(?:-rebuilt)?\.json|actual-steps(?:-rebuilt)?\.json|manual-cases(?:-[1-9]\d*)?(?:-rebuilt)?\.md|plan\.json|events\.jsonl(?:\.gz)?|evidence\/[\w.-]+)$/.test(
          suffix,
        )
      )
        throw new Error("不支持的报告路径");
      const target = realpathSync(join(this.outputRoot, suffix));
      const rel = relative(realpathSync(this.outputRoot), target);
      const runRel = relative(
        realpathSync(join(this.outputRoot, suffix.split("/")[0]!)),
        target,
      );
      if (
        rel === ".." ||
        rel.startsWith(".." + sep) ||
        runRel === ".." ||
        runRel.startsWith(".." + sep) ||
        !statSync(target).isFile()
      )
        throw new Error("路径逃逸");
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".jsonl": "text/plain; charset=utf-8",
        ".png": "image/png",
        ".mp4": "video/mp4",
        ".md": "text/markdown; charset=utf-8",
        ".gz": "application/gzip",
      };
      res.setHeader(
        "Content-Type",
        types[extname(target)] ?? "application/octet-stream",
      );
      if (extname(target) === ".md" || /events\.jsonl(?:\.gz)?$/.test(target))
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${target.split(sep).at(-1)}"`,
        );
      if (extname(target) === ".html")
        res.setHeader(
          "Content-Security-Policy",
          "sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'",
        );
      if (extname(target) === ".mp4") {
        const size = statSync(target).size;
        if (
          new URL(req.url!, "http://local").searchParams.get("download") === "1"
        )
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${suffix.split("/").at(-1)}"`,
          );
        res.setHeader("Accept-Ranges", "bytes");
        let start = 0,
          end = size - 1;
        const range = req.headers?.range;
        if (range && req.method !== "HEAD") {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (match && (match[1] || match[2])) {
            if (match[1]) {
              start = Number(match[1]);
              if (match[2]) end = Math.min(end, Number(match[2]));
            } else start = Math.max(0, size - Number(match[2]));
            if (
              !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(end) ||
              start > end ||
              start >= size ||
              (Number(match[2]) === 0 && !match[1])
            ) {
              res.writeHead(416, { "Content-Range": `bytes */${size}` });
              res.end();
              return;
            }
            res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
            res.statusCode = 206;
          }
        }
        res.setHeader("Content-Length", Math.max(0, end - start + 1));
        if (req.method === "HEAD" || !size) res.end();
        else {
          const stream = createReadStream(target, { start, end });
          res.once("close", () => stream.destroy());
          stream.on("error", () => res.destroy());
          stream.pipe(res);
        }
        return;
      }
      if (extname(target) !== ".html")
        res.setHeader("Content-Length", statSync(target).size);
      if (req.method === "HEAD") res.end();
      else if (extname(target) === ".html") {
        const base = pathname.slice(0, pathname.lastIndexOf("/") + 1);
        const html = readFileSync(target, "utf8").replace(
          /(src|href)="(evidence\/browser-[\w-]+\.mp4|events\.jsonl(?:\.gz)?|manual-cases(?:-[1-9]\d*)?(?:-rebuilt)?\.md)(\?download=1)?"/g,
          (_match, attribute, file: string, download: string) => {
            const expires = Date.now() + 86400000;
            if (!existsSync(join(target, "..", file))) return _match;
            return `${attribute}="${file}?${download ? "download=1&amp;" : ""}media=${expires}.${this.fileToken(base + file, expires)}"`;
          },
        );
        res.end(html);
      } else {
        res.setHeader("Content-Length", statSync(target).size);
        const stream = createReadStream(target);
        res.once("close", () => stream.destroy());
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      }
    } catch {
      res.writeHead(404);
      res.end("报告或附件不存在");
    }
  }
}
