/** 核对发行清单中的入口文件，避免只有源码的包被误认为可用插件。 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const directory = resolve(process.argv[2] ?? ".");
const pkg = JSON.parse(
  readFileSync(resolve(directory, "package.json"), "utf8"),
);
const paths = new Set([pkg.main, pkg.types, pkg.dsh?.bundle?.patch]);
function collect(value) {
  if (typeof value === "string") paths.add(value);
  else if (value && typeof value === "object")
    Object.values(value).forEach(collect);
}
collect(pkg.exports);
for (const path of paths) {
  if (!path || path.includes("*")) continue;
  assert(existsSync(resolve(directory, path)), `安装包缺少入口文件：${path}`);
}
const client = readFileSync(resolve(directory, "dist/client.js"), "utf8");
assert(
  client.includes('window.__ModuleLoader__.load({id:"dsh-test-plugin"'),
  "浏览器入口未按宿主模块协议构建",
);
console.log(`插件 ${pkg.version} 的宿主、浏览器、CDP 和声明入口完整。`);
