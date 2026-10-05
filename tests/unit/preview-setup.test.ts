import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVolatile, updateVolatile } from "@deepseek-ai/cosmokit";
import { FiberState } from "@deepseek-ai/cordis";
import { Config } from "../../src/config.js";
import { PreviewSetup, prepareMcpPreview } from "../../src/preview-setup.js";
import type { PreviewPreferences } from "../../src/preview-preferences.js";

// 发布的 Cordis 使用 const enum，Vitest 转译源文件时需补充其声明值。
vi.mock("@deepseek-ai/cordis", async (original) => ({
  ...(await original<typeof import("@deepseek-ai/cordis")>()),
  FiberState: {
    PENDING: 0,
    LOADING: 1,
    ACTIVE: 2,
    FAILED: 3,
    DISPOSED: 4,
    UNLOADING: 5,
  },
}));

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

function runtime(entries: any[], namespace = "custom-test") {
  let hook: any;
  const detach = vi.fn(() => {
    hook = undefined;
    return true;
  });
  const edit = vi.fn();
  const ctx: any = {
    fiber: { entry: { options: { id: namespace } } },
    root: { fiber: { uid: 0, state: FiberState.ACTIVE } },
    get: () => ({ entries: () => entries, edit }),
    on: vi.fn((_event, callback, options) => {
      expect(options).toEqual({ global: true });
      hook = callback;
      return detach;
    }),
  };
  for (const entry of entries)
    entry.fiber = {
      uid: 1,
      state: FiberState.ACTIVE,
      config: structuredClone(entry.options.config),
      restart: vi.fn(async () => {
        const value = structuredClone(entry.options.config);
        entry.fiber.config = hook
          ? hook.call({ entry }, value, () => value)
          : value;
      }),
    };
  return { ctx, edit, detach };
}

it("设置与运行配置默认使用本机命令，非法端口在保存前拒绝", () => {
  const config = Config({
    preview: {
      workDir: "/tmp/preview-cli",
      browscreenUrl: "http://127.0.0.1:13390",
    },
  });
  expect(config.browserPreview?.get()).toBeUndefined();
  expect(config.preview?.browscreenExecutable).toBe("browscreen");
  expect(config.preview?.recordingEnabled).toBe(false);
  expect(
    Config({ browserPreview: {} }).browserPreview?.get()?.recordingEnabled,
  ).toBe(false);
  expect(
    Config({ browserPreview: { enabled: false } }).browserPreview?.get()
      ?.browscreenExecutable,
  ).toBe("browscreen");
  expect(Config({ cancelGraceMs: 0.5 }).cancelGraceMs).toBe(0.5);
  expect(() =>
    Config({ browserPreview: { enabled: true, port: 65536 } }),
  ).toThrow();
  expect(() => Config({ browserPreview: { port: 2.5 } })).toThrow();
});

it("接入保留原有环境、浏览器参数和初始化脚本，重复准备不会再次改变 MCP 参数", () => {
  const root = folder();
  const initializer = join(root, "cdp-publisher.cjs");
  writeFileSync(initializer, "module.exports = async () => {};\n");
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
  const next = prepareMcpPreview(config, join(root, "generated"), initializer);
  const generated = JSON.parse(readFileSync(next.args!.at(-1)!, "utf8"));
  expect(generated.browser.initPage).toEqual([
    join(root, "init.js"),
    join(root, "another.js"),
    expect.stringMatching(/cdp-publisher-[a-f0-9]{12}\.cjs$/),
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
      initializer,
    ),
  ).toEqual(next);
});

it("接入只改变 MCP 运行配置；端口修改复用连接，关闭后恢复原始参数", async () => {
  const root = folder();
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
  const raw = structuredClone(entry.options.config);
  const { ctx, edit } = runtime([entry]);
  const setup = new PreviewSetup(
    ctx,
    () => preferences.get(),
    { outputRoot: join(root, "runs") },
    initializer,
  );
  expect(await setup.prepare()).toBeUndefined();
  set({
    enabled: true,
    browscreenExecutable: "/tmp/installed browscreen/browscreen",
    port: 13390,
    mcpId: "selected",
  });
  expect(edit).not.toHaveBeenCalled();
  const prepared = await setup.prepare();
  expect(prepared).toMatchObject({
    browscreenExecutable: "/tmp/installed browscreen/browscreen",
    browscreenUrl: "http://127.0.0.1:13390",
  });
  expect(edit).not.toHaveBeenCalled();
  expect(entry.fiber.restart).toHaveBeenCalledTimes(1);
  expect(entry.options.config).toEqual(raw);
  expect(entry.fiber.config.env.DSH_TEST_PREVIEW_DIR).toBe(prepared!.workDir);
  expect(existsSync(join(prepared!.workDir, "owner.json"))).toBe(false);
  set({ ...preferences.get()!, port: 13391 });
  expect((await setup.prepare())?.browscreenUrl).toBe("http://127.0.0.1:13391");
  expect(entry.fiber.restart).toHaveBeenCalledTimes(1);
  set({ ...preferences.get()!, enabled: false });
  expect(await setup.prepare()).toBeUndefined();
  expect(entry.fiber.restart).toHaveBeenCalledTimes(2);
  expect(entry.fiber.config).toEqual(raw);
  expect(setup.describe()).toMatchObject({
    namespace: "custom-test",
    message: "实时预览和录像均已关闭。",
  });
});

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "预览 %s 与录制 %s 独立决定接入，两者均关闭才恢复浏览器",
  async (enabled, recordingEnabled) => {
    const root = folder();
    const initializer = join(root, "cdp-publisher.cjs");
    writeFileSync(initializer, "module.exports = async () => {};\n");
    const entry: any = {
      options: {
        id: "selected",
        name: "@deepseek-ai/dsh-mcp-client",
        config: {
          serverName: "playwright",
          transport: "stdio",
          args: ["@playwright/mcp@0.0.68"],
        },
      },
    };
    const { ctx } = runtime([entry]);
    const setup = new PreviewSetup(
      ctx,
      () => ({
        enabled,
        recordingEnabled,
        browscreenExecutable: "browscreen",
        port: 13390,
        mcpId: "selected",
      }),
      { outputRoot: root },
      initializer,
    );
    const prepared = await setup.prepare();
    if (enabled || recordingEnabled) {
      expect(prepared).toMatchObject({
        previewEnabled: enabled,
        recordingEnabled,
      });
      expect(entry.fiber.restart).toHaveBeenCalledOnce();
    } else {
      expect(prepared).toBeUndefined();
      expect(entry.fiber.restart).not.toHaveBeenCalled();
    }
    await setup.dispose();
  },
);

