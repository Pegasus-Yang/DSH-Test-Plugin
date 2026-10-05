import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordingSession } from "../../src/recording.js";
import { inspectMp4 } from "../../src/mp4.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "recording-"));
  roots.push(directory);
  const emit = vi.fn();
  const session = new RecordingSession(
    { directory, deadline: () => Date.now() + 1000, emit },
    "case-one",
    "page-one",
  );
  const file = () =>
    copyFileSync(
      new URL("../fixtures/minimal.mp4", import.meta.url),
      session.path,
    );
  return { session, emit, file };
}
it("真实 H.264 色块夹具可以读取视频轨道及时长，损坏或空文件拒绝", async () => {
  const t = setup();
  t.file();
  expect(await inspectMp4(t.session.path)).toMatchObject({ duration_ms: 1000 });
  const bytes = readFileSync(t.session.path);
  writeFileSync(t.session.path, bytes.subarray(0, 100));
  await expect(inspectMp4(t.session.path)).rejects.toThrow();
  writeFileSync(t.session.path, "");
  await expect(inspectMp4(t.session.path)).rejects.toThrow();
});
it("UTF-8 分片日志的完整收尾才登记可播放录像、证据与原实例身份", async () => {
  const t = setup();
  t.file();
  t.session.frame("2026-10-05T10:00:00Z");
  const log = Buffer.from(
    `INFO browscreen.recording 录制完成，视频文件：${t.session.path}\n`,
  );
  for (const byte of log) t.session.data(Buffer.from([byte]));
  await t.session.finish(false);
  await t.session.finish(false);
  const finished = t.emit.mock.calls.filter(
    (c) => c[0] === "recording_finished",
  );
  expect(finished).toHaveLength(1);
  expect(finished[0][1]).toMatchObject({
    status: "COMPLETE",
    case_run_id: "case-one",
    first_frame_at: "2026-10-05T10:00:00Z",
    bytes: 1508,
    duration_ms: 1000,
  });
  expect(finished[0][2]).toMatchObject({
    media_type: "video/mp4",
    redacted: false,
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
});
it("提前停止只保留部分视频；没有摘要、强杀或错误文件不假报完成", async () => {
  const t = setup();
  t.file();
  t.session.data(
    Buffer.from(
      `录制提前终止，已保存部分视频：${t.session.path}；原因：连接超时\n`,
    ),
  );
  await t.session.finish(false);
  expect(t.session.value).toMatchObject({
    status: "PARTIAL",
    reason: "连接超时",
  });
  for (const forced of [true, false]) {
    const other = setup();
    other.file();
    await other.session.finish(forced);
    expect(other.session.value.status).toBe("FAILED");
    expect(other.emit.mock.calls.at(-1)![2]).toBeUndefined();
  }
});
it("无帧不生成证据；缺少 PyAV 输出可执行安装提示", async () => {
  const t = setup();
  t.session.data(Buffer.from("未生成视频：未获取到有效截图\n"));
  await t.session.finish(false);
  expect(t.session.value.status).toBe("EMPTY");
  expect(t.emit.mock.calls.at(-1)![2]).toBeUndefined();
  const missing = setup();
  missing.session.data(
    Buffer.from("无法开启视频录制：缺少或无法加载 PyAV 可选依赖。\n"),
  );
  await missing.session.finish(false);
  expect(missing.session.value.reason).toContain("uv tool install");
  expect(missing.session.value.reason).toContain("browscreen[video]==0.3.0");
});
it("紧急封存后迟到的完整摘要和文件不能覆盖失败或重复加入证据", async () => {
  const t = setup();
  t.session.seal("截止");
  t.file();
  t.session.data(Buffer.from(`录制完成，视频文件：${t.session.path}\n`));
  await t.session.finish(false);
  expect(t.session.value).toMatchObject({ status: "FAILED", reason: "截止" });
  expect(
    t.emit.mock.calls.filter((c) => c[0] === "recording_finished"),
  ).toHaveLength(1);
});
