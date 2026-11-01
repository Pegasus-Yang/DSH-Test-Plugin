/** 支持集合是发行声明和宿主矩阵的共同来源；构建只检查，不改写清单。 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const isDsh = (name) =>
  name === "@deepseek-ai/dsh" || name.startsWith("@deepseek-ai/dsh-");
export function validatePolicy(policy) {
  const exact = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
  assert(policy && typeof policy === "object", "缺少 DSH 兼容策略");
  assert(
    Array.isArray(policy.supportedHosts) && policy.supportedHosts.length > 0,
    "supportedHosts 必须是非空精确版本集合",
  );
  assert(
    policy.supportedHosts.every((v) => typeof v === "string" && exact.test(v)),
    "supportedHosts 只能填写精确版本",
  );
  assert.equal(
    new Set(policy.supportedHosts).size,
    policy.supportedHosts.length,
    "supportedHosts 存在重复版本",
  );
  assert(
    policy.supportedHosts.includes(policy.buildSdk),
    "构建 SDK 必须属于支持集合",
  );
  return policy.supportedHosts.join(" || ");
}

export function assertSupportedHost(policy, version) {
  validatePolicy(policy);
  assert(policy.supportedHosts.includes(version), `未声明支持 DSH ${version}`);
}

/** 按版本语义选择最旧和最新宿主，保留完整安装支持集合。 */
export function verificationHosts(policy) {
  validatePolicy(policy);
  const compare = (left, right) => {
    const [a, ap] = left.split(/-(.*)/, 2);
    const [b, bp] = right.split(/-(.*)/, 2);
    const ac = a.split(".").map(BigInt),
      bc = b.split(".").map(BigInt);
    for (let i = 0; i < 3; i++)
      if (ac[i] !== bc[i]) return ac[i] < bc[i] ? -1 : 1;
    if (ap === undefined || bp === undefined)
      return ap === bp ? 0 : ap === undefined ? 1 : -1;
    const ai = ap.split("."),
      bi = bp.split(".");
    for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
      if (ai[i] === bi[i]) continue;
      if (ai[i] === undefined) return -1;
      if (bi[i] === undefined) return 1;
      const an = /^\d+$/.test(ai[i]),
        bn = /^\d+$/.test(bi[i]);
      if (an && bn) return BigInt(ai[i]) < BigInt(bi[i]) ? -1 : 1;
      if (an !== bn) return an ? -1 : 1;
      return ai[i] < bi[i] ? -1 : 1;
    }
    return 0;
  };
  const sorted = [...policy.supportedHosts].sort(compare);
  return [...new Set([sorted[0], sorted.at(-1)])];
}

export function checkCompatibility(pkg, policy) {
  const range = validatePolicy(policy);
  const peers = Object.entries(pkg.peerDependencies ?? {}).filter(([name]) =>
    isDsh(name),
  );
  assert(peers.length > 0, "发行包缺少 DSH peer 声明");
  for (const [name, value] of peers)
    assert.equal(value, range, `${name} 的支持范围与策略不一致`);
  const sdk = Object.entries(pkg.devDependencies ?? {}).filter(([name]) =>
    isDsh(name),
  );
  assert(sdk.length > 0, "缺少构建 SDK 声明");
  for (const [name, value] of sdk)
    assert.equal(
      value,
      policy.buildSdk,
      `${name} 的开发版本与 buildSdk 不一致`,
    );
  if (pkg.engines?.dsh !== undefined)
    assert.equal(pkg.engines.dsh, range, "engines.dsh 与 peer 支持范围不一致");
  return { range, peers: peers.length };
}

export function readCompatibility(directory = ".") {
  const read = (file) =>
    JSON.parse(readFileSync(resolve(directory, file), "utf8"));
  return { pkg: read("package.json"), policy: read("dsh-compatibility.json") };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [mode = "check", directory = "."] = process.argv.slice(2);
  const { pkg, policy } = readCompatibility(directory);
  const range = validatePolicy(policy);
  if (mode === "sync") {
    for (const name of Object.keys(pkg.peerDependencies ?? {}))
      if (isDsh(name)) pkg.peerDependencies[name] = range;
    if (pkg.engines?.dsh !== undefined) pkg.engines.dsh = range;
    writeFileSync(
      resolve(directory, "package.json"),
      JSON.stringify(pkg, null, 2) + "\n",
    );
  } else
    assert(
      ["check", "matrix"].includes(mode),
      "用法：dsh-compatibility.mjs check|sync|matrix [目录]",
    );
  const result = checkCompatibility(pkg, policy);
  console.log(
    mode === "matrix"
      ? JSON.stringify({ host: verificationHosts(policy) })
      : `DSH ${result.peers} 个 peer：${result.range}；构建 SDK ${policy.buildSdk}`,
  );
}