it("不存在或不支持的 MCP 不会被修改，错误原因可展示", async () => {
  const root = folder();
  const initializer = join(root, "cdp-publisher.cjs");
  writeFileSync(initializer, "");
  const { ctx, edit } = runtime([], "harness-test");
  const setup = new PreviewSetup(
    ctx,
    () => ({
      enabled: true,
      browscreenExecutable: "browscreen",
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

it("删除插件文件后运行副本仍有效，卸载解除接入并保留最新用户配置", async () => {
  const root = folder();
  const initializer = join(root, "plugin", "cdp-publisher.cjs");
  const plugin = join(root, "plugin");
  mkdirSync(plugin);
  writeFileSync(initializer, "module.exports = async () => {};\n");
  const entry: any = {
    options: {
      id: "selected",
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        serverName: "playwright",
        transport: "stdio",
        args: ["@playwright/mcp@0.0.80", "--headless"],
        env: { KEEP: "user" },
      },
    },
  };
  const { ctx, edit, detach } = runtime([entry]);
  const setup = new PreviewSetup(
    ctx,
    () => ({
      enabled: true,
      browscreenExecutable: "browscreen",
      port: 13390,
      mcpId: "selected",
    }),
    { outputRoot: root },
    initializer,
  );
  await setup.prepare();
  const generated = JSON.parse(
    readFileSync(entry.fiber.config.args.at(-1), "utf8"),
  );
  const copy = generated.browser.initPage.at(-1);
  expect(copy).not.toBe(initializer);
  rmSync(plugin, { recursive: true });
  expect(existsSync(copy)).toBe(true);
  // 用户接入期间调整普通配置，退出接入时仍应使用最新的原始值。
  entry.options.config.args.push("--timeout-action", "20000");
  entry.options.config.env.KEEP = "latest";
  await setup.dispose();
  expect(detach).toHaveBeenCalledOnce();
  expect(entry.fiber.config).toEqual(entry.options.config);
  expect(entry.fiber.config.env).toEqual({ KEEP: "latest" });
  expect(entry.fiber.config.args).not.toContain("--config");
  expect(edit).not.toHaveBeenCalled();
});

it("切换浏览器先恢复旧实例，接入不影响其他 MCP", async () => {
  const root = folder();
  const initializer = join(root, "cdp-publisher.cjs");
  writeFileSync(initializer, "module.exports = async () => {};\n");
  const entries: any[] = ["first", "second"].map((id) => ({
    options: {
      id,
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        serverName: "playwright",
        transport: "stdio",
        args: ["@playwright/mcp@0.0.80", "--isolated"],
      },
    },
  }));
  const { ctx } = runtime(entries);
  let mcpId = "first";
  const setup = new PreviewSetup(
    ctx,
    () => ({
      enabled: true,
      browscreenExecutable: "browscreen",
      port: 13390,
      mcpId,
    }),
    { outputRoot: root },
    initializer,
  );
  await setup.prepare();
  await entries[1].fiber.restart();
  expect(entries[1].fiber.config).toEqual(entries[1].options.config);
  mcpId = "second";
  await setup.prepare();
  expect(entries[0].fiber.config).toEqual(entries[0].options.config);
  expect(entries[1].fiber.config.env.DSH_TEST_PREVIEW_DIR).toBeDefined();
  await setup.dispose();
  expect(entries[1].fiber.config).toEqual(entries[1].options.config);
});

it("整个宿主关闭时卸载接入不会重新启动正在退出的 MCP", async () => {
  const root = folder();
  const initializer = join(root, "cdp-publisher.cjs");
  writeFileSync(initializer, "module.exports = async () => {};\n");
  const entry: any = {
    options: {
      id: "selected",
      name: "@deepseek-ai/dsh-mcp-client",
      config: {
        serverName: "playwright",
        transport: "stdio",
        args: ["@playwright/mcp@0.0.80"],
      },
    },
  };
  const { ctx } = runtime([entry]);
  const setup = new PreviewSetup(
    ctx,
    () => ({
      enabled: true,
      browscreenExecutable: "browscreen",
      port: 13390,
      mcpId: "selected",
    }),
    { outputRoot: root },
    initializer,
  );
  await setup.prepare();
  ctx.root.fiber.state = FiberState.UNLOADING;
  await setup.dispose();
  expect(entry.fiber.restart).toHaveBeenCalledTimes(1);
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
