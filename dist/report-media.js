/** 报告只为实际实例的已归档录像生成播放器；视频独立于 HTML 保存。 */
import { existsSync, statSync } from "node:fs";
import { safePath } from "./recorder.js";
const escape = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function recordingMedia(directory, run, instance) {
    const records = (run.recordings ?? []).filter((r) => r.case_run_id === instance.case_run_id);
    const videos = [], notices = [];
    for (const record of records) {
        if (record.status === "EMPTY")
            continue;
        if (record.status === "FAILED" || record.status === "RECORDING") {
            if (record.first_frame_at || instance.resources.browser_context)
                notices.push(record.reason ?? "录像未确认收尾");
            continue;
        }
        const e = run.evidence.find((e) => e.evidence_id === record.evidence_id &&
            e.media_type === "video/mp4" &&
            e.relative_path === record.relative_path);
        let available = false;
        try {
            const file = e && safePath(directory, e.relative_path);
            available =
                !!file &&
                    e.relative_path.endsWith(".mp4") &&
                    existsSync(file) &&
                    statSync(file).isFile() &&
                    statSync(file).size === record.bytes;
        }
        catch { }
        if (!available || !e) {
            notices.push("已归档录像文件缺失或大小变化，请检查运行目录");
            continue;
        }
        const label = record.status === "PARTIAL" ? "部分录制" : "已保存录像";
        videos.push(`<section class="recording" data-recording="${escape(record.recording_id)}"><header><h3>${label} · 片段 ${videos.length + 1}</h3><a href="${escape(e.relative_path)}?download=1" download>下载视频</a></header><video controls preload="metadata" src="${escape(e.relative_path)}" aria-label="本用例浏览器操作录像"></video><p>${instance.cancelled ? "本次测试已取消，视频保留取消前的实际画面。" : ""}${record.duration_ms === undefined ? "" : `视频时长 ${(record.duration_ms / 1000).toFixed(1)} 秒 · `}${record.first_frame_at ? `首帧 ${escape(record.first_frame_at)} · ` : ""}结束 ${escape(record.finished_at)}</p>${record.reason ? `<p class="reason">${escape(record.reason)}</p>` : ""}<small>${escape(e.relative_path)} · SHA-256 ${escape(e.sha256)}</small></section>`);
    }
    return {
        videos: videos.join(""),
        notice: notices.length
            ? `<p class="reason" data-recording-problem>录像提示：${[...new Set(notices)].map(escape).join("；")}</p>`
            : "",
    };
}
