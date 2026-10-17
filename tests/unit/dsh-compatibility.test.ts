import { afterEach, describe, expect, it } from "vitest";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertSupportedHost,
  checkCompatibility,
  validatePolicy,
} from "../../scripts/dsh-compatibility.mjs";

const read = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));
const policy = read("dsh-compatibility.json");
const manifest = () => read("package.json");
const temporary: string[] = [];
afterEach(() =>
  temporary
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true })),
);

describe("DSH 多版本发行合同", () => {
  it("支持集合内的宿主使用同一份包声明", () => {
    expect(checkCompatibility(manifest(), policy).peers).toBe(22);
    for (const host of policy.supportedHosts)
      expect(() => assertSupportedHost(policy, host)).not.toThrow();
  });
  it.each([
    "0.2.0",
    "0.2.1-alpha.0",
    "0.2.1-alpha.4",
    "0.2.1-alpha.10",
    "0.2.1-rc.1",
    "0.2.1",
    "0.3.0",
  ])("不放行未验证宿主 %s", (host) => {
    expect(() => assertSupportedHost(policy, host)).toThrow("未声明支持");
  });
  it.each([[], ["*"], [">=0.2.1-alpha.1"], ["0.2.1-alpha.1", "0.2.1-alpha.1"]])(
    "拒绝空、宽泛或重复的集合 %j",
    (supportedHosts) => {
      expect(() => validatePolicy({ ...policy, supportedHosts })).toThrow();
    },
  );
  it("升级开发 SDK 不能隐式改变支持集合", () => {
    expect(() =>
      validatePolicy({ ...policy, buildSdk: "0.2.1-alpha.4" }),
    ).toThrow("构建 SDK");
    const pkg = manifest();
    pkg.devDependencies["@deepseek-ai/dsh-agent"] = "0.2.1-alpha.2";
    expect(() => checkCompatibility(pkg, policy)).toThrow("开发版本");
  });
  it("可选 peer 同样不能漂移或放宽到未来版本", () => {
    const pkg = manifest();
    pkg.peerDependencies["@deepseek-ai/dsh-plan-mode"] = "*";
    expect(() => checkCompatibility(pkg, policy)).toThrow("支持范围");
  });
  it("不能删光 peer，或让新宿主声明偏离旧宿主声明", () => {
    expect(() =>
      checkCompatibility({ ...manifest(), peerDependencies: {} }, policy),
    ).toThrow("缺少 DSH peer");
    expect(() =>
      checkCompatibility({ ...manifest(), engines: { dsh: "*" } }, policy),
    ).toThrow("engines.dsh");
  });
  it.each(["missing-entry", "missing-policy", "runtime-version"])(
    "发行检查拒绝不完整或版本漂移的包 %s",
    (kind) => {
      const root = mkdtempSync(join(tmpdir(), "dsh-package-"));
      temporary.push(root);
      for (const name of [
        "package.json",
        "dsh-compatibility.json",
        "dist",
        "cordis.patch.yml",
        "icon.svg",
      ])
        cpSync(new URL(`../../${name}`, import.meta.url), join(root, name), {
          recursive: true,
        });
      if (kind === "missing-entry") rmSync(join(root, "dist/index.js"));
      if (kind === "missing-policy")
        rmSync(join(root, "dsh-compatibility.json"));
      if (kind === "runtime-version")
        writeFileSync(
          join(root, "dist/native-test.js"),
          'plugin_version: "0.0.0"',
        );
      const checked = spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("../../scripts/check-package.mjs", import.meta.url),
          ),
          root,
        ],
        { encoding: "utf8" },
      );
      expect(checked.status).toBe(1);
      expect(checked.stderr).toContain(
        kind === "missing-entry"
          ? "安装包缺少入口文件"
          : kind === "missing-policy"
            ? "dsh-compatibility.json"
            : "运行记录版本",
      );
    },
  );
});
