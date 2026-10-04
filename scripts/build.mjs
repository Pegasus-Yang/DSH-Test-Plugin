/** 构建前清理生成目录，避免已删除的旧插件模块进入发行包。 */
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
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
if (result.status !== 0) process.exit(result.status ?? 1);
// 宿主的公开浏览器模块协议：延迟执行 CommonJS 工厂，共享宿主 React。
await build({
  entryPoints: ["src/client/index.ts"],
  outfile: "dist/client.js",
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  jsx: "automatic",
  external: [
    "react",
    "react/jsx-runtime",
    "@deepseek-ai/dsh-client-ui-primitives",
  ],
  sourcemap: true,
  banner: {
    js: 'window.__ModuleLoader__.load({id:"dsh-test-plugin",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
});
// 当前 MCP 的初始化扩展加载器使用 CommonJS，避免 ESM preflight 限制。
await build({
  entryPoints: ["src/cdp-publisher.ts"],
  outfile: "dist/cdp-publisher.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
});
