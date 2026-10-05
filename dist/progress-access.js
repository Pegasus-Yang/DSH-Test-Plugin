import { previewPage } from "./preview-page.js";
export const progressPrefix = "/test-progress";
export class ProgressAccess {
    snapshot;
    preview;
    constructor(snapshot, preview) {
        this.snapshot = snapshot;
        this.preview = preview;
    }
    async serve(req, res) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (!["GET", "HEAD"].includes(req.method ?? "")) {
            res.writeHead(405, { Allow: "GET, HEAD" });
            res.end();
            return;
        }
        const pathname = new URL(req.url ?? "/", "http://local").pathname;
        const match = /^\/test-progress\/([\w-]+)(?:\/([\w-]+)\/(preview|screenshot))?$/.exec(pathname);
        if (!match) {
            res.writeHead(404);
            res.end();
            return;
        }
        const [, sessionId, runId, type] = match;
        const state = this.snapshot(sessionId);
        if (!runId) {
            if (state) {
                state.preview = await this.preview.state(state.run_id);
                if (state.preview.ready)
                    state.preview.src = `${progressPrefix}/${sessionId}/${state.run_id}/preview`;
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(req.method === "HEAD" ? undefined : JSON.stringify(state));
            return;
        }
        if (!state || state.run_id !== runId || state.phase === "finished") {
            res.writeHead(404);
            res.end();
            return;
        }
        if (type === "preview") {
            if (!(await this.preview.state(runId)).ready) {
                res.writeHead(503);
                res.end();
                return;
            }
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(req.method === "HEAD"
                ? undefined
                : previewPage(`${progressPrefix}/${sessionId}/${runId}/screenshot`));
            return;
        }
        const frame = await this.preview.screenshot(runId);
        if (!frame) {
            res.writeHead(503);
            res.end();
            return;
        }
        res.setHeader("Content-Type", "image/png");
        res.setHeader("X-Frame-Id", frame.id);
        res.setHeader("X-Capture-Started-At", frame.capturedAt);
        res.end(req.method === "HEAD" ? undefined : frame.bytes);
    }
}
