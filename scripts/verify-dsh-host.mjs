/** 独立公开宿主验证：同一 tgz、无豁免 CLI 安装、SDK 回归、真实 Web 与配置持久化。 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rename,
  open,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parse, stringify } from "yaml";
import {
  assertSupportedHost,
  checkCompatibility,
  readCompatibility,
} from "./dsh-compatibility.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const [version, archiveArg, sourceArg, outputArg] = process.argv.slice(2);
assert(
  version && archiveArg && sourceArg && outputArg,
  "用法：verify-dsh-host.mjs 宿主版本 候选.tgz 官方源码仓库 新输出目录",
);
const archive = resolve(archiveArg),
  source = resolve(sourceArg),
  output = resolve(outputArg);
const { pkg, policy } = readCompatibility(project);
assertSupportedHost(policy, version);
const sha256 = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
assert.equal(
  sha256,
  process.env.DSH_CANDIDATE_SHA256,
  "必须提供 DSH_CANDIDATE_SHA256，并与唯一候选包一致",
);
assert(!existsSync(output), "输出目录必须不存在，防止旧安装或豁免污染验证");
await mkdir(output, { recursive: true });
const env = {
  ...process.env,
  npm_config_cache: process.env.DSH_NPM_CACHE ?? join(output, "npm-cache"),
  DSH_TELEMETRY_DISABLED: "1",
  CI: "true",
};
const summary = {
  plugin_version: pkg.version,
  host_version: version,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  candidate_sha256: sha256,
  checks: {},
};
const save = () =>
  writeFile(
    join(output, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
function git(args) {
  const result = spawnSync("git", ["-C", source, ...args], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `无法读取官方发行源码：${result.stderr}`);
  return result.stdout.trim();
}
async function command(
  executable,
  args,
  cwd,
  label,
  extraEnv = {},
  expectedCode = 0,
) {
  const child = spawn(executable, args, {
    cwd,
    env: { ...env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      text += chunk;
    });
  let forceTimer;
  const timer = setTimeout(
    () => {
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 10000);
    },
    label === "real-model" ? 3600000 : 240000,
  );
  try {
    const code = await new Promise((done, reject) => {
      child.once("error", reject);
      child.once("exit", done);
    });
    await writeFile(join(output, label + ".log"), text, { mode: 0o600 });
    assert.equal(
      code,
      expectedCode,
      `${label} 失败，详见 ${label}.log：${text.slice(-1200)}`,
    );
    return text;
  } finally {
    clearTimeout(timer);
    clearTimeout(forceTimer);
  }
}
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// 同机并行准备多个宿主时，只串行重 IO 的 SDK 回归；CI 各宿主独立运行，无需此锁。
async function withRegressionLock(action) {
  const file = process.env.DSH_REGRESSION_LOCK;
  if (!file) return action();
  let handle;
  const began = Date.now();
  while (!handle) {
    try {
      handle = await open(file, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      assert(Date.now() - began < 900000, "等待本机 SDK 回归锁超时");
      await delay(200);
    }
  }
  try {
    await action();
  } finally {
    await handle.close();
    await unlink(file);
  }
}
const tag = `dsh-v${version}`;
summary.host_source_commit = git(["rev-parse", `${tag}^{commit}`]);
const overrides = {};
for (const file of git(["ls-tree", "-r", "--name-only", tag])
  .split("\n")
  .filter((f) => /^(packages|vendor)\/.+\/package\.json$/.test(f))) {
  const entry = JSON.parse(git(["show", `${tag}:${file}`]));
  if (!entry.private && entry.name?.startsWith("@deepseek-ai/"))
    overrides[entry.name] = entry.version;
}
assert.equal(
  JSON.parse(git(["show", `${tag}:package.json`])).version,
  version,
  "发布标签不是目标宿主版本",
);

// 遍历真实目录；插件的 profile 不得带入另一份宿主 SDK。
function sdkPackages(root) {
  const found = [],
    visited = new Set();
  function walk(path) {
    if (!existsSync(path)) return;
    const actual = realpathSync(path);
    if (visited.has(actual)) return;
    visited.add(actual);
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, item.name);
      if (item.name === "package.json") {
        const p = JSON.parse(readFileSync(full, "utf8"));
        if (p.name?.startsWith("@deepseek-ai/"))
          found.push({ name: p.name, version: p.version, path: full });
      } else if (
        item.isDirectory() ||
        (item.isSymbolicLink() && statSync(full).isDirectory())
      )
        walk(full);
    }
  }
  walk(root);
  return found;
}
async function installHost(root, cohort) {
  await mkdir(root);
  const manifest = {
    name: "dsh-compatibility-host",
    private: true,
    type: "module",
    dependencies: { "@deepseek-ai/dsh": version },
  };
  if (cohort) {
    manifest.overrides = overrides;
    manifest.devDependencies = Object.fromEntries(
      Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
        ([name]) => !name.startsWith("@deepseek-ai/"),
      ),
    );
  }
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  await command(
    npm,
    ["install", "--no-audit", "--no-fund"],
    root,
    cohort ? "cohort-install" : "public-install",
  );
  const sdks = sdkPackages(join(root, "node_modules"));
  assert(
    sdks.some((p) => p.name === "@deepseek-ai/dsh" && p.version === version),
  );
  const mismatches = sdks.filter(
    (p) => overrides[p.name] && p.version !== overrides[p.name],
  );
  if (cohort)
    assert.deepEqual(mismatches, [], "隔离基线混入了其他发行批次的 SDK");
  const label = cohort ? "cohort" : "public";
  await writeFile(
    join(output, `${label}-sdk.json`),
    JSON.stringify({ packages: sdks, mismatches }, null, 2),
  );
  summary.checks[label + "_sdk"] = {
    packages: sdks.length,
    mismatches: mismatches.length,
    overrides: cohort,
  };
  return {
    root,
    cohort,
    cli: join(root, "node_modules/@deepseek-ai/dsh/lib/bin.js"),
    home: join(root, "home"),
    profile: join(root, "home/profiles/web"),
  };
}
async function plugin(host, args, label) {
  return command(
    process.execPath,
    [host.cli, "plugin", "--profile", "web", ...args],
    host.root,
    label,
    { DSH_HOME: host.home },
  );
}
async function installPlugin(host, label) {
  await plugin(
    host,
    ["add", archive, "--ignore-scripts"],
    label + "-plugin-add",
  );
  assert(
    !existsSync(join(host.profile, "compatibility.json")),
    "宿主生成了版本豁免，不能作为正式支持",
  );
  const installed = join(host.profile, "node_modules/dsh-test-plugin");
  const candidate = readCompatibility(installed);
  checkCompatibility(candidate.pkg, candidate.policy);
  assert.equal(candidate.pkg.version, pkg.version);
  await cp(
    join(project, "scripts/compat/gate.mjs"),
    join(host.root, "gate.mjs"),
  );
  await command(
    process.execPath,
    [
      join(host.root, "gate.mjs"),
      join(installed, "package.json"),
      join(installed, "dsh-compatibility.json"),
    ],
    host.root,
    label + "-gate",
  );
  assert.deepEqual(
    sdkPackages(join(host.profile, "node_modules")).filter((p) =>
      p.name.startsWith("@deepseek-ai/dsh"),
    ),
    [],
    "profile 重复安装了 DSH SDK",
  );
  const dump = await command(
    process.execPath,
    [host.cli, "web", "--dump-config"],
    host.root,
    label + "-dump",
    { DSH_HOME: host.home },
  );
  assert(
    dump.includes("dsh-test-plugin") && !dump.includes("is incompatible"),
    "正常准入未包含候选插件",
  );
  const locks = join(output, "profile-locks", label);
  await mkdir(locks, { recursive: true });
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    await cp(join(host.profile, file), join(locks, file));
  summary.checks[label + "_cli_install"] = {
    exemption: false,
    plugin_version: candidate.pkg.version,
    profile_sdk_copies: 0,
  };
}

let hostProcess;
async function stopHost() {
  if (!hostProcess) return;
  const current = hostProcess;
  hostProcess = undefined;
  if (current.exitCode === null && current.signalCode === null)
    current.kill("SIGTERM");
  await new Promise((done) => {
    if (current.exitCode !== null || current.signalCode !== null) return done();
    const timer = setTimeout(() => current.kill("SIGKILL"), 12000);
    current.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
  let alive = true;
  try {
    process.kill(current.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") alive = false;
  }
  assert.equal(alive, false, "验证宿主进程未停止");
  summary.checks.stops ??= [];
  summary.checks.stops.push({
    pid: current.pid,
    alive,
    exit_code: current.exitCode,
    signal: current.signalCode,
  });
  await save();
}
async function startHost(host, label) {
  let text = "",
    url;
  const hostEnv = { ...env, DSH_HOME: host.home };
  // 默认模型的环境密钥会掩盖 CI 无凭据首次引导；只有受控模型 profile 继承它。
  if (!host.cohort || !process.env.DSH_MODEL_PATCH)
    delete hostEnv.DEEPSEEK_API_KEY;
  const child = spawn(
    process.execPath,
    [host.cli, "web", "--no-open", "--port", "0"],
    {
      cwd: host.root,
      env: hostEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  hostProcess = child;
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      text += chunk;
      url ??= text.match(/dsh web: (http:\/\/[^\s]+)/)?.[1];
    });
  const began = Date.now();
  while (!url && child.exitCode === null && Date.now() - began < 90000)
    await delay(100);
  assert(url, `宿主 ${label} 未就绪`);
  assert(
    !text.includes("dsh-test-plugin@" + pkg.version + " is incompatible"),
    "实际启动被版本门禁拒绝",
  );
  summary.checks.host_env ??= [];
  summary.checks.host_env.push({
    phase: label,
    default_model_env_key: !!hostEnv.DEEPSEEK_API_KEY,
  });
  const state = {
    version,
    plugin_version: pkg.version,
    root: host.root,
    home: host.home,
    profile: host.profile,
    url,
    pid: child.pid,
    output,
    candidate_sha256: sha256,
    default_model_env_key: !!hostEnv.DEEPSEEK_API_KEY,
  };
  await writeFile(join(output, "state.json"), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  child.once("exit", () => {
    void writeFile(join(output, label + "-host.log"), text, { mode: 0o600 });
  });
  return state;
}
try {
  console.log(`${version}：准备公开安装和纯版本 SDK 基线`);
  const cohort = await installHost(join(output, "cohort"), true);
  const publicHost = await installHost(join(output, "public"), false);
  await installPlugin(publicHost, "public");
  await startHost(publicHost, "public");
  await command(
    process.execPath,
    [
      join(project, "scripts/compat/web.mjs"),
      join(output, "state.json"),
      "public",
    ],
    project,
    "public-web",
  );
  await stopHost();
  await installPlugin(cohort, "cohort");
  const entry = pathToFileURL(
    join(cohort.profile, "node_modules/dsh-test-plugin/dist/index.js"),
  ).href;
  const importArgs = [
    "--input-type=module",
    "-e",
    `await import(${JSON.stringify(entry)})`,
  ];
  await command(process.execPath, importArgs, cohort.root, "entry-import");
  const sdkPath = join(cohort.root, "node_modules/@deepseek-ai/dsh-llm");
  await rename(sdkPath, sdkPath + ".hidden");
  try {
    await command(
      process.execPath,
      importArgs,
      cohort.root,
      "missing-sdk",
      {},
      1,
    );
  } finally {
    await rename(sdkPath + ".hidden", sdkPath);
  }
  summary.checks.gate_boundaries_and_missing_sdk = true;
  const probe = join(cohort.root, "source");
  await mkdir(probe);
  for (const file of [
    "src",
    "tests",
    "scripts",
    "tsconfig.json",
    "package.json",
    "dsh-compatibility.json",
  ])
    await cp(join(project, file), join(probe, file), { recursive: true });
  for (const file of ["dist", "examples", "cordis.patch.yml", "icon.svg"])
    await cp(
      join(cohort.profile, "node_modules/dsh-test-plugin", file),
      join(probe, file),
      { recursive: true },
    );
  await withRegressionLock(async () => {
    await command(
      process.execPath,
      [join(cohort.root, "node_modules/typescript/bin/tsc"), "--noEmit"],
      probe,
      "typecheck",
    );
    await command(
      process.execPath,
      [
        join(cohort.root, "node_modules/vitest/vitest.mjs"),
        "run",
        "tests/unit",
        "tests/integration",
        "--maxWorkers=1",
        "--minWorkers=1",
        "--reporter=json",
        "--outputFile=" + join(output, "regression.json"),
      ],
      probe,
      "regression",
    );
  });
  const regression = JSON.parse(
    await readFile(join(output, "regression.json"), "utf8"),
  );
  assert(
    regression.success &&
      regression.numFailedTests === 0 &&
      regression.numPendingTests === 0,
    "回归存在失败或跳过",
  );
  summary.checks.regression = {
    passed: regression.numPassedTests,
    failed: regression.numFailedTests,
    skipped: regression.numPendingTests,
    typecheck: true,
  };
  await save();
  // 测试配置从启动前就写入可编辑 profile；真实模型配置只由本机显式提供。
  const patch = [
    { id: "hmr", disabled: true },
    { id: "directory-picker", disabled: true },
    { id: "tools", config: { mode: "native" } },
    {
      id: "harness-test",
      config: {
        workspace: join(cohort.root, "workspace"),
        outputRoot: join(cohort.root, "runs"),
        stepTimeoutMs: 600000,
        cancelGraceMs: 500,
        cleanupTimeoutMs: 180000,
      },
    },
    {
      insert: [
        {
          id: "compat-playwright",
          name: "@deepseek-ai/dsh-mcp-client",
          config: {
            serverName: "playwright",
            transport: "stdio",
            command: process.execPath,
            args: [
              join(cohort.root, "node_modules/@playwright/mcp/cli.js"),
              "--headless",
              "--browser",
              "chromium",
              "--isolated",
              "--output-dir",
              join(cohort.root, "playwright"),
            ],
            toolCallTimeoutMs: 60000,
            failOnStartupError: true,
          },
        },
      ],
    },
  ];
  await mkdir(join(cohort.root, "workspace"));
  if (process.env.DSH_MODEL_PATCH) {
    const models = parse(
      await readFile(resolve(process.env.DSH_MODEL_PATCH), "utf8"),
    ).filter((row) => ["llm-pi-ai", "agent-default-model"].includes(row.id));
    assert.equal(models.length, 2, "私有配置缺少模型或默认选择");
    patch.push(...models, {
      id: "agent-loop",
      config: { maxParallelToolCalls: 1 },
    });
    if (process.env.DSH_MODEL_CREDENTIALS)
      await cp(
        resolve(process.env.DSH_MODEL_CREDENTIALS),
        join(cohort.home, ".credentials.yaml"),
      );
    else {
      const providers = Object.values(
        models.find((row) => row.id === "llm-pi-ai").config.providers ?? {},
      );
      assert(providers.length > 0, "真实模型验收缺少提供方配置");
      for (const provider of providers)
        assert(
          provider.apiKeyEnv && process.env[provider.apiKeyEnv],
          "真实模型验收必须提供凭据文件或已设置的 apiKeyEnv",
        );
    }
  }
  const diagnostic = join(cohort.root, "diagnostic");
  await mkdir(diagnostic);
  await writeFile(
    join(diagnostic, "package.json"),
    JSON.stringify({
      name: "dsh-compat-diagnostic",
      private: true,
      type: "module",
    }),
  );
  await cp(
    join(project, "scripts/compat/state-probe.mjs"),
    join(diagnostic, "index.mjs"),
  );
  patch.push({
    insert: [{ id: "compat-state", name: join(diagnostic, "index.mjs") }],
  });
  await writeFile(join(cohort.profile, "cordis.patch.yml"), stringify(patch), {
    mode: 0o600,
  });
  await startHost(cohort, "cohort");
  await command(
    process.execPath,
    [
      join(project, "scripts/compat/web.mjs"),
      join(output, "state.json"),
      "save",
    ],
    project,
    "web-save",
  );
  await stopHost();
  const mcpPatch = parse(
    await readFile(join(cohort.profile, "cordis.patch.yml"), "utf8"),
  );
  mcpPatch
    .flatMap((row) => row.insert ?? [])
    .find((row) => row.id === "compat-playwright").config.toolCallTimeoutMs =
    61000;
  await writeFile(
    join(cohort.profile, "cordis.patch.yml"),
    stringify(mcpPatch),
    { mode: 0o600 },
  );
  await startHost(cohort, "restart");
  await command(
    process.execPath,
    [
      join(project, "scripts/compat/web.mjs"),
      join(output, "state.json"),
      "read",
    ],
    project,
    "web-restart",
  );
  summary.checks.web = { public: true, saved: true, restart_readback: true };
  await stopHost();
  const savedPatch = parse(
    await readFile(join(cohort.profile, "cordis.patch.yml"), "utf8"),
  );
  savedPatch.find((row) => row.id === "harness-test").disabled = true;
  await writeFile(
    join(cohort.profile, "cordis.patch.yml"),
    stringify(savedPatch),
    { mode: 0o600 },
  );
  await startHost(cohort, "disabled");
  await command(
    process.execPath,
    [
      join(project, "scripts/compat/web.mjs"),
      join(output, "state.json"),
      "disabled",
    ],
    project,
    "web-disabled",
  );
  await stopHost();
  savedPatch.find((row) => row.id === "harness-test").disabled = false;
  await writeFile(
    join(cohort.profile, "cordis.patch.yml"),
    stringify(savedPatch),
    { mode: 0o600 },
  );
  await startHost(cohort, "enabled");
  await command(
    process.execPath,
    [
      join(project, "scripts/compat/web.mjs"),
      join(output, "state.json"),
      "read",
    ],
    project,
    "web-enabled",
  );
  summary.checks.disable_enable = true;
  if (process.env.DSH_MODEL_PATCH) {
    await command(
      process.execPath,
      [
        join(project, "scripts/compat/real-model.mjs"),
        join(output, "state.json"),
      ],
      project,
      "real-model",
    );
    summary.checks.real_model = JSON.parse(
      await readFile(join(output, "real-model.json"), "utf8"),
    );
  }
  await stopHost();
  await plugin(cohort, ["remove", "dsh-test-plugin"], "plugin-remove");
  const removed = JSON.parse(
    await readFile(join(cohort.profile, "package.json"), "utf8"),
  );
  assert(
    !removed.dependencies?.[pkg.name] &&
      !removed.dsh.profile.bundles.includes(pkg.name),
    "卸载后仍有插件挂载",
  );
  await startHost(cohort, "removed");
  await command(
    process.execPath,
    [
      join(project, "scripts/compat/web.mjs"),
      join(output, "state.json"),
      "removed",
    ],
    project,
    "web-removed",
  );
  await stopHost();
  summary.checks.uninstall = true;
  assert.equal(
    createHash("sha256")
      .update(await readFile(archive))
      .digest("hex"),
    sha256,
    "验证期间候选包改变",
  );
  summary.status = "PASS";
  console.log(
    `${version}：无豁免安装、类型与 ${regression.numPassedTests} 项回归、Web 设置重启和卸载通过`,
  );
} catch (error) {
  summary.status = "FAIL";
  summary.error = error.message;
  process.exitCode = 1;
  console.error(`${version}：${error.message}`);
} finally {
  await stopHost();
  await save();
}
