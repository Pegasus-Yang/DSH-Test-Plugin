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
const result = spawnSync(process.execPath, [cli, "install", "chromium"], {
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
