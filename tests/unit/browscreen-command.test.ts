import { afterEach, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkBrowscreen,
  normalizeBrowscreenExecutable,
} from "../../src/browscreen-command.js";

const folders: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
function command(
  program = 'console.log("browscreen 0.3.0")',
  name = "browscreen",
  mode = 0o755,
) {
  const folder = mkdtempSync(join(tmpdir(), "browscreen-command-"));
  folders.push(folder);
  const executable = join(folder, name);
  writeFileSync(executable, `#!${process.execPath}\n${program}\n`, { mode });
  return { folder, executable };
}

it("默认命令按宿主 PATH 解析，同一入口执行 version", async () => {
  const entry = command(
    'if (process.argv[2] !== "version" || process.argv.length !== 3) process.exit(2); console.log("browscreen 0.3.0")',
  );
  vi.stubEnv("PATH", entry.folder);
  expect(await checkBrowscreen()).toMatchObject({
    ok: true,
    version: "0.3.0",
    executable: realpathSync(entry.executable),
  });
  expect(normalizeBrowscreenExecutable("  ")).toBe("browscreen");
});
it("完整路径中的空格和 shell 字符作为文件名处理，不执行命令拼接", async () => {
  const entry = command(undefined, "browscreen $(touch injected)");
  expect(await checkBrowscreen(entry.executable)).toMatchObject({
    ok: true,
    executable: realpathSync(entry.executable),
  });
  expect(existsSync(join(process.cwd(), "injected"))).toBe(false);
  expect(await checkBrowscreen("uv run browscreen")).toMatchObject({
    ok: false,
    code: "INVALID_COMMAND",
  });
  expect(() => normalizeBrowscreenExecutable("~/bin/browscreen")).toThrow(
    "完整路径",
  );
});
it("不存在、目录和不可执行文件分别给出明确原因", async () => {
  const entry = command(undefined, "browscreen", 0o644);
  vi.stubEnv("PATH", entry.folder);
  expect(await checkBrowscreen()).toMatchObject({
    ok: false,
    code: "NOT_EXECUTABLE",
  });
  expect(await checkBrowscreen(join(entry.folder, "missing"))).toMatchObject({
    ok: false,
    code: "NOT_FOUND",
  });
  const directory = join(entry.folder, "directory");
  mkdirSync(directory);
  expect(await checkBrowscreen(directory)).toMatchObject({
    ok: false,
    code: "NOT_EXECUTABLE",
  });
});
it.each(["0.1.0", "0.2.1", "0.4.0", "1.0.0"])(
  "稳定版本 %s 不在允许范围内",
  async (version) => {
    const entry = command(`console.log("browscreen ${version}")`);
    expect(await checkBrowscreen(entry.executable)).toMatchObject({
      ok: false,
      version,
      code: "UNSUPPORTED_VERSION",
    });
  },
);
it("允许 0.3 补丁，拒绝预发布版、错误输出和非零退出", async () => {
  expect(
    await checkBrowscreen(
      command('console.log("browscreen 0.3.1")').executable,
    ),
  ).toMatchObject({ ok: true, version: "0.3.1" });
  for (const output of [
    "browscreen 0.3.0rc1",
    "other-tool 0.3.0",
    "browscreen 0.3.0\nstarted",
  ])
    expect(
      await checkBrowscreen(
        command(`console.log(${JSON.stringify(output)})`).executable,
      ),
    ).toMatchObject({ ok: false, code: "INVALID_VERSION" });
  expect(
    await checkBrowscreen(
      command('console.error("入口损坏");process.exit(2)').executable,
    ),
  ).toMatchObject({ ok: false, message: expect.stringContaining("入口损坏") });
});
it("查询超时后实际回收进程，输出缓冲有上限", async () => {
  const entry = command(
    'const fs = require("node:fs");fs.writeFileSync(__filename+".pid",String(process.pid));setInterval(()=>{},1000)',
  );
  expect(
    await checkBrowscreen(entry.executable, { timeoutMs: 1500 }),
  ).toMatchObject({ ok: false, code: "CHECK_TIMEOUT" });
  const pid = Number(readFileSync(entry.executable + ".pid", "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
  expect(
    (
      await checkBrowscreen(
        command('console.error("x".repeat(20000))').executable,
      )
    ).ok,
  ).toBe(false);
});
it("取消正在查询的入口后不会留下进程", async () => {
  const entry = command(
    'require("node:fs").writeFileSync(__filename+".pid",String(process.pid));setInterval(()=>{},1000)',
  );
  const controller = new AbortController();
  const pending = checkBrowscreen(entry.executable, {
    signal: controller.signal,
  });
  await vi.waitFor(() =>
    expect(existsSync(entry.executable + ".pid")).toBe(true),
  );
  controller.abort();
  expect(await pending).toMatchObject({ ok: false, code: "CHECK_CANCELLED" });
  expect(() =>
    process.kill(Number(readFileSync(entry.executable + ".pid", "utf8")), 0),
  ).toThrow();
});
