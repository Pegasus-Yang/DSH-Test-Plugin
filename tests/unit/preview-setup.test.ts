import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVolatile, updateVolatile } from "@deepseek-ai/cosmokit";
import { Config } from "../../src/config.js";
import { PreviewSetup, prepareMcpPreview } from "../../src/preview-setup.js";
import type { PreviewPreferences } from "../../src/preview-preferences.js";

const folders: string[] = [];
afterEach(() =>
  folders
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true })),
);
function folder() {
  const root = mkdtempSync(join(tmpdir(), "preview-setup-"));
  folders.push(root);
  return root;
}

it("声明的设置生成可读取引用，非法端口在保存前拒绝，旧预览配置仍可加载", () => {
  const config = Config({
    preview: {
      workDir: "/tmp/legacy",
      browscreenUrl: "http://127.0.0.1:13390",
    },
  });
  expect(config.browserPreview?.get()).toBeUndefined();
  expect(config.preview?.workDir).toBe("/tmp/legacy");
  expect(Config({ cancelGraceMs: 0.5 }).cancelGraceMs).toBe(0.5);
  expect(() =>
    Config({ browserPreview: { enabled: true, port: 65536 } }),
  ).toThrow();
  expect(() => Config({ browserPreview: { port: 2.5 } })).toThrow();
});

it("接入保留原有环境、浏览器参数和初始化脚本，重复准备不会再次改变 MCP 参数", () => {
  const root = folder();
  const source = join(root, "original.json");
  writeFileSync(
    source,
    JSON.stringify({
      network: { allowedOrigins: ["http://example.test"] },
      browser: {
        initPage: ["init.js"],
        launchOptions: { args: ["--lang=zh-CN"] },
        contextOptions: { viewport: { width: 900, height: 700 } },
      },
    }),
  );
  const config = {
    args: [
      "cli.js",
      "--headless",
      "--config",
      source,
      "--init-page",
      "another.js",
      "--isolated",
    ],
    env: { KEEP: "original" },
    cwd: root,
  };
  const next = prepareMcpPreview(
    config,
    join(root, "generated"),
    "/plugin/cdp-publisher.cjs",
  );
  const generated = JSON.parse(readFileSync(next.args!.at(-1)!, "utf8"));
  expect(generated.browser.initPage).toEqual([
    join(root, "init.js"),
    join(root, "another.js"),
    "/plugin/cdp-publisher.cjs",
  ]);
  expect(generated.browser.launchOptions.args).toEqual([
    "--lang=zh-CN",
    "--enable-automation",
    "--remote-debugging-port=0",
  ]);
  expect(generated.browser.contextOptions.viewport).toEqual({
    width: 900,
    height: 700,
  });
  expect(generated.network.allowedOrigins).toEqual(["http://example.test"]);
  expect(next.env).toMatchObject({
    KEEP: "original",
    DSH_TEST_PREVIEW_DIR: join(root, "generated"),
  });
  expect(next.args).toContain("--headless");
  expect(
    prepareMcpPreview(
      { ...config, ...next },
      join(root, "generated"),
      "/plugin/cdp-publisher.cjs",
    ),
  ).toEqual(next);
});

it("保存偏好不重启 MCP，下一次准备才接入；端口修改复用已有 MCP，关闭后不启动采集", async () => {
  const root = folder();
  const project = join(root, "Browscreen");
  mkdirSync(join(project, ".venv"), { recursive: true });
  writeFileSync(
    join(project, "pyproject.toml"),
    "[project]\nname='browscreen'\n",
  );
  const initializer = join(root, "cdp-publisher.cjs");
  writeFileSync(initializer, "module.exports = async () => {};\n");
  const preferences = createVolatile<PreviewPreferences | undefined>(undefined);
  const set = (value: PreviewPreferences) =>
    updateVolatile(preferences, createVolatile(value));
  const entry: any = {
    options: {
      id: "selected",
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        serverName: "playwright",
        transport: "stdio",
        args: ["@playwright/mcp@0.0.80", "--headless"],
      },
    },
  };
  const edit = vi.fn(async (_entry, change) => {
    // 配置编辑器取得锁后读取的最新值必须保留，不能被准备前的快照覆盖。
    entry.options.config.env = { KEEP_LATEST: "latest" };
    entry.options.config.args.push("--timeout-action", "20000");
    entry.options.config = change(entry.options.config);
  });
  const ctx: any = {
    fiber: { entry: { options: { id: "custom-test" } } },
    get: () => ({ entries: () => [entry], edit }),
  };
  const setup = new PreviewSetup(
    ctx,
    () => preferences.get(),
    { outputRoot: join(root, "runs") },
    initializer,
  );
  expect(await setup.prepare()).toBeUndefined();
  set({
    enabled: true,
    browscreenProject: project,
    port: 13390,
    mcpId: "selected",
  });
  expect(edit).not.toHaveBeenCalled();
  const prepared = await setup.prepare();
  expect(prepared).toMatchObject({
    browscreenProject: project,
    browscreenUrl: "http://127.0.0.1:13390",
  });
  expect(edit).toHaveBeenCalledTimes(1);
  expect(entry.options.config.env.KEEP_LATEST).toBe("latest");
  expect(entry.options.config.args).toContain("--timeout-action");
  expect(existsSync(join(prepared!.workDir, "owner.json"))).toBe(false);
  set({ ...preferences.get()!, port: 13391 });
  expect((await setup.prepare())?.browscreenUrl).toBe("http://127.0.0.1:13391");
  expect(edit).toHaveBeenCalledTimes(1);
  set({ ...preferences.get()!, enabled: false });
  expect(await setup.prepare()).toBeUndefined();
  expect(setup.describe()).toMatchObject({
    namespace: "custom-test",
    message: "实时预览已关闭。",
  });
});

it("不存在或不支持的 MCP 不会被修改，错误原因可展示", async () => {
  const root = folder();
  mkdirSync(join(root, ".venv"));
  writeFileSync(join(root, "pyproject.toml"), "");
  const initializer = join(root, "cdp-publisher.cjs");
  writeFileSync(initializer, "");
  const edit = vi.fn();
  const ctx: any = {
    fiber: { entry: { options: { id: "harness-test" } } },
    get: () => ({ entries: () => [], edit }),
  };
  const setup = new PreviewSetup(
    ctx,
    () => ({
      enabled: true,
      browscreenProject: root,
      port: 13390,
      mcpId: "missing",
    }),
    { outputRoot: root },
    initializer,
  );
  await expect(setup.prepare()).rejects.toThrow("请选择本机 stdio");
  setup.failed(new Error("没有找到所选浏览器"));
  expect(setup.describe().message).toContain("没有找到所选浏览器");
  expect(edit).not.toHaveBeenCalled();
});

it("非 Chromium 的 JSON 浏览器配置不会被补充 Chromium 参数或生成接入文件", () => {
  const root = folder();
  const config = join(root, "firefox.json");
  writeFileSync(
    config,
    JSON.stringify({ browser: { browserName: "firefox" } }),
  );
  const output = join(root, "generated");
  expect(() =>
    prepareMcpPreview(
      { args: ["cli.js", "--config", config] },
      output,
      "/plugin/cdp-publisher.cjs",
    ),
  ).toThrow("需要 Chromium");
  expect(existsSync(output)).toBe(false);
});
