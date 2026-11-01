import { checkBrowscreen } from "./browscreen-command.js";
import { checkRunBridgeSettings, } from "./runbridge-settings.js";
function readBody(req) {
    return new Promise((done, reject) => {
        const chunks = [];
        let length = 0;
        req.on("data", (chunk) => {
            length += chunk.length;
            if (length > 4096) {
                chunks.length = 0;
                reject(new Error("检测请求过大，请只填写配置文件或命令路径。"));
            }
            else
                chunks.push(chunk);
        });
        req.once("end", () => done(Buffer.concat(chunks).toString("utf8")));
        req.once("error", reject);
        req.once("aborted", () => reject(new Error("检测请求已取消。")));
    });
}
export class PreviewSettingsAccess {
    describe;
    workspace;
    pending = new Set();
    constructor(describe, workspace = process.cwd()) {
        this.describe = describe;
        this.workspace = workspace;
    }
    async serve(req, res) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        const path = req.url?.split("?")[0];
        const method = path === "/test-preview-settings"
            ? "GET"
            : [
                "/test-preview-settings/check",
                "/test-preview-settings/runbridge",
                "/test-preview-settings/connection",
            ].includes(path ?? "")
                ? "POST"
                : undefined;
        if (!method) {
            res.writeHead(404);
            res.end();
            return;
        }
        if (req.method !== method) {
            res.writeHead(405, { Allow: method });
            res.end();
            return;
        }
        if (method === "GET") {
            const sessionId = new URL(req.url ?? "/", "http://local").searchParams.get("session_id") ?? undefined;
            res.end(JSON.stringify(this.describe(sessionId)));
            return;
        }
        let executable = "";
        let remote;
        try {
            let body;
            try {
                body = JSON.parse(await readBody(req));
            }
            catch {
                throw new Error("请提交有效的检测参数 JSON。");
            }
            if (path === "/test-preview-settings/connection") {
                const source = this.describe().mcpInstances.find((source) => source.id === body.id);
                if (!source)
                    throw new Error("连接尚未登记，请先在 DSH 中添加并启用。");
                res.end(JSON.stringify({
                    ok: source.enabled !== false && !!source.tools?.length,
                    message: source.enabled === false
                        ? "连接未启用，请在 DSH 内置插件中启用。"
                        : source.tools?.length
                            ? `宿主已加载 ${source.tools.length} 个工具；本次只读核对注册状态，未派发业务工具。`
                            : "已登记但尚无工具，请检查 DSH 连接状态；未调用浏览器或领取设备。",
                }));
                return;
            }
            if (path === "/test-preview-settings/runbridge") {
                const source = body?.connectionSource ?? "access-file";
                const file = source === "hub" ? body?.hubFile : body?.accessFile;
                if (!body ||
                    !["access-file", "hub"].includes(String(source)) ||
                    typeof file !== "string" ||
                    file.length > 2048 ||
                    (source === "hub" &&
                        (typeof body.nodeId !== "string" ||
                            !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.nodeId))) ||
                    typeof body.resourceId !== "string" ||
                    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.resourceId) ||
                    !["read", "connect"].includes(String(body.action)))
                    throw new Error("请提供明确的连接来源、私有文件路径、有效节点／资源 ID 和 read/connect 检测动作。");
                remote = {
                    connectionSource: source,
                    accessFile: source === "access-file" ? file.trim() : "",
                    ...(source === "hub"
                        ? { hubFile: file.trim(), nodeId: body.nodeId }
                        : {}),
                    resourceId: body.resourceId,
                    connect: body.action === "connect",
                };
            }
            else {
                if (!body ||
                    typeof body.browscreenExecutable !== "string" ||
                    body.browscreenExecutable.length > 2048)
                    throw new Error("请提供有效的 browscreenExecutable 命令路径。");
                executable = body.browscreenExecutable;
            }
        }
        catch (error) {
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, message: error.message }));
            return;
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        this.pending.add(controller);
        res.once("close", cancel);
        try {
            const result = remote
                ? await checkRunBridgeSettings(this.workspace, remote, controller.signal)
                : await checkBrowscreen(executable, { signal: controller.signal });
            if (!res.destroyed)
                res.end(JSON.stringify(result));
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
