/** 条件启用的 Browscreen 旁路；预览故障不进入业务结果。 */
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import type { PreviewConfig } from "./config.js";
import type { SuiteRun } from "./contracts.js";
import type { PreviewOwner, PublishedCdp } from "./cdp-publisher.js";
import type { PreviewState } from "./progress-model.js";
import { atomicJson } from "./recorder.js";
import {
  checkBrowscreen,
  normalizeBrowscreenExecutable,
} from "./browscreen-command.js";

interface Frame {
  bytes: Buffer;
  id: string;
  capturedAt: string;
}
function localUrl(value: string, protocols: string[]): URL {
  const url = new URL(value);
  if (
    !protocols.includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("预览端点必须是本机地址");
  return url;
}

export class PreviewManager {
  private owner?: PreviewOwner;
  private generation = 0;
  private target?: string;
  private frame?: Frame;
  private reason = "未启用浏览器预览";
  private checkedAt = 0;
  private pending?: Promise<void>;
  private child?: ChildProcess;
  private childReady = false;
  private setupError?: string;
  private failure?: string;
  private commandAbort?: AbortController;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private startupDeadline?: number;
  private cleanup: Promise<void> = Promise.resolve();
  private serviceUrl?: URL;
  config?: PreviewConfig;

  constructor(config?: PreviewConfig) {
    this.initialize(config);
  }

  private initialize(config?: PreviewConfig): void {
    this.reason = "未启用浏览器预览";
    this.setupError = undefined;
    this.failure = undefined;
    this.target = undefined;
    this.checkedAt = 0;
    if (!config) return;
    this.config = {
      ...config,
      workDir: resolve(config.workDir),
      browscreenExecutable: normalizeBrowscreenExecutable(
        config.browscreenExecutable,
      ),
    };
    this.serviceUrl = localUrl(config.browscreenUrl, ["http:"]);
    if (
      this.serviceUrl.pathname !== "/" ||
      this.serviceUrl.search ||
      this.serviceUrl.hash
    )
      throw new Error("Browscreen 地址需为服务根地址");
    mkdirSync(this.config.workDir, { recursive: true });
    this.reason = "尚无当前测试页面的 CDP";
  }

  /** 运行前应用已保存设置，保持进度路由持有的管理器对象不变。 */
  async configure(config?: PreviewConfig): Promise<void> {
    await this.shutdown();
    this.config = undefined;
    this.serviceUrl = undefined;
    this.target = undefined;
    this.childReady = false;
    this.checkedAt = 0;
    this.initialize(config);
  }

  unavailable(reason: string): void {
    this.reason = reason;
    this.setupError = reason;
  }

  /** 只有当前运行实际持有浏览器上下文时才交付页面归属。 */
  sync(run: SuiteRun): void {
    const instance =
      run.lifecycle !== "FINISHED" && !run.resource_quarantined
        ? run.instances.find(
            (entry) => entry.resources.browser_context?.state === "exists",
          )
        : undefined;
    const next = instance
      ? { run_id: run.suite_run_id, case_run_id: instance.case_run_id }
      : undefined;
    if (
      next?.run_id === this.owner?.run_id &&
      next?.case_run_id === this.owner?.case_run_id
    )
      return;
    this.owner = next;
    this.generation++;
    this.cancelStartup();
    this.target = undefined;
    this.frame = undefined;
    this.checkedAt = 0;
    this.failure = undefined;
    this.reason = this.setupError ?? "尚无当前测试页面的 CDP";
    if (this.config) {
      for (const name of ["owner.json", "cdp.json", ".cdp"]) {
        const path = join(this.config.workDir, name);
        if (existsSync(path)) unlinkSync(path);
      }
      if (next) atomicJson(join(this.config.workDir, "owner.json"), next);
    }
    const previous = this.child;
    this.child = undefined;
    this.childReady = false;
    this.cleanup = this.cleanup.then(() => this.stopChild(previous));
  }

  private async stopChild(child?: ChildProcess): Promise<void> {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    await new Promise<void>((done) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1500);
      const finished = () => {
        clearTimeout(timeout);
        child.off("exit", finished);
        child.off("error", finished);
        done();
      };
      child.once("exit", finished);
      child.once("error", finished);
      child.kill("SIGTERM");
    });
  }

  private cancelStartup(): void {
    this.commandAbort?.abort();
    this.commandAbort = undefined;
    clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
    this.startupDeadline = undefined;
  }

  private fail(reason: string, generation: number): void {
    if (generation !== this.generation) return;
    this.failure = reason;
    this.reason = reason;
    this.frame = undefined;
    this.cancelStartup();
    const child = this.child;
    this.child = undefined;
    this.childReady = false;
    this.cleanup = this.cleanup.then(() => this.stopChild(child));
  }

  private current(metadata: PublishedCdp, generation: number): boolean {
    return (
      generation === this.generation &&
      this.metadata()?.endpoint === metadata.endpoint
    );
  }

  private async checkPort(): Promise<void> {
    const url = this.serviceUrl!;
    await new Promise<void>((done, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", (error: NodeJS.ErrnoException) =>
        reject(
          new Error(
            error.code === "EADDRINUSE"
              ? `采集端口 ${url.port || "80"} 已被占用，请在设置中换一个空闲端口。`
              : `无法使用采集端口：${error.message}`,
          ),
        ),
      );
      server.listen(
        Number(url.port || 80),
        url.hostname.replace(/^\[|\]$/g, ""),
        () => server.close(() => done()),
      );
    });
  }

  private metadata(): PublishedCdp | undefined {
    if (!this.config || !this.owner) return;
    try {
      const metadata: PublishedCdp = JSON.parse(
        readFileSync(join(this.config.workDir, "cdp.json"), "utf8"),
      );
      if (
        metadata.run_id !== this.owner.run_id ||
        metadata.case_run_id !== this.owner.case_run_id ||
        !metadata.target_id ||
        !Number.isFinite(Date.parse(metadata.published_at))
      )
        return;
      if (
        readFileSync(join(this.config.workDir, ".cdp"), "utf8").trim() !==
        metadata.endpoint
      )
        return;
      const page = localUrl(metadata.endpoint, ["ws:"]);
      const browser = localUrl(metadata.browser_endpoint, ["http:"]);
      if (
        page.pathname !== `/devtools/page/${metadata.target_id}` ||
        page.port !== browser.port ||
        browser.pathname !== "/"
      )
        return;
      return metadata;
    } catch {
      return;
    }
  }

  private async ensureService(
    metadata: PublishedCdp,
    generation: number,
  ): Promise<void> {
    if (this.target === metadata.endpoint) return;
    const config = this.config!;
    const previous = this.child;
    this.child = undefined;
    this.childReady = false;
    this.cancelStartup();
    this.target = metadata.endpoint;
    this.failure = undefined;
    await this.cleanup;
    await this.stopChild(previous);
    if (!this.current(metadata, generation)) return;
    const controller = new AbortController();
    this.commandAbort = controller;
    this.startupDeadline = Date.now() + 60000;
    const timeoutReason =
      "Browscreen 启动和首帧等待超过 60 秒，请进入设置检测命令并检查采集日志，再重新执行测试。";
    this.startupTimer = setTimeout(
      () => this.fail(timeoutReason, generation),
      60000,
    );
    const detected = await checkBrowscreen(config.browscreenExecutable, {
      signal: controller.signal,
    });
    if (!this.current(metadata, generation) || this.failure) return;
    this.commandAbort = undefined;
    if (!detected.ok) {
      this.fail(detected.message, generation);
      return;
    }
    try {
      await this.checkPort();
    } catch (error) {
      this.fail((error as Error).message, generation);
      return;
    }
    if (!this.current(metadata, generation) || this.failure) return;
    const url = this.serviceUrl!;
    const child = spawn(
      detected.executable!,
      [
        "--work-dir",
        config.workDir,
        "--host",
        url.hostname.replace(/^\[|\]$/g, ""),
        "--port",
        url.port || "80",
        "--connect-wait-timeout-s",
        "60",
      ],
      {
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    this.child = child;
    let diagnostic = "";
    child.stderr?.on("data", (data: Buffer) => {
      diagnostic = (diagnostic + data.toString()).slice(-4000);
      if (this.child === child && diagnostic.includes("Uvicorn running on"))
        this.childReady = true;
    });
    child.once("error", (error) => {
      if (this.child !== child) return;
      this.fail(`Browscreen 启动失败：${error.message}`, generation);
    });
    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      this.fail(
        `Browscreen 进程已退出（${signal ?? code}）：${diagnostic.trim().slice(-500) || "请进入设置检测命令后重新执行测试。"}`,
        generation,
      );
    });
  }

  private async refresh(): Promise<void> {
    const generation = this.generation;
    if (this.startupDeadline && Date.now() >= this.startupDeadline)
      this.fail(
        "Browscreen 启动和首帧等待超过 60 秒，请进入设置检查后重新执行测试。",
        generation,
      );
    const metadata = this.metadata();
    if (!metadata) {
      this.frame = undefined;
      this.reason = this.failure ?? "尚无当前测试页面的 CDP";
      return;
    }
    try {
      const targetsResponse = await fetch(
        new URL("/json/list", metadata.browser_endpoint),
        { signal: AbortSignal.timeout(1200) },
      );
      if (!targetsResponse.ok) throw new Error("CDP 暂不可达");
      const targets = (await targetsResponse.json()) as {
        id: string;
        type: string;
        webSocketDebuggerUrl: string;
      }[];
      const pages = targets.filter((entry) => entry.type === "page");
      if (
        pages.length !== 1 ||
        pages[0]?.id !== metadata.target_id ||
        pages[0].webSocketDebuggerUrl !== metadata.endpoint
      )
        throw new Error(
          pages.length > 1
            ? "多标签页面暂不启用实时预览"
            : "当前页面 CDP 暂不可达",
        );
      if (generation !== this.generation) return;
      if (this.target !== metadata.endpoint) this.frame = undefined;
      await this.ensureService(metadata, generation);
      if (!this.current(metadata, generation) || this.failure) return;
      if (!this.childReady) {
        this.reason = "等待浏览器画面首帧";
        return;
      }
      const response = await fetch(
        new URL("/api/screenshot", this.serviceUrl!),
        { signal: AbortSignal.timeout(1800), cache: "no-store" },
      );
      if (!response.ok) {
        const unavailable = (await response.json().catch(() => undefined)) as
          | { code?: string; message?: string }
          | undefined;
        if (
          ["browser_wait_timeout", "capture_failed"].includes(
            unavailable?.code ?? "",
          )
        ) {
          this.fail(
            `Browscreen 采集停止：${unavailable?.message || unavailable?.code}。请检查后重新执行测试。`,
            generation,
          );
          return;
        }
        throw new Error("等待当前浏览器的有效首帧");
      }
      const id = response.headers.get("X-Frame-Id");
      const capturedAt = response.headers.get("X-Capture-Started-At");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        !id ||
        !capturedAt ||
        !/^\d+$/.test(id) ||
        !Number.isFinite(Date.parse(capturedAt)) ||
        Date.parse(capturedAt) < Date.parse(metadata.published_at) ||
        Date.now() - Date.parse(capturedAt) > 5000 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      )
        throw new Error("等待当前浏览器的有效首帧");
      if (!this.current(metadata, generation) || this.failure) return;
      this.frame = { bytes, id, capturedAt };
      this.reason = "";
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
      this.startupDeadline = undefined;
    } catch (error) {
      if (generation !== this.generation) return;
      this.frame = undefined;
      this.reason =
        this.failure ??
        (error instanceof Error &&
        !["TimeoutError", "TypeError"].includes(error.name)
          ? error.message
          : "浏览器连接或画面暂不可用");
    }
  }

  async state(runId: string): Promise<PreviewState> {
    if (this.owner?.run_id !== runId) return { ready: false };
    if (!this.config)
      return this.setupError
        ? { ready: false, failed: true, reason: this.setupError }
        : { ready: false };
    if (!this.pending && Date.now() - this.checkedAt >= 300) {
      this.pending = this.refresh().finally(() => {
        this.checkedAt = Date.now();
        this.pending = undefined;
      });
    }
    await this.pending;
    if (this.owner?.run_id !== runId) return { ready: false };
    if (!this.frame)
      return {
        ready: false,
        reason: this.reason,
        ...(this.failure ? { failed: true } : {}),
      };
    return {
      ready: true,
      frame_id: this.frame.id,
      captured_at: this.frame.capturedAt,
    };
  }
  async screenshot(runId: string): Promise<Frame | undefined> {
    return (await this.state(runId)).ready ? this.frame : undefined;
  }
  async shutdown(): Promise<void> {
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
      if (existsSync(path)) unlinkSync(path);
    }
  }
}
