/** 本机 Browscreen 命令与版本探测；不安装包，不启动采集服务。 */
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import {
  browscreenVersionRange,
  previewPreferenceDefaults,
  type BrowscreenCheck,
} from "./preview-preferences.js";

export function normalizeBrowscreenExecutable(value?: string): string {
  const executable =
    value?.trim() || previewPreferenceDefaults.browscreenExecutable;
  if (
    executable.includes("\0") ||
    (executable !== "browscreen" && !isAbsolute(executable))
  )
    throw new Error(
      "请填写 browscreen 或可执行文件的完整路径，不要混入启动参数。",
    );
  return executable;
}

function resolveExecutable(executable: string): string {
  const candidates = isAbsolute(executable)
    ? [executable]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) =>
          join(
            directory,
            process.platform === "win32" ? "browscreen.exe" : "browscreen",
          ),
        );
  let inaccessible = false;
  for (const path of candidates) {
    try {
      if (!statSync(path).isFile()) {
        inaccessible = true;
        continue;
      }
      accessSync(path, constants.X_OK);
      return realpathSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        inaccessible = true;
    }
  }
  const error = new Error(
    inaccessible
      ? "Browscreen 入口不可执行，请选择正确的命令文件或重新安装。"
      : "未找到 Browscreen。请在 DSH 宿主运行 uv tool install --python 3.14 'browscreen==0.3.0' -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com；录制请改用 'browscreen[video]==0.3.0'，也可在设置填写完整命令路径并检测。",
  ) as NodeJS.ErrnoException;
  error.code = inaccessible ? "NOT_EXECUTABLE" : "NOT_FOUND";
  throw error;
}

export async function checkBrowscreen(
  value?: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BrowscreenCheck> {
  let executable: string;
  try {
    executable = resolveExecutable(normalizeBrowscreenExecutable(value));
  } catch (error) {
    return {
      ok: false,
      code: (error as NodeJS.ErrnoException).code ?? "INVALID_COMMAND",
      message: (error as Error).message,
    };
  }
  if (options.signal?.aborted)
    return {
      ok: false,
      executable,
      code: "CHECK_CANCELLED",
      message: "Browscreen 版本检测已取消。",
    };
  return new Promise((done) => {
    let timedOut = false;
    const child = execFile(
      executable,
      ["version"],
      { encoding: "utf8", maxBuffer: 16 * 1024, shell: false },
      (error, stdout, stderr) => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", cancel);
        const fail = (code: string, message: string) =>
          done({ ok: false, executable, code, message });
        if (options.signal?.aborted)
          return fail("CHECK_CANCELLED", "Browscreen 版本检测已取消。");
        if (timedOut)
          return fail(
            "CHECK_TIMEOUT",
            "Browscreen 版本查询超过等待时间，请在宿主执行同一命令的 version 排查。",
          );
        if (error)
          return fail(
            String(error.code ?? "CHECK_FAILED"),
            `Browscreen 版本查询失败：${stderr.trim().slice(-500) || error.message.slice(0, 500)}`,
          );
        const version = /^browscreen (\d+\.\d+\.\d+)$/.exec(stdout.trim())?.[1];
        if (!version)
          return fail(
            "INVALID_VERSION",
            "版本输出应为 browscreen X.Y.Z，请检查入口或重新安装 Browscreen。",
          );
        const [major, minor] = version.split(".").map(Number);
        if (major !== 0 || minor !== 3)
          return done({
            ok: false,
            executable,
            version,
            code: "UNSUPPORTED_VERSION",
            message: `Browscreen ${version} 不受支持，需要稳定版本 ${browscreenVersionRange}，建议安装 0.3.0；录制需安装 browscreen[video]。`,
          });
        done({
          ok: true,
          executable,
          version,
          message: `Browscreen ${version} 已安装，可以使用。`,
        });
      },
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 5000);
    const cancel = () => {
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
  });
}
