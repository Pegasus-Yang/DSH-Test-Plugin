/** 生成宿主模块加载器支持的浏览器插件；React由宿主提供。 */
import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
const result = await build({
  entryPoints: ["src/client.ts"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["react", "@deepseek-ai/*"],
});
await writeFile(
  "dist/client.js",
  `window.__ModuleLoader__.load({id:"dsh-test-plugin",factory(require){
var module={exports:{}};var exports=module.exports;
${result.outputFiles[0].text}
return module.exports;
}});\n`,
);
