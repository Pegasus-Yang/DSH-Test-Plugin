import { ToolCallId } from "@deepseek-ai/dsh-llm/brand";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { atomicJson } from "./recorder.js";
export class RecoveryManager {
    outputRoot;
    timeoutMs;
    active;
    stopPreview;
    busy = false;
    lastError;
    cancelPending;
    path;
    constructor(outputRoot, timeoutMs, active, stopPreview) {
        this.outputRoot = outputRoot;
        this.timeoutMs = timeoutMs;
        this.active = active;
        this.stopPreview = stopPreview;
        this.path = join(outputRoot, "quarantine.json");
    }
    read() {
        if (!existsSync(this.path))
            return;
        const raw = readFileSync(this.path, "utf8");
        try {
            const value = JSON.parse(raw);
            return { raw, marker: value && typeof value === "object" ? value : {} };
        }
        catch {
            return { raw, marker: {} };
        }
    }
    token(raw) {
        return createHash("sha256").update(raw).digest("hex");
    }
    status(now = Date.now()) {
        const current = this.read();
        if (!current)
            return { quarantine: null, recovering: this.busy };
        const id = current.marker.details?.run_id;
        const created = current.marker.created_at;
        const timestamp = typeof created === "string" ? Date.parse(created) : NaN;
        const validTime = Number.isFinite(timestamp) && timestamp <= now;
        const validId = typeof id === "string" && /^run-[\w-]+$/.test(id);
        let browser = false;
        if (validId) {
            try {
                const run = JSON.parse(readFileSync(join(this.outputRoot, id, "results.json"), "utf8"));
                browser =
                    run.suite_run_id === id &&
                        run.instances.some((instance) => instance.resources.browser_context?.state === "exists");
            }
            catch {
                /* 缺少资源归属时保留手工处置入口。 */
            }
        }
        const unavailable = this.busy
            ? "正在处理释放，请等待结果。"
            : this.active()
                ? "当前测试尚未结束，请先停止测试并等待收尾。"
                : !validTime || !validId
                    ? "隔离记录或时间异常，请核实后在设置页提交处置证据。"
                    : !browser
                        ? "未能确认浏览器资源归属，请核实外部环境后在设置页提交处置证据。"
                        : undefined;
        return {
            quarantine: {
                token: this.token(current.raw),
                ...(validId ? { run_id: id } : {}),
                reason: typeof current.marker.details?.reason === "string"
                    ? current.marker.details.reason
                    : "隔离记录无法完整读取",
                ...(validTime
                    ? { created_at: created, elapsed_ms: now - timestamp }
                    : {}),
                timeout_ms: this.timeoutMs,
                overdue: validTime && now - timestamp >= this.timeoutMs,
                can_recover: unavailable === undefined,
                ...(unavailable ? { unavailable_reason: unavailable } : {}),
            },
            recovering: this.busy,
            ...(this.lastError ? { last_error: this.lastError } : {}),
        };
    }
    mark(run, reason) {
        const previous = this.read()?.marker;
        if (previous?.details?.run_id !== run.suite_run_id)
            this.lastError = undefined;
        atomicJson(this.path, {
            created_at: previous?.details?.run_id === run.suite_run_id
                ? (previous.created_at ?? new Date().toISOString())
                : new Date().toISOString(),
            details: { run_id: run.suite_run_id, reason },
        });
    }
    ensureIdle() {
        if (this.busy || this.active())
            throw new Error("活动测试或释放操作尚未结束，不能解除隔离");
    }
    cancel() {
        this.cancelPending?.();
    }
    commit(token, proof) {
        const current = this.read();
        if (!current || this.token(current.raw) !== token)
            throw new Error("隔离状态已变化，请重新查看并确认，未解除新的隔离");
        atomicJson(join(this.outputRoot, "release-" + randomUUID() + ".json"), {
            quarantine: current.marker,
            proof,
            released_at: new Date().toISOString(),
        });
        unlinkSync(this.path);
        this.lastError = undefined;
    }
    release(evidenceFile, token) {
        this.ensureIdle();
        const proof = JSON.parse(readFileSync(evidenceFile, "utf8"));
        if (proof.external_stopped !== true ||
            proof.environment_reset !== true ||
            !proof.operator ||
            !proof.details ||
            !proof.evidence)
            throw new Error("需提供外部停止、环境重置、操作者与处置证据");
        const current = this.read();
        if (!current)
            throw new Error("当前没有需要解除的隔离");
        JSON.parse(current.raw);
        this.commit(token ?? this.token(current.raw), proof);
    }
    async recover(agent, token, signal) {
        this.ensureIdle();
        if (agent.status !== "idle")
            throw new Error("请等待当前对话轮次结束后再处理释放");
        const state = this.status().quarantine;
        if (!state || state.token !== token)
            throw new Error("隔离状态已变化，请重新查看并确认");
        if (!state.can_recover)
            throw new Error(state.unavailable_reason);
        if (signal.aborted)
            throw new Error("释放已取消，隔离仍保留");
        const name = "mcp__playwright__browser_close";
        if (!agent.ctx.tools.get(name, agent))
            throw new Error("当前没有可用的 Playwright 关闭工具，请恢复 MCP 连接后重试，或在设置页提交实际处置证据");
        this.busy = true;
        this.lastError = undefined;
        const controller = new AbortController();
        const callId = ToolCallId(randomUUID());
        const startedAt = new Date().toISOString();
        let timer;
        let abort;
        const interrupted = new Promise((_resolve, reject) => {
            abort = () => {
                controller.abort("释放已取消");
                reject(new Error("释放已取消，隔离仍保留；等待在途关闭操作结算"));
            };
            signal.addEventListener("abort", abort, { once: true });
            timer = setTimeout(() => {
                controller.abort("释放操作超时");
                reject(new Error("释放操作超时，浏览器状态仍未获确认，隔离仍保留；请检查 MCP 连接并等待在途操作结算"));
            }, this.timeoutMs);
        });
        this.cancelPending = abort;
        const operation = (async () => {
            const result = await agent.ctx.tools.execute({
                callId,
                name,
                arguments: {},
                agent,
                signal: controller.signal,
            });
            if (controller.signal.aborted)
                throw new Error("释放未在期限内确认，隔离仍保留");
            if (result.isError)
                throw new Error("浏览器关闭未成功（可能审批被拒绝或连接失败），隔离仍保留");
            await this.stopPreview();
            if (controller.signal.aborted)
                throw new Error("释放未在期限内确认，隔离仍保留");
            this.commit(token, {
                operator: "DSH 页面确认的操作者",
                external_stopped: true,
                environment_reset: true,
                details: "用户确认旧测试及外部操作已停止；原生工具关闭测试专用浏览器，并停止本插件预览。旧测试结果保持原样。",
                evidence: {
                    method: "confirmed-browser-recovery",
                    session_id: agent.id,
                    tool: name,
                    call_id: callId,
                    started_at: startedAt,
                    finished_at: new Date().toISOString(),
                    browser_close_is_error: false,
                    preview_stopped: true,
                },
            });
            return "测试环境已释放。请重新发送原测试命令；旧测试结果未修改。";
        })().finally(() => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            this.busy = false;
            this.cancelPending = undefined;
        });
        try {
            return await Promise.race([operation, interrupted]);
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }
}
