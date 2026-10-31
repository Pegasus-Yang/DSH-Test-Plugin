import { afterEach, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  ),
);
const release = workflow.jobs.release;
const publish = release.steps.find((step: { run?: string }) => step.run);
const temporary: string[] = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((directory) =>
      rmSync(directory, { recursive: true, force: true }),
    ),
);

function fixture(version = "0.16.0", packageVersion = version) {
  const root = mkdtempSync(join(tmpdir(), "dsh-release-test-"));
  temporary.push(root);
  const project = join(root, "project");
  const runner = join(root, "runner");
  const candidate = join(runner, "candidate");
  const input = join(root, "input");
  const bin = join(root, "bin");
  for (const directory of [project, candidate, join(input, "package"), bin])
    mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ name: "dsh-test-plugin", version }),
  );
  writeFileSync(
    join(input, "package/package.json"),
    JSON.stringify({ name: "dsh-test-plugin", version: packageVersion }),
  );
  const archive = join(candidate, "dsh-test-plugin.tgz");
  const packed = spawnSync("tar", ["-czf", archive, "-C", input, "package"]);
  expect(packed.status).toBe(0);
  const checksum = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  writeFileSync(
    join(candidate, "dsh-test-plugin.sha256"),
    `${checksum}  dsh-test-plugin.tgz\n`,
  );
  const capture = join(root, "gh-call.json");
  const gh = join(bin, "gh");
  // 使用真实发布 shell、tar 和 SHA 校验，仅替换产生远端写入的 gh 命令。
  writeFileSync(
    gh,
    `#!${process.execPath}
const fs = require("node:fs"), crypto = require("node:crypto");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.GH_CAPTURE, JSON.stringify({
  args, repository: process.env.GH_REPO,
  archive_sha256: crypto.createHash("sha256").update(fs.readFileSync(args[3])).digest("hex"),
  checksum: fs.readFileSync(args[4], "utf8"),
}));
process.exit(Number(process.env.GH_TEST_EXIT ?? "0"));
`,
  );
  chmodSync(gh, 0o755);
  const script = join(root, "publish.sh");
  writeFileSync(script, publish.run);
  return {
    root,
    candidate,
    archive,
    checksum,
    capture,
    run(tag = `v${version}`, exit = "0") {
      return spawnSync(
        "bash",
        ["--noprofile", "--norc", "-e", "-o", "pipefail", script],
        {
          cwd: project,
          env: {
            ...process.env,
            PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
            RUNNER_TEMP: runner,
            GITHUB_WORKSPACE: project,
            RELEASE_TAG: tag,
            GH_REPO: "example/dsh-test-plugin",
            GH_TOKEN: "release-test-only",
            GH_CAPTURE: capture,
            GH_TEST_EXIT: exit,
          },
          encoding: "utf8",
        },
      );
    },
  };
}

it("只有版本 tag 的 push 在构建和三版宿主全部通过后获得发布权限", () => {
  expect(workflow.on).toHaveProperty("push");
  expect(workflow.jobs.compatibility.needs).toEqual(["plugin", "host"]);
  expect(release.needs).toBe("compatibility");
  expect(release.if).toBe(
    "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
  );
  expect(release.permissions).toEqual({ contents: "write" });
  expect(publish.shell).toBe("bash");
  expect(
    release.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/download-artifact@"),
    ).with.name,
  ).toBe("candidate");
  expect(publish.env).toEqual({
    GH_TOKEN: "${{ github.token }}",
    GH_REPO: "${{ github.repository }}",
    RELEASE_TAG: "${{ github.ref_name }}",
  });
});

it("发布已经过宿主验证的原包及可验证的版本化摘要，不重新打包", () => {
  const f = fixture();
  const before = readFileSync(f.archive);
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  const call = JSON.parse(readFileSync(f.capture, "utf8"));
  expect(call.args).toEqual([
    "release",
    "create",
    "v0.16.0",
    "dsh-test-plugin-0.16.0.tgz",
    "dsh-test-plugin-0.16.0.tgz.sha256",
    "--verify-tag",
    "--generate-notes",
    "--title",
    "v0.16.0",
  ]);
  expect(call.repository).toBe("example/dsh-test-plugin");
  expect(call.archive_sha256).toBe(f.checksum);
  expect(call.checksum).toBe(`${f.checksum}  dsh-test-plugin-0.16.0.tgz\n`);
  expect(readFileSync(join(f.candidate, call.args[3]))).toEqual(before);
  expect(readFileSync(f.archive)).toEqual(before);
});

it("标签与仓库版本不一致时不调用发布命令", () => {
  const f = fixture();
  expect(f.run("v9.9.9").status).not.toBe(0);
  expect(existsSync(f.capture)).toBe(false);
});

it("包内版本与标签提交中的版本不一致时不发布", () => {
  const f = fixture("0.16.0", "0.15.0");
  expect(f.run().status).not.toBe(0);
  expect(existsSync(f.capture)).toBe(false);
});

it.each(["changed", "missing-checksum"])(
  "候选包完整性异常 %s 时不发布",
  (kind) => {
    const f = fixture();
    if (kind === "changed") writeFileSync(f.archive, "changed archive");
    else rmSync(join(f.candidate, "dsh-test-plugin.sha256"));
    expect(f.run().status).not.toBe(0);
    expect(existsSync(f.capture)).toBe(false);
  },
);

it("预发布版本使用 prerelease，不标为正式版本", () => {
  const f = fixture("0.17.0-rc.1");
  const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  const call = JSON.parse(readFileSync(f.capture, "utf8"));
  expect(call.args).toContain("--prerelease");
  expect(call.args).toContain("v0.17.0-rc.1");
});

it("GitHub 发布失败会使 CI 步骤失败，不覆盖已有 Release", () => {
  const f = fixture();
  expect(f.run("v0.16.0", "23").status).toBe(23);
  const call = JSON.parse(readFileSync(f.capture, "utf8"));
  expect(call.args).not.toContain("--clobber");
});
