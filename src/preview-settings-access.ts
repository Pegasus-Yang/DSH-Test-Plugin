/** 设置元信息和主动安装检测；认证由宿主路由外层负责。 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { checkBrowscreen } from "./browscreen-command.js";
import type { PreviewSettingsInfo } from "./preview-preferences.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    req.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 4096) {
        chunks.length = 0;
        reject(new Error("检测请求过大，请只填写命令路径。"));
      } else chunks.push(chunk);
    });
    req.once("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.once("error", reject);
    req.once("aborted", () => reject(new Error("检测请求已取消。")));
  });
}

export class PreviewSettingsAccess {
  private readonly pending = new Set<AbortController>();
  constructor(private readonly describe: () => PreviewSettingsInfo) {}

  async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const path = req.url?.split("?")[0];
    const method =
      path === "/test-preview-settings"
        ? "GET"
        : path === "/test-preview-settings/check"
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
      res.end(JSON.stringify(this.describe()));
      return;
    }
    let executable: string;
    try {
      const body = JSON.parse(await readBody(req)) as {
        browscreenExecutable?: unknown;
      } | null;
      if (
        !body ||
        typeof body.browscreenExecutable !== "string" ||
        body.browscreenExecutable.length > 2048
      )
        throw new Error("请提供有效的 browscreenExecutable 命令路径。");
      executable = body.browscreenExecutable;
    } catch (error) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, message: (error as Error).message }));
      return;
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    this.pending.add(controller);
    res.once("close", cancel);
    try {
      const result = await checkBrowscreen(executable, {
        signal: controller.signal,
      });
      if (!res.destroyed) res.end(JSON.stringify(result));
    } finally {
      res.off("close", cancel);
      this.pending.delete(controller);
    }
  }

  dispose(): void {
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }
}
