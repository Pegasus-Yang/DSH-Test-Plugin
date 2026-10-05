import { existsSync, readFileSync, readdirSync, realpathSync, statSync, } from "node:fs";
import { join, relative, sep, extname } from "node:path";
import { statistics } from "./contracts.js";
export const reportPrefix = "/test-reports";
export class ReportAccess {
    outputRoot;
    origin;
    selected;
    constructor(outputRoot) {
        this.outputRoot = outputRoot;
        for (const id of readdirSync(outputRoot)
            .filter((n) => /^run-[\w-]+$/.test(n))
            .sort()
            .reverse()) {
            try {
                const run = JSON.parse(readFileSync(join(outputRoot, id, "results.json"), "utf8"));
                if (run.suite_run_id === id &&
                    run.lifecycle === "FINISHED" &&
                    existsSync(join(outputRoot, id, "report.html"))) {
                    this.select(run);
                    break;
                }
            }
            catch {
                /* 损坏记录不作为可浏览的最近报告。 */
            }
        }
    }
    select(run, filename = "report.html", settled = true) {
        this.selected = { run, filename, settled };
    }
    finish(run) {
        if (this.selected?.run.suite_run_id === run.suite_run_id)
            this.selected.settled = true;
    }
    get latestId() {
        return this.selected?.run.suite_run_id;
    }
    url(id, filename = "report.html") {
        const path = `/test-reports/${encodeURIComponent(id)}/${filename}`;
        return this.origin ? new URL(path, this.origin()).href : `.${path}`;
    }
    state() {
        if (!this.selected)
            return null;
        const { run, filename, settled } = this.selected;
        const path = join(this.outputRoot, run.suite_run_id, filename);
        const ready = settled && existsSync(path);
        const counts = statistics(run);
        const labels = {
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
    serve(req, res) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (!["GET", "HEAD"].includes(req.method ?? "")) {
            res.writeHead(405, { Allow: "GET, HEAD" });
            res.end();
            return;
        }
        try {
            const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname);
            if (pathname === reportPrefix + "/status") {
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(req.method === "HEAD" ? undefined : JSON.stringify(this.state()));
                return;
            }
            const suffix = pathname.slice(reportPrefix.length + 1);
            if (!pathname.startsWith(reportPrefix + "/") ||
                !/^run-[\w-]+\/(?:report(?:-rebuilt)?\.html|results(?:-rebuilt)?\.json|plan\.json|events\.jsonl|evidence\/[\w.-]+)$/.test(suffix))
                throw new Error("不支持的报告路径");
            const target = realpathSync(join(this.outputRoot, suffix));
            const rel = relative(realpathSync(this.outputRoot), target);
            if (rel === ".." ||
                rel.startsWith(".." + sep) ||
                !statSync(target).isFile())
                throw new Error("路径逃逸");
            const types = {
                ".html": "text/html; charset=utf-8",
                ".json": "application/json; charset=utf-8",
                ".jsonl": "text/plain; charset=utf-8",
                ".png": "image/png",
            };
            res.setHeader("Content-Type", types[extname(target)] ?? "application/octet-stream");
            if (extname(target) === ".html")
                res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:");
            res.end(req.method === "HEAD" ? undefined : readFileSync(target));
        }
        catch {
            res.writeHead(404);
            res.end("报告或附件不存在");
        }
    }
}
