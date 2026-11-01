/** 条件启用的 Browscreen 旁路；预览故障不进入业务结果。 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { atomicJson } from "./recorder.js";
import { RunBridgePreview } from "./runbridge-preview.js";
import { RecordingSession } from "./recording.js";
import { checkBrowscreen, normalizeBrowscreenExecutable, } from "./browscreen-command.js";
function localUrl(value, protocols) {
    const url = new URL(value);
    if (!protocols.includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.username ||
        url.password)
        throw new Error("预览端点必须是本机地址");
    return url;
}
export class PreviewManager {
    toolFrame;
    toolMessage;
    viewerUntil = 0;
    agentCdpOwner;
    candidateCdp;
    captureFailed = false;
    remote;
    owner;
    generation = 0;
    target;
    frame;
    reason = "未启用浏览器预览";
    checkedAt = 0;
    pending;
    child;
    childReady = false;
    setupError;
    failure;
    commandAbort;
    startupTimer;
    startupDeadline;
    cleanup = Promise.resolve();
    serviceUrl;
    recordingContext;
    polling;
    recordingNotice;
    captures = new Map();
    config;
    constructor(config) {
        this.initialize(config);
    }
    initialize(config) {
        this.reason = "未启用浏览器预览";
        this.setupError = undefined;
        this.failure = undefined;
        this.captureFailed = false;
        this.target = undefined;
        this.checkedAt = 0;
        if (!config)
            return;
        this.config = {
            ...config,
            workDir: resolve(config.workDir),
            browscreenExecutable: normalizeBrowscreenExecutable(config.browscreenExecutable),
        };
        this.serviceUrl = localUrl(config.browscreenUrl, ["http:"]);
        if (this.serviceUrl.pathname !== "/" ||
            this.serviceUrl.search ||
            this.serviceUrl.hash)
            throw new Error("Browscreen 地址需为服务根地址");
        mkdirSync(this.config.workDir, { recursive: true });
        this.readCandidate();
        this.reason = "尚无当前测试页面的 CDP";
    }
    /** 运行前应用已保存设置，保持进度路由持有的管理器对象不变。 */
    async configure(config) {
        await this.shutdown();
        this.config = undefined;
        this.serviceUrl = undefined;
        this.target = undefined;
        this.childReady = false;
        this.checkedAt = 0;
        this.initialize(config);
    }
    unavailable(reason) {
        this.reason = reason;
        this.setupError = reason;
    }
    /** 只有当前运行实际持有浏览器上下文时才交付页面归属。 */
    sync(run, recordingContext, actualOwner) {
        this.readCandidate();
        this.remote?.stop();
        this.remote = undefined;
        const instance = run.lifecycle !== "FINISHED" && !run.resource_quarantined
            ? run.instances.find((entry) => entry.resources.browser_context?.state === "exists")
            : undefined;
        const actual = actualOwner ||
            (this.agentCdpOwner?.run_id === run.suite_run_id
                ? this.agentCdpOwner
                : undefined);
        const next = actual && run.lifecycle !== "FINISHED"
            ? actual
            : actualOwner !== false && instance
                ? { run_id: run.suite_run_id, case_run_id: instance.case_run_id }
                : undefined;
        if (next?.run_id === this.owner?.run_id &&
            next?.case_run_id === this.owner?.case_run_id &&
            next?.connection_id === this.owner?.connection_id &&
            next?.connection_digest === this.owner?.connection_digest)
            return;
        clearTimeout(this.polling);
        this.polling = undefined;
        this.recordingContext = next ? recordingContext : undefined;
        this.recordingNotice = undefined;
        this.owner = next;
        this.generation++;
        this.cancelStartup();
        this.target = undefined;
        this.frame = undefined;
        this.checkedAt = 0;
        this.failure = undefined;
        this.captureFailed = false;
        this.viewerUntil = 0;
        this.reason = this.setupError ?? "尚无当前测试页面的 CDP";
        if (this.config) {
            for (const name of ["owner.json", "cdp.json", ".cdp"]) {
                const path = join(this.config.workDir, name);
                if (existsSync(path))
                    unlinkSync(path);
            }
            if (next)
                atomicJson(join(this.config.workDir, "owner.json"), next);
        }
        const previous = this.child;
        this.child = undefined;
        this.childReady = false;
        this.cleanup = this.cleanup.then(() => this.stopChild(previous));
        if (next && this.config?.recordingEnabled)
            this.pollRecording(this.generation);
    }
    setToolFrame(runId, caseId, frame, mode) {
        this.toolFrame = { runId, caseId, frame, mode };
        this.toolMessage = undefined;
    }
    clearTool(runId) {
        if (this.toolFrame?.runId === runId)
            this.toolFrame = undefined;
        if (this.agentCdpOwner?.run_id === runId) {
            this.agentCdpOwner = undefined;
            this.sync({
                suite_run_id: runId,
                lifecycle: "FINISHED",
                instances: [],
            });
        }
    }
    toolNotice(runId, reason) {
        this.toolMessage = { runId, reason };
    }
    viewing(runId) {
        return (this.toolFrame?.runId === runId &&
            !this.frame &&
            !this.remote?.state(runId).ready &&
            this.viewerUntil > Date.now());
    }
    readCandidate() {
        if (!this.config?.connectionId || !this.config.connectionDigest)
            return;
        try {
            const metadata = JSON.parse(readFileSync(join(this.config.workDir, "cdp.json"), "utf8"));
            if (metadata.connection_id === this.config.connectionId &&
                metadata.connection_digest === this.config.connectionDigest)
                this.candidateCdp = metadata;
        }
        catch {
            /* 接入时仍需核对真实目标，目录中的旧地址只作为候选。 */
        }
    }
    async adoptCdp(run, caseId, targetId, callId) {
        const candidate = this.candidateCdp, config = this.config;
        if (!candidate ||
            !config ||
            typeof targetId !== "string" ||
            candidate.connection_id !== config.connectionId ||
            candidate.connection_digest !== config.connectionDigest)
            return false;
        try {
            const response = await fetch(new URL("/json/list", localUrl(candidate.browser_endpoint, ["http:"])), { signal: AbortSignal.timeout(1200) });
            if (!response.ok)
                return false;
            const targets = (await response.json());
            const matches = targets.filter((target) => target.type === "page" && target.id === targetId);
            if (matches.length !== 1 || !matches[0].webSocketDebuggerUrl)
                return false;
            candidate.target_id = targetId;
            candidate.endpoint = matches[0].webSocketDebuggerUrl;
        }
        catch {
            return false;
        }
        const owner = {
            run_id: run.suite_run_id,
            case_run_id: caseId,
            connection_id: config.connectionId,
            connection_digest: config.connectionDigest,
        };
        this.sync(run, this.recordingContext, owner);
        atomicJson(join(config.workDir, "cdp.json"), {
            ...candidate,
            ...owner,
            published_at: new Date().toISOString(),
            verified_by: callId,
        });
        writeFileSync(join(config.workDir, ".cdp"), candidate.endpoint, {
            mode: 0o600,
        });
        if (!this.metadata())
            return false;
        await this.readCapture();
        return true;
    }
    invalidateCdpSelection(runId) {
        if (!this.config || this.owner?.run_id !== runId)
            return;
        try {
            const value = JSON.parse(readFileSync(join(this.config.workDir, "cdp.json"), "utf8"));
            delete value.verified_by;
            atomicJson(join(this.config.workDir, "cdp.json"), value);
        }
        catch {
            /* 尚无画面时无需清除验证。 */
        }
    }
    async attachCdp(run, caseId, value) {
        if (!this.config || !value || typeof value !== "object")
            throw new Error("尚未准备受支持的 CDP 采集器");
        const metadata = value;
        this.agentCdpOwner = { run_id: run.suite_run_id, case_run_id: caseId };
        this.sync(run, undefined, {
            run_id: run.suite_run_id,
            case_run_id: caseId,
        });
        atomicJson(join(this.config.workDir, "cdp.json"), {
            ...metadata,
            ...this.owner,
            published_at: new Date().toISOString(),
        });
        writeFileSync(join(this.config.workDir, ".cdp"), String(metadata.endpoint), { mode: 0o600 });
        if (!this.metadata())
            throw new Error("调试通道元数据无效或当前采集器不支持此端点");
        await this.readCapture();
    }
    pollRecording(generation) {
        const poll = async () => {
            if (generation !== this.generation || !this.owner)
                return;
            await this.readCapture();
            if (generation === this.generation && this.owner && !this.failure) {
                this.polling = setTimeout(poll, 300);
                this.polling.unref();
            }
        };
        this.polling = setTimeout(poll, 0);
        this.polling.unref();
    }
    sealRecordings(runId, reason) {
        for (const [child, capture] of this.captures)
            if (capture.runId === runId && capture.recording) {
                capture.recording.seal(reason);
                if (capture.stopping &&
                    child.exitCode === null &&
                    child.signalCode === null) {
                    capture.forced = true;
                    child.kill("SIGKILL");
                }
            }
    }
    async finishRun(run) {
        this.clearTool(run.suite_run_id);
        if (this.toolMessage?.runId === run.suite_run_id)
            this.toolMessage = undefined;
        if (this.owner?.run_id === run.suite_run_id)
            this.sync({ ...run, lifecycle: "FINISHED" });
        await this.drain(run.suite_run_id);
    }
    async drain(runId) {
        await this.cleanup;
        await Promise.all([...this.captures.values()]
            .filter((c) => c.runId === runId && c.stopping)
            .map((c) => c.stopping));
    }
    async stopChild(child) {
        if (!child)
            return;
        const capture = this.captures.get(child);
        if (capture?.stopping)
            return capture.stopping;
        if (!capture)
            return;
        const operation = (async () => {
            const wait = capture.recording
                ? Math.max(0, capture.recording.deadline() - Date.now())
                : 1500;
            const timeout = setTimeout(() => {
                capture.forced = true;
                capture.recording?.seal("录制收尾超过清理期限，视频不可确认");
                if (child.exitCode === null && child.signalCode === null)
                    child.kill("SIGKILL");
            }, wait);
            if (child.pid && child.exitCode === null && child.signalCode === null)
                child.kill("SIGTERM");
            try {
                await capture.closed;
            }
            finally {
                clearTimeout(timeout);
            }
        })();
        capture.stopping = operation;
        return operation;
    }
    cancelStartup() {
        this.commandAbort?.abort();
        this.commandAbort = undefined;
        clearTimeout(this.startupTimer);
        this.startupTimer = undefined;
        this.startupDeadline = undefined;
    }
    fail(reason, generation) {
        if (generation !== this.generation)
            return;
        this.failure = reason;
        this.reason = reason;
        this.frame = undefined;
        this.cancelStartup();
        const child = this.child;
        this.child = undefined;
        this.childReady = false;
        this.cleanup = this.cleanup.then(() => this.stopChild(child));
    }
    current(metadata, generation) {
        return (generation === this.generation &&
            this.metadata()?.endpoint === metadata.endpoint);
    }
    async checkPort() {
        const url = this.serviceUrl;
        await new Promise((done, reject) => {
            const server = createServer();
            server.unref();
            server.once("error", (error) => reject(new Error(error.code === "EADDRINUSE"
                ? `采集端口 ${url.port || "80"} 已被占用，请在设置中换一个空闲端口。`
                : `无法使用采集端口：${error.message}`)));
            server.listen(Number(url.port || 80), url.hostname.replace(/^\[|\]$/g, ""), () => server.close(() => done()));
        });
    }
    metadata() {
        if (!this.config || !this.owner)
            return;
        try {
            const metadata = JSON.parse(readFileSync(join(this.config.workDir, "cdp.json"), "utf8"));
            if (metadata.run_id !== this.owner.run_id ||
                metadata.case_run_id !== this.owner.case_run_id ||
                (this.owner.connection_id &&
                    metadata.connection_id !== this.owner.connection_id) ||
                (this.owner.connection_digest &&
                    metadata.connection_digest !== this.owner.connection_digest) ||
                !metadata.target_id ||
                !Number.isFinite(Date.parse(metadata.published_at)))
                return;
            if (readFileSync(join(this.config.workDir, ".cdp"), "utf8").trim() !==
                metadata.endpoint)
                return;
            const page = localUrl(metadata.endpoint, ["ws:"]);
            const browser = localUrl(metadata.browser_endpoint, ["http:"]);
            if (page.pathname !== `/devtools/page/${metadata.target_id}` ||
                page.port !== browser.port ||
                browser.pathname !== "/")
                return;
            return metadata;
        }
        catch {
            return;
        }
    }
    async ensureService(metadata, generation) {
        if (this.target === metadata.endpoint)
            return;
        const config = this.config;
        const previous = this.child;
        this.child = undefined;
        this.childReady = false;
        this.cancelStartup();
        this.target = metadata.endpoint;
        this.failure = undefined;
        await this.cleanup;
        await this.stopChild(previous);
        if (!this.current(metadata, generation))
            return;
        const controller = new AbortController();
        this.commandAbort = controller;
        this.startupDeadline = Date.now() + 60000;
        const timeoutReason = "Browscreen 启动和首帧等待超过 60 秒，请进入设置检测命令并检查采集日志，再重新执行测试。";
        this.startupTimer = setTimeout(() => this.fail(timeoutReason, generation), 60000);
        const detected = await checkBrowscreen(config.browscreenExecutable, {
            signal: controller.signal,
        });
        if (!this.current(metadata, generation) || this.failure)
            return;
        this.commandAbort = undefined;
        if (!detected.ok) {
            this.fail(detected.message, generation);
            return;
        }
        try {
            await this.checkPort();
        }
        catch (error) {
            this.fail(error.message, generation);
            return;
        }
        if (!this.current(metadata, generation) || this.failure)
            return;
        let recording;
        if (config.recordingEnabled && this.recordingContext) {
            try {
                recording = new RecordingSession(this.recordingContext, metadata.case_run_id, metadata.target_id);
            }
            catch (error) {
                this.recordingNotice = `无法准备录像文件：${String(error)}`;
            }
        }
        await this.launch(metadata, generation, detected.executable, recording);
    }
    async launch(metadata, generation, executable, recording) {
        const config = this.config;
        const url = this.serviceUrl;
        const child = spawn(executable, [
            "--work-dir",
            config.workDir,
            "--host",
            url.hostname.replace(/^\[|\]$/g, ""),
            "--port",
            url.port || "80",
            "--connect-wait-timeout-s",
            "60",
            ...(recording ? ["--record", "--record-output", recording.path] : []),
        ], {
            shell: false,
            stdio: ["ignore", "ignore", "pipe"],
        });
        this.child = child;
        let closed;
        const capture = {
            runId: metadata.run_id,
            recording,
            forced: false,
            closed: new Promise((done) => {
                closed = done;
            }),
        };
        this.captures.set(child, capture);
        let diagnostic = "";
        child.stderr?.on("data", (data) => {
            recording?.data(data);
            if (recording?.notice && this.current(metadata, generation))
                this.recordingNotice = recording.notice;
            diagnostic = (diagnostic + data.toString()).slice(-4000);
            if (this.child === child && diagnostic.includes("Uvicorn running on"))
                this.childReady = true;
        });
        child.once("error", (error) => {
            recording?.seal(`Browscreen 启动失败：${error.message}`);
            if (this.child !== child)
                return;
            this.fail(`Browscreen 启动失败：${error.message}`, generation);
        });
        child.once("close", () => {
            void (async () => {
                try {
                    await recording?.finish(capture.forced);
                }
                catch (error) {
                    this.recordingNotice = `录像归档失败：${String(error)}`;
                }
                finally {
                    this.captures.delete(child);
                    closed();
                }
                if (this.child !== child)
                    return;
                // 仅已识别的录制准备失败允许一次去掉录像参数，运行中不反复重启。
                if (recording &&
                    !this.childReady &&
                    recording.notice &&
                    this.config?.previewEnabled !== false &&
                    this.current(metadata, generation)) {
                    this.recordingNotice = recording.notice;
                    this.child = undefined;
                    await this.launch(metadata, generation, executable);
                    return;
                }
                this.fail(`Browscreen 进程已退出：${recording?.notice ?? (diagnostic.trim().slice(-500) || "请进入设置检测安装。")}`, generation);
            })();
        });
    }
    async refresh() {
        const generation = this.generation;
        if (this.startupDeadline && Date.now() >= this.startupDeadline)
            this.fail("Browscreen 启动和首帧等待超过 60 秒，请进入设置检查后重新执行测试。", generation);
        const metadata = this.metadata();
        if (!metadata) {
            this.frame = undefined;
            this.reason = this.failure ?? "尚无当前测试页面的 CDP";
            return;
        }
        if (this.frame &&
            !this.config?.recordingEnabled &&
            this.viewerUntil < Date.now()) {
            const child = this.child;
            this.child = undefined;
            this.childReady = false;
            this.target = undefined;
            this.cleanup = this.cleanup.then(() => this.stopChild(child));
            return;
        }
        try {
            const targetsResponse = await fetch(new URL("/json/list", metadata.browser_endpoint), { signal: AbortSignal.timeout(1200) });
            if (!targetsResponse.ok)
                throw new Error("CDP 暂不可达");
            const targets = (await targetsResponse.json());
            const pages = targets.filter((entry) => entry.type === "page");
            const matches = pages.filter((page) => page.id === metadata.target_id &&
                page.webSocketDebuggerUrl === metadata.endpoint);
            if ((pages.length !== 1 && !metadata.verified_by) || matches.length !== 1)
                throw new Error(pages.length > 1
                    ? "多标签页面暂不启用实时预览"
                    : "当前页面 CDP 暂不可达");
            if (generation !== this.generation)
                return;
            if (this.target !== metadata.endpoint)
                this.frame = undefined;
            await this.ensureService(metadata, generation);
            if (!this.current(metadata, generation) || this.failure)
                return;
            if (!this.childReady) {
                this.reason = "等待浏览器画面首帧";
                return;
            }
            const response = await fetch(new URL("/api/screenshot", this.serviceUrl), { signal: AbortSignal.timeout(1800), cache: "no-store" });
            if (!response.ok) {
                const unavailable = (await response.json().catch(() => undefined));
                if (["browser_wait_timeout", "capture_failed"].includes(unavailable?.code ?? "")) {
                    this.fail(`Browscreen 采集停止：${unavailable?.message || unavailable?.code}。请检查后重新执行测试。`, generation);
                    return;
                }
                throw new Error("等待当前浏览器的有效首帧");
            }
            const id = response.headers.get("X-Frame-Id");
            const capturedAt = response.headers.get("X-Capture-Started-At");
            const bytes = Buffer.from(await response.arrayBuffer());
            if (!id ||
                !capturedAt ||
                !/^\d+$/.test(id) ||
                !Number.isFinite(Date.parse(capturedAt)) ||
                Date.parse(capturedAt) < Date.parse(metadata.published_at) ||
                Date.now() - Date.parse(capturedAt) > 5000 ||
                bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
                throw new Error("等待当前浏览器的有效首帧");
            if (!this.current(metadata, generation) || this.failure)
                return;
            this.frame = { bytes, id, capturedAt };
            this.captureFailed = false;
            if (this.child)
                this.captures.get(this.child)?.recording?.frame(capturedAt);
            this.reason = "";
            clearTimeout(this.startupTimer);
            this.startupTimer = undefined;
            this.startupDeadline = undefined;
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.frame = undefined;
            this.captureFailed = true;
            this.reason =
                this.failure ??
                    (error instanceof Error &&
                        !["TimeoutError", "TypeError"].includes(error.name)
                        ? error.message
                        : "浏览器连接或画面暂不可用");
        }
    }
    async readCapture() {
        if (!this.pending && Date.now() - this.checkedAt >= 300) {
            this.pending = this.refresh().finally(() => {
                this.checkedAt = Date.now();
                this.pending = undefined;
            });
        }
        await this.pending;
    }
    summary(runId) {
        const remote = this.remote?.state(runId);
        if (remote?.ready)
            return { ...remote, mode: "continuous" };
        const local = this.owner?.run_id === runId && this.frame;
        const paused = !!local &&
            !this.config?.recordingEnabled &&
            this.viewerUntil < Date.now();
        if (local && (paused || Date.now() - Date.parse(local.capturedAt) < 5000))
            return {
                ready: this.config?.previewEnabled !== false,
                mode: paused ? "once" : "continuous",
                paused,
                frame_id: local.id,
                captured_at: local.capturedAt,
                ...(paused ? { reason: "采集已暂停，打开画面后继续" } : {}),
            };
        if (this.toolFrame?.runId === runId) {
            const { frame, mode } = this.toolFrame;
            const paused = mode === "poll" && this.viewerUntil < Date.now();
            if (mode === "poll" &&
                !paused &&
                Date.now() - Date.parse(frame.capturedAt) > 10000)
                return { ready: false, reason: "定时截图已中断，等待重新接入" };
            return {
                ready: true,
                mode: paused ? "once" : mode,
                paused,
                frame_id: frame.id,
                captured_at: frame.capturedAt,
                reason: paused
                    ? "采集已暂停，打开画面后继续"
                    : mode === "poll"
                        ? "定时截图 · 每 2 秒刷新"
                        : "单次截图",
                ...(this.config?.recordingEnabled
                    ? { recording_notice: "当前工具提供截图，尚未验证录像能力" }
                    : {}),
            };
        }
        if (remote)
            return { ...remote, mode: "continuous" };
        if (this.owner?.run_id === runId)
            return !this.config && !this.setupError
                ? { ready: false }
                : {
                    ready: false,
                    reason: this.reason,
                    failed: !!this.setupError || !!this.failure || this.captureFailed,
                };
        return {
            ready: false,
            reason: this.toolMessage?.runId === runId ? this.toolMessage.reason : undefined,
        };
    }
    async state(runId) {
        if (this.owner?.run_id === runId && this.config)
            await this.readCapture();
        const state = this.summary(runId);
        return {
            ...state,
            ...(this.recordingNotice
                ? { recording_notice: this.recordingNotice }
                : {}),
        };
    }
    async screenshot(runId) {
        this.viewerUntil = Date.now() + 5000;
        const state = await this.state(runId);
        if (!state.ready)
            return;
        if (state.frame_id === this.toolFrame?.frame.id &&
            this.toolFrame?.runId === runId)
            return this.toolFrame.frame;
        return this.remote ? this.remote.screenshot(runId) : this.frame;
    }
    async shutdown() {
        this.candidateCdp = undefined;
        this.agentCdpOwner = undefined;
        this.toolFrame = undefined;
        this.toolMessage = undefined;
        this.remote?.stop();
        this.remote = undefined;
        clearTimeout(this.polling);
        this.polling = undefined;
        this.owner = undefined;
        this.generation++;
        this.frame = undefined;
        this.cancelStartup();
        await this.cleanup;
        await this.stopChild(this.child);
        this.child = undefined;
        this.childReady = false;
        await this.pending;
        if (this.config) {
            const path = join(this.config.workDir, "owner.json");
            if (existsSync(path))
                unlinkSync(path);
        }
    }
    /** 远程后端复用展示接口，不启动本机 Browscreen。 */
    syncRemote(run, browser) {
        this.remote ??= new RunBridgePreview();
        this.remote.bind(run, browser);
    }
}
