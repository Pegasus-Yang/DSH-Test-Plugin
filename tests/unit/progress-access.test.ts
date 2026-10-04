import { expect, it, vi } from "vitest";
import { ProgressAccess } from "../../src/progress-access.js";
import type { PreviewManager } from "../../src/preview.js";
import type { ProgressSnapshot } from "../../src/progress-model.js";

const base: ProgressSnapshot = {
  session_id: "one",
  run_id: "run-one",
  title: "API测试",
  phase: "executing",
  created_at: "2026-10-04T00:00:00Z",
  server_now: "2026-10-04T00:00:01Z",
  instances: [],
  total_steps: 0,
  settled_steps: 0,
  preview: { ready: false },
};
async function request(access: ProgressAccess, url: string, method = "GET") {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  await access.serve(
    { url, method } as never,
    {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      writeHead: (code: number) => {
        status = code;
      },
      end: (value: unknown) => {
        body = value;
      },
    } as never,
  );
  return { status, body, headers };
}
function access(ready = false) {
  const preview = {
    state: vi.fn(async () => ({ ready })),
    screenshot: vi.fn(async () => ({
      bytes: Buffer.from("frame"),
      id: "2",
      capturedAt: "2026-10-04T00:00:02Z",
    })),
  };
  return {
    preview,
    service: new ProgressAccess(
      (session) => (session === "one" ? structuredClone(base) : null),
      preview as unknown as PreviewManager,
    ),
  };
}
it("没有CDP或首帧时不返回浮窗地址，也不提供空白预览页", async () => {
  const { service } = access();
  const result = await request(service, "/test-progress/one");
  expect(JSON.parse(String(result.body)).preview).toEqual({ ready: false });
  expect(
    (await request(service, "/test-progress/one/run-one/preview")).status,
  ).toBe(503);
});
it("另一会话或旧运行无法借用当前画面；只读路由拒绝写入", async () => {
  const { service, preview } = access(true);
  expect(
    (await request(service, "/test-progress/two/run-one/screenshot")).status,
  ).toBe(404);
  expect(
    (await request(service, "/test-progress/one/run-old/screenshot")).status,
  ).toBe(404);
  expect(preview.screenshot).not.toHaveBeenCalled();
  expect((await request(service, "/test-progress/one", "POST")).status).toBe(
    405,
  );
});
it("首帧就绪才返回同源iframe地址，图片保留帧号、时间和no-store", async () => {
  const { service } = access(true);
  const state = JSON.parse(
    String((await request(service, "/test-progress/one")).body),
  );
  expect(state.preview.src).toBe("/test-progress/one/run-one/preview");
  const page = await request(service, state.preview.src);
  expect(String(page.body)).toContain("/test-progress/one/run-one/screenshot");
  const frame = await request(service, "/test-progress/one/run-one/screenshot");
  expect(frame.headers).toMatchObject({
    "Content-Type": "image/png",
    "X-Frame-Id": "2",
    "Cache-Control": "no-store",
  });
});
