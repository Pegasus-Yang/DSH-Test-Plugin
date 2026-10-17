/** 由目标宿主的真实准入函数验证候选包及边界，不使用插件自行模拟的 semver。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluatePluginCompatibility } from "@deepseek-ai/dsh-app-boot";

const pkg = JSON.parse(readFileSync(process.argv[2], "utf8"));
const policy = JSON.parse(readFileSync(process.argv[3], "utf8"));
for (const version of policy.supportedHosts)
  assert.equal(evaluatePluginCompatibility(pkg, {}, version), undefined);
for (const version of [
  "0.2.0",
  "0.2.1-alpha.0",
  "0.2.1-alpha.4",
  "0.2.1-alpha.10",
  "0.2.1-rc.1",
  "0.2.1",
  "0.3.0",
]) {
  const refused = evaluatePluginCompatibility(pkg, {}, version);
  assert(
    refused && !refused.exempted && Object.keys(refused.peers).length === 22,
    `宿主错误放行 ${version}`,
  );
}
assert.throws(() =>
  evaluatePluginCompatibility({ ...pkg, peerDependencies: null }),
);
assert.throws(() => evaluatePluginCompatibility(pkg, {}, "invalid"));
console.log(
  "目标宿主真实准入：支持集合全部通过，范围外和畸形清单被拒绝，无豁免。",
);
