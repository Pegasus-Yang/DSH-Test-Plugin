/** 一个采集进程对应一个录像片段；只信任预先生成的输出路径和完整收尾摘要。 */
import { randomUUID, createHash } from "node:crypto";
import { createReadStream, mkdirSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { inspectMp4 } from "./mp4.js";
import { videoInstallHint } from "./preview-preferences.js";
export function recordingProblem(line) {
    if (/无法开启视频录制|无法创建录制文件|视频录制写入失败|视频编码收尾失败|MP4 文件关闭失败|录制文件关闭失败/.test(line)) {
        const message = line
            .slice(line.indexOf("browscreen.") >= 0 ? line.indexOf("browscreen.") : 0)
            .slice(-1200);
        return /PyAV|libx264/.test(line)
            ? `视频录制依赖不可用。${videoInstallHint}`
            : `视频录制失败：${message}`;
    }
}
export class RecordingSession {
    context;
    path;
    value;
    notice;
    decoder = new StringDecoder("utf8");
    text = "";
    summary;
    finalizing;
    sealed = false;
    abort = new AbortController();
    constructor(context, caseId, target) {
        this.context = context;
        const id = randomUUID();
        const relative = `evidence/browser-${id}.mp4`;
        mkdirSync(join(context.directory, "evidence"), { recursive: true });
        this.path = join(context.directory, relative);
        this.value = {
            recording_id: id,
            case_run_id: caseId,
            target_id: target,
            status: "RECORDING",
            started_at: new Date().toISOString(),
        };
        this.context.emit("recording_started", { ...this.value });
    }
    deadline() {
        return this.context.deadline();
    }
    data(bytes) {
        if (this.sealed)
            return;
        this.text += this.decoder.write(bytes);
        let index;
        while ((index = this.text.indexOf("\n")) >= 0) {
            this.line(this.text.slice(0, index));
            this.text = this.text.slice(index + 1);
        }
        if (this.text.length > 65536) {
            this.notice = "录制日志不完整，不能确认视频收尾";
            this.text = "";
        }
    }
    line(line) {
        this.notice = recordingProblem(line) ?? this.notice;
        if (line.includes(`录制完成，视频文件：${this.path}`))
            this.summary = "COMPLETE";
        else if (line.includes(`录制提前终止，已保存部分视频：${this.path}`)) {
            this.summary = "PARTIAL";
            this.notice = line.split("；原因：")[1] ?? "录制提前终止";
        }
        else if (/未生成视频：未获取到有效截图/.test(line))
            this.summary = "EMPTY";
        else if (/录制失败|录制未完成收尾/.test(line))
            this.summary = "FAILED";
    }
    frame(at) {
        this.value.first_frame_at ??= at;
    }
    seal(reason) {
        if (this.sealed)
            return;
        this.sealed = true;
        this.abort.abort();
        Object.assign(this.value, {
            status: "FAILED",
            finished_at: new Date().toISOString(),
            reason,
        });
        this.context.emit("recording_finished", { ...this.value });
    }
    finish(forced) {
        return (this.finalizing ??= this.complete(forced));
    }
    async complete(forced) {
        if (this.sealed)
            return;
        this.line(this.text + this.decoder.end());
        this.text = "";
        this.value.finished_at = new Date().toISOString();
        let evidence;
        try {
            if (forced)
                throw new Error("采集进程被强制结束，视频收尾未获确认");
            if (this.summary === "EMPTY")
                this.value.status = "EMPTY";
            else if (this.summary === "COMPLETE" || this.summary === "PARTIAL") {
                const stat = await lstat(this.path);
                if (!stat.isFile() || !stat.size)
                    throw new Error("视频文件不存在或为空");
                const info = await inspectMp4(this.path);
                const hash = createHash("sha256");
                for await (const bytes of createReadStream(this.path, {
                    signal: this.abort.signal,
                }))
                    hash.update(bytes);
                const id = randomUUID();
                Object.assign(this.value, {
                    status: this.summary,
                    relative_path: `evidence/browser-${this.value.recording_id}.mp4`,
                    evidence_id: id,
                    bytes: stat.size,
                    ...info,
                });
                evidence = {
                    evidence_id: id,
                    relative_path: this.value.relative_path,
                    media_type: "video/mp4",
                    sha256: hash.digest("hex"),
                    redacted: false,
                };
                if (this.summary === "PARTIAL")
                    this.value.reason = this.notice;
            }
            else
                throw new Error(this.notice ?? "没有收到完整的录制收尾摘要，视频不可确认");
        }
        catch (error) {
            this.value.status = "FAILED";
            this.value.reason =
                error instanceof Error ? error.message : String(error);
        }
        if (!this.sealed) {
            this.sealed = true;
            this.context.emit("recording_finished", { ...this.value }, evidence);
        }
    }
}
