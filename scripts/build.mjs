/** 构建前清理生成目录，避免已删除的旧插件模块进入发行包。 */
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/typescript/bin/tsc", import.meta.url),
    ),
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
