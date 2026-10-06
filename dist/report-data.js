/** 报告内嵌数据索引；相同下载与原生调用仅保存一次。 */
import { createHash } from "node:crypto";
import { redact } from "./recorder.js";
export class ReportData {
    downloads = {};
    calls = {};
    download(bytes, mime) {
        const id = createHash("sha256").update(mime).update(bytes).digest("hex");
        this.downloads[id] ??= { mime, base64: bytes.toString("base64") };
        return id;
    }
    call(id, value) {
        this.calls[id] ??= JSON.stringify(redact(value), null, 2);
    }
    script() {
        // 数据块也必须防止工具响应中的关闭标签提前结束 script。
        return JSON.stringify({ downloads: this.downloads, calls: this.calls })
            .replace(/</g, "\\u003c")
            .replace(/\u2028/g, "\\u2028")
            .replace(/\u2029/g, "\\u2029");
    }
}
