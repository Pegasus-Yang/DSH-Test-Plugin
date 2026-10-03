/** 将开发依赖指向已构建的本地宿主，不修改宿主源码。 */
import {
  readdir,
  readFile,
  mkdir,
  symlink,
  lstat,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
const host = resolve(process.argv[2] ?? process.env.DSH_SOURCE_ROOT ?? "");
if (!process.argv[2] && !process.env.DSH_SOURCE_ROOT)
  throw new Error("请提供 Harness 源码根目录");
const paths = [];
for (const group of await readdir(join(host, "packages"))) {
  const folder = join(host, "packages", group);
  if (!(await lstat(folder)).isDirectory()) continue;
  for (const name of await readdir(folder)) paths.push(join(folder, name));
}
for (const name of await readdir(join(host, "vendor")))
  paths.push(join(host, "vendor", name));
let count = 0;
for (const folder of paths) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
    throw error;
  }
  if (!pkg.name?.startsWith("@deepseek-ai/")) continue;
  const target = resolve("node_modules", pkg.name);
  await mkdir(resolve("node_modules/@deepseek-ai"), { recursive: true });
  try {
    await symlink(folder, target, "dir");
    count++;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
await mkdir(".local", { recursive: true });
await writeFile(".local/host.json", JSON.stringify({ host }, null, 2) + "\n");
console.log(`已链接 ${count} 个本地宿主包；本机路径仅保存于忽略目录 .local`);
