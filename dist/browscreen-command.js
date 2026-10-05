/** 本机 Browscreen 命令与版本探测；不安装包，不启动采集服务。 */
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { browscreenVersionRange, previewPreferenceDefaults, } from "./preview-preferences.js";
export function normalizeBrowscreenExecutable(value) {
    const executable = value?.trim() || previewPreferenceDefaults.browscreenExecutable;
    if (executable.includes("\0") ||
        (executable !== "browscreen" && !isAbsolute(executable)))
        throw new Error("请填写 browscreen 或可执行文件的完整路径，不要混入启动参数。");
    return executable;
}
function resolveExecutable(executable) {
    const candidates = isAbsolute(executable)
        ? [executable]
        : (process.env.PATH ?? "")
            .split(delimiter)
            .filter(Boolean)
            .map((directory) => join(directory, process.platform === "win32" ? "browscreen.exe" : "browscreen"));
    let inaccessible = false;
    for (const path of candidates) {
        try {
            if (!statSync(path).isFile()) {
                inaccessible = true;
                continue;
            }
            accessSync(path, constants.X_OK);
            return realpathSync(path);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                inaccessible = true;
        }
    }
    const error = new Error(inaccessible
        ? "Browscreen 入口不可执行，请选择正确的命令文件或重新安装。"
        : "未找到 Browscreen。请先安装，或在设置中填写完整命令路径并检测。");
    error.code = inaccessible ? "NOT_EXECUTABLE" : "NOT_FOUND";
    throw error;
}
export async function checkBrowscreen(value, options = {}) {
    let executable;
    try {
        executable = resolveExecutable(normalizeBrowscreenExecutable(value));
    }
    catch (error) {
        return {
            ok: false,
            code: error.code ?? "INVALID_COMMAND",
            message: error.message,
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
        const child = execFile(executable, ["version"], { encoding: "utf8", maxBuffer: 16 * 1024, shell: false }, (error, stdout, stderr) => {
            clearTimeout(timeout);
            options.signal?.removeEventListener("abort", cancel);
            const fail = (code, message) => done({ ok: false, executable, code, message });
            if (options.signal?.aborted)
                return fail("CHECK_CANCELLED", "Browscreen 版本检测已取消。");
            if (timedOut)
                return fail("CHECK_TIMEOUT", "Browscreen 版本查询超过等待时间，请在宿主执行同一命令的 version 排查。");
            if (error)
                return fail(String(error.code ?? "CHECK_FAILED"), `Browscreen 版本查询失败：${stderr.trim().slice(-500) || error.message.slice(0, 500)}`);
            const version = /^browscreen (\d+\.\d+\.\d+)$/.exec(stdout.trim())?.[1];
            if (!version)
                return fail("INVALID_VERSION", "版本输出应为 browscreen X.Y.Z，请检查入口或重新安装 Browscreen。");
            const [major, minor, patch] = version.split(".").map(Number);
            if (major !== 0 || minor !== 2 || patch < 1)
                return done({
                    ok: false,
                    executable,
                    version,
                    code: "UNSUPPORTED_VERSION",
                    message: `Browscreen ${version} 不受支持，需要稳定版本 ${browscreenVersionRange}，建议安装 0.2.1。`,
                });
            done({
                ok: true,
                executable,
                version,
                message: `Browscreen ${version} 已安装，可以使用。`,
            });
        });
        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, options.timeoutMs ?? 5000);
        const cancel = () => {
            child.kill("SIGKILL");
        };
        options.signal?.addEventListener("abort", cancel, { once: true });
        if (options.signal?.aborted)
            cancel();
    });
}
