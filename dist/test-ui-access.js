import { existsSync } from "node:fs";
import { join } from "node:path";
import { atomicJson, rebuild } from "./recorder.js";
import { writeReport } from "./report.js";
export class TestUiAccess {
    tests;
    inputPath;
    recover;
    pending = new Set();
    constructor(tests, inputPath, recover) {
        this.tests = tests;
        this.inputPath = inputPath;
        this.recover = recover;
    }
    async serve(req, res) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        const action = /^\/test-ui\/(report|recover|release)$/.exec(req.url?.split("?")[0] ?? "")?.[1];
        if (!action || req.method !== "POST") {
            res.writeHead(action ? 405 : 404);
            res.end();
            return;
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.once("close", cancel);
        this.pending.add(controller);
        try {
            const body = await new Promise((done, reject) => {
                const chunks = [];
                let length = 0;
                req.on("data", (chunk) => {
                    length += chunk.length;
                    if (length > 4096) {
                        chunks.length = 0;
                        reject(new Error("请求过大，请只提交运行ID或处置文件路径。"));
                    }
                    else
                        chunks.push(chunk);
                });
                req.once("error", reject);
                req.once("aborted", () => reject(new Error("操作已取消")));
                req.once("end", () => {
                    try {
                        const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                        if (!value || typeof value !== "object" || Array.isArray(value))
                            throw new Error("请提供有效的操作参数");
                        done(value);
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            });
            if (controller.signal.aborted)
                throw new Error("操作已取消");
            let value;
            if (action === "report") {
                if ((body.run_id !== undefined && typeof body.run_id !== "string") ||
                    (body.session_id !== undefined && typeof body.session_id !== "string"))
                    throw new Error("运行ID与会话ID必须是文字。");
                const sessionId = typeof body.session_id === "string" ? body.session_id : "";
                const id = (typeof body.run_id === "string" ? body.run_id.trim() : "") ||
                    this.tests.reportId(sessionId);
                if (!id || !/^run-[\w-]+$/.test(id))
                    throw new Error("当前对话没有报告，请填写合法运行ID。");
                if ([...this.tests.sessions.values()].some((test) => test.run.suite_run_id === id && !test.closed))
                    throw new Error("当前测试尚未结束，不能重建报告。");
                const directory = join(this.tests.config.outputRoot, id);
                if (!existsSync(directory))
                    throw new Error("运行记录不存在");
                const run = rebuild(directory);
                atomicJson(join(directory, "results-rebuilt.json"), run);
                writeReport(directory, run, "report-rebuilt.html");
                value = {
                    run_id: id,
                    url: this.tests.reports.url(id, "report-rebuilt.html"),
                    path: join(directory, "report-rebuilt.html"),
                };
            }
            else {
                const token = body.token;
                if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
                    throw new Error("请在设置页阅读说明并确认当前隔离状态。");
                if (action === "recover") {
                    if (typeof body.session_id !== "string" || !body.session_id)
                        throw new Error("请先打开一个对话，再处理并释放环境。");
                    value = await this.recover(body.session_id, token, controller.signal);
                }
                else {
                    if (typeof body.evidence_file !== "string" ||
                        !body.evidence_file.trim())
                        throw new Error("请填写工作区内的处置证据 JSON 文件路径。");
                    this.tests.recovery.release(this.inputPath(body.evidence_file), token);
                    value = "已记录处置证据并解除隔离，请重新发送测试命令。";
                }
            }
            if (!res.destroyed)
                res.end(JSON.stringify({ ok: true, value }));
        }
        catch (error) {
            if (!res.destroyed) {
                res.writeHead(400);
                res.end(JSON.stringify({ ok: false, message: error.message }));
            }
        }
        finally {
            res.off("close", cancel);
            this.pending.delete(controller);
        }
    }
    dispose() {
        for (const controller of this.pending)
            controller.abort();
        this.pending.clear();
    }
}
