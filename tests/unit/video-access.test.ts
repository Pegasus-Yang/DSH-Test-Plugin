import { afterEach, expect, it } from "vitest";
import { Writable } from "node:stream";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReportAccess } from "../../src/report-access.js";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
function setup() {
  const root = mkdtempSync(join(tmpdir(), "video-http-"));
  roots.push(root);
  const dir = join(root, "run-one/evidence");
  mkdirSync(dir, { recursive: true });
  copyFileSync(
    new URL("../fixtures/minimal.mp4", import.meta.url),
    join(dir, "browser-one.mp4"),
  );
  writeFileSync(
    join(root, "run-one/report.html"),
    '<video src="evidence/browser-one.mp4" controls></video><a href="evidence/browser-one.mp4?download=1" download>下载视频</a>',
  );
  return {
    access: new ReportAccess(root),
    bytes: readFileSync(join(dir, "browser-one.mp4")),
  };
}
async function request(
  access: ReportAccess,
  url: string,
  range?: string,
  method = "GET",
) {
  let status = 200;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const res: any = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  res.statusCode = 200;
  res.setHeader = (k: string, v: string) => (headers[k] = String(v));
  res.writeHead = (code: number, values: Record<string, string> = {}) => {
    status = code;
    Object.assign(headers, values);
  };
  const pending = new Promise<void>((done, reject) => {
    res.once("finish", done);
    res.once("error", reject);
  });
  access.serve({ url, method, headers: range ? { range } : {} } as never, res);
  await pending;
  return {
    status: status === 200 ? res.statusCode : status,
    headers,
    body: Buffer.concat(chunks),
  };
}
it.each([
  [undefined, 200, 0, 1507],
  ["bytes=0-99", 206, 0, 99],
  ["bytes=1400-", 206, 1400, 1507],
  ["bytes=-10", 206, 1498, 1507],
])("整文件与单段 %s 支持流式播放", async (range, status, start, end) => {
  const t = setup();
  const r = await request(
    t.access,
    "/test-reports/run-one/evidence/browser-one.mp4",
    range,
  );
  expect(r.status).toBe(status);
  expect(r.body).toEqual(t.bytes.subarray(start, end + 1));
  expect(r.headers["Content-Type"]).toBe("video/mp4");
  expect(r.headers["Accept-Ranges"]).toBe("bytes");
  expect(Number(r.headers["Content-Length"])).toBe(end - start + 1);
});
it.each(["bytes=2000-", "bytes=20-10", "bytes=-0"])(
  "无效区间 %s 返回416",
  async (range) => {
    expect(
      (
        await request(
          setup().access,
          "/test-reports/run-one/evidence/browser-one.mp4",
          range,
        )
      ).status,
    ).toBe(416);
  },
);
it("HEAD 不传输视频，越界文件仍拒绝", async () => {
  const t = setup();
  const r = await request(
    t.access,
    "/test-reports/run-one/evidence/browser-one.mp4",
    undefined,
    "HEAD",
  );
  expect(r.body.length).toBe(0);
  expect(Number(r.headers["Content-Length"])).toBe(t.bytes.length);
  expect(
    (await request(t.access, "/test-reports/run-one/evidence/../../secret.mp4"))
      .status,
  ).toBe(404);
});
it("下载链接给出附件响应，并持有同一个文件的只读票据", async () => {
  const t = setup();
  const report = await request(t.access, "/test-reports/run-one/report.html");
  const url = report.body
    .toString()
    .match(/href="([^"]+)"/)![1]
    .replaceAll("&amp;", "&");
  const req = { url: "/test-reports/run-one/" + url, method: "GET" } as never;
  expect(t.access.authorizeVideo(req)).toBe(true);
  const r = await request(t.access, (req as any).url);
  expect(r.headers["Content-Disposition"]).toBe(
    'attachment; filename="browser-one.mp4"',
  );
  expect(r.body).toEqual(t.bytes);
});
it("报告在认证后的响应里签发文件专用票据，不能用来访问其他文件或写入", async () => {
  const t = setup();
  const report = await request(t.access, "/test-reports/run-one/report.html");
  const url = report.body.toString().match(/src="([^"]+)"/)![1];
  const req = { url: "/test-reports/run-one/" + url, method: "GET" } as never;
  expect(t.access.authorizeVideo(req)).toBe(true);
  expect(
    t.access.authorizeVideo({
      ...(req as any),
      url: (req as any).url.replace("browser-one", "browser-other"),
    }),
  ).toBe(false);
  expect(t.access.authorizeVideo({ ...(req as any), method: "POST" })).toBe(
    false,
  );
  expect(
    t.access.authorizeVideo({
      ...(req as any),
      url: (req as any).url.replace(".mp4", ".json"),
    }),
  ).toBe(false);
  expect(
    t.access.authorizeVideo({
      ...(req as any),
      url: (req as any).url.replace(/media=.*/, "media=1." + "a".repeat(64)),
    }),
  ).toBe(false);
  expect(report.headers["Content-Security-Policy"]).toContain("sandbox");
  expect(report.headers["Content-Security-Policy"]).toContain(
    "media-src 'self'",
  );
});
