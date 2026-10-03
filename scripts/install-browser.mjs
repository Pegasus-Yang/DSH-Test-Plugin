/** 安装当前MCP自身依赖版本的浏览器，避免混用系统Chrome与另一版本Playwright。 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const mcpRequire = createRequire(
  require.resolve("@playwright/mcp/package.json"),
);
const cli = join(
  dirname(mcpRequire.resolve("playwright/package.json")),
  "cli.js",
);
const validationCli = join(
  dirname(require.resolve("playwright/package.json")),
  "cli.js",
);
for (const executable of new Set([cli, validationCli])) {
  const result = spawnSync(
    process.execPath,
    [executable, "install", "chromium"],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
