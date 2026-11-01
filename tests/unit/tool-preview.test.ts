import { afterEach, expect, it, vi } from "vitest";
import {
  ToolPreview,
  imageFrame,
  type ToolPreviewRecipe,
} from "../../src/tool-preview.js";
import { TestToolCatalog } from "../../src/tool-runtime.js";
import { legacyBrowserTools } from "../../src/tool-capabilities.js";
import {
  runbridgeEnabled,
  browserPreferenceDefaults,
} from "../../src/browser-preferences.js";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
const result = (id = "page-one"): any => ({
  isError: false,
  value: { structuredContent: { id } },
  content: [{ type: "image", mimeType: "image/png", data: png }],
});
const recipe: ToolPreviewRecipe = {
  tool_name: "mcp__custom__photo",
  mode: "poll",
  context: { from: "structured", pointer: "/id" },
  frame_context: { from: "structured", pointer: "/id" },
};
function setup() {
  const entries = new Map(
    ["mcp__custom__go", "mcp__custom__photo", "mcp__other__photo"].map(
      (name) => [
        name,
        { name, description: "真实页面与截图", parameters: { type: "object" } },
      ],
    ),
  );
  const catalog = new TestToolCatalog({
    schemas: () => [...entries.values()],
    get: (name: string) => entries.get(name),
  } as any);
  const frame = vi.fn(),
    clear = vi.fn(),
    event = vi.fn(),
    cdp = vi.fn();
  let viewing = true;
  const dispatch = vi.fn(async () => result());
  const preview = new ToolPreview({
    catalog: () => catalog,
    frame,
    clear,
    event,
    cdp,
    viewing: () => viewing,
    poll: async () => preview.capture(dispatch),
  });
  preview.bind({
    callId: "original-call",
    tool: "mcp__custom__go",
    caseId: "case-one",
    result: result(),
  });
  return {
    preview,
    frame,
    clear,
    event,
    dispatch,
    entries,
    cdp,
    view: (next: boolean) => (viewing = next),
  };
}
afterEach(() => vi.useRealTimers());
it("首帧只确认单次图片；相同原页面再次采集后才标记定时截图", async () => {
  vi.useFakeTimers();
  const t = setup();
  expect((await t.preview.connect(recipe, t.dispatch)).mode).toBe("once");
  await vi.advanceTimersByTimeAsync(2000);
  expect(t.dispatch).toHaveBeenCalledTimes(2);
  expect(t.preview.state().mode).toBe("poll");
  expect(t.frame.mock.calls[1][0]).toMatchObject({
    callId: "original-call",
    caseId: "case-one",
  });
  t.view(false);
  await vi.advanceTimersByTimeAsync(6000);
  expect(t.dispatch).toHaveBeenCalledTimes(2);
  t.preview.stop();
  await vi.advanceTimersByTimeAsync(4000);
  expect(t.dispatch).toHaveBeenCalledTimes(2);
});
it("画面工具必须来自实际操作来源，不能误接另一个已注册浏览器", async () => {
  const t = setup();
  await expect(
    t.preview.connect(
      { ...recipe, tool_name: "mcp__other__photo" },
      t.dispatch,
    ),
  ).rejects.toThrow("另一浏览器");
  expect(t.dispatch).not.toHaveBeenCalled();
  t.preview.stop();
});
it("返回身份不一致、损坏图片及纯文字均不能生成已连接状态", async () => {
  const t = setup();
  t.dispatch.mockResolvedValueOnce(result("other-page"));
  expect((await t.preview.connect(recipe, t.dispatch)).mode).toBe("unverified");
  expect(t.frame).not.toHaveBeenCalled();
  t.dispatch.mockResolvedValueOnce({
    isError: false,
    value: { structuredContent: { id: "page-one" } },
    content: [{ type: "text", text: "已连接，画面正常" }],
  } as any);
  expect((await t.preview.connect(recipe, t.dispatch)).mode).toBe(
    "unavailable",
  );
  expect(() =>
    imageFrame({
      isError: false,
      content: [{ type: "image", mimeType: "image/png", data: "AAAA" }],
    } as any),
  ).toThrow();
  t.preview.stop();
});
it("原页面身份由真实动作返回注入，不接受预填的另一资源", async () => {
  const t = setup();
  await t.preview.connect(
    {
      ...recipe,
      mode: "once",
      frame_context: undefined,
      identity_argument: "context_id",
      arguments: { context_id: "other-page" },
    },
    t.dispatch,
  );
  expect(t.dispatch).toHaveBeenCalledWith(recipe.tool_name, {
    context_id: "page-one",
  });
  t.preview.stop();
});
it("探索达到预算后停止派发，手动重新尝试可以重新验证", async () => {
  const t = setup();
  t.dispatch.mockResolvedValue({ isError: true, content: [] } as any);
  for (let i = 0; i < 3; i++) await t.preview.connect(recipe, t.dispatch);
  await expect(t.preview.connect(recipe, t.dispatch)).rejects.toThrow("预算");
  expect(t.dispatch).toHaveBeenCalledTimes(3);
  t.preview.retry();
  await t.preview.connect(recipe, t.dispatch);
  expect(t.dispatch).toHaveBeenCalledTimes(4);
  t.preview.stop();
});
it("来源或实例改变后清除旧图片和方法；工具定义漂移不会沿用轮询", async () => {
  const t = setup();
  await t.preview.connect({ ...recipe, mode: "once" }, t.dispatch);
  t.entries.set(recipe.tool_name, {
    name: recipe.tool_name,
    description: "已重连到新定义",
    parameters: { type: "object" },
  });
  await t.preview.capture(t.dispatch);
  expect(t.preview.state().mode).toBe("unavailable");
  expect(t.dispatch).toHaveBeenCalledTimes(1);
  t.preview.bind({
    callId: "next",
    tool: "mcp__other__photo",
    caseId: "case-two",
    result: result("two"),
  });
  expect(t.preview.state()).toMatchObject({
    mode: "waiting",
    frames: 0,
    attempts: 0,
  });
  expect(t.clear).toHaveBeenCalled();
  t.preview.stop();
});
it("未打开实际页面时只等待，不调用图片工具，也不创建浏览器", async () => {
  const t = setup();
  t.preview.stop();
  await expect(t.preview.connect(recipe, t.dispatch)).rejects.toThrow(
    "实际页面",
  );
  expect(t.dispatch).not.toHaveBeenCalled();
});
it("旧DOM绑定随实际来源选择，更名的兼容工具仍可用，多来源未选择时保持待绑定", () => {
  const entries: any = [
    { name: "mcp__renamed__browser_evaluate" },
    { name: "mcp__renamed__browser_close" },
    { name: "mcp__remote__browser_capture" },
  ];
  expect(legacyBrowserTools(entries)).toEqual({});
  expect(
    legacyBrowserTools(entries, "mcp__renamed__browser_close").evaluate,
  ).toBe("mcp__renamed__browser_evaluate");
  expect(
    legacyBrowserTools(entries, "mcp__remote__browser_capture").evaluate,
  ).toBeUndefined();
  expect(
    runbridgeEnabled({ ...browserPreferenceDefaults, backend: "runbridge" }),
  ).toBe(true);
  expect(
    runbridgeEnabled({
      ...browserPreferenceDefaults,
      backend: "runbridge",
      runbridgeEnabled: false,
    }),
  ).toBe(false);
});

it("跨来源画面必须同时核对真实浏览器与原页面身份", async () => {
  const t = setup();
  t.preview.bind({
    callId: "original",
    tool: "mcp__custom__go",
    caseId: "case-one",
    result: {
      ...result(),
      value: { structuredContent: { id: "page-one", browser: "browser-one" } },
    },
  });
  const cross = {
    ...recipe,
    tool_name: "mcp__other__photo",
    mode: "once" as const,
    source_context: { from: "structured" as const, pointer: "/browser" },
    frame_source_context: { from: "structured" as const, pointer: "/browser" },
  };
  t.dispatch.mockResolvedValueOnce({
    ...result(),
    value: { structuredContent: { id: "page-one", browser: "different" } },
  });
  expect((await t.preview.connect(cross, t.dispatch)).mode).toBe("unverified");
  expect(t.frame).not.toHaveBeenCalled();
  t.dispatch.mockResolvedValueOnce({
    ...result(),
    value: { structuredContent: { id: "page-one", browser: "browser-one" } },
  });
  expect((await t.preview.connect(cross, t.dispatch)).mode).toBe("once");
  expect(t.frame).toHaveBeenCalledTimes(1);
  t.preview.stop();
});
it("相同 URL 不能代替原页面身份，也不会派发截图", async () => {
  const t = setup();
  t.preview.bind({
    callId: "url",
    tool: "mcp__custom__go",
    caseId: "case-one",
    result: result("https://example.test/"),
  });
  await expect(t.preview.connect(recipe, t.dispatch)).rejects.toThrow("URL");
  expect(t.dispatch).not.toHaveBeenCalled();
  t.preview.stop();
});

it("旧 RunBridge 独立开关迁移保留，第二版保存后统一使用媒体偏好", async () => {
  const { effectivePreviewPreferences, previewPreferenceDefaults } =
    await import("../../src/preview-preferences.js");
  const browser = {
    ...browserPreferenceDefaults,
    backend: "runbridge" as const,
    previewEnabled: true,
  };
  expect(
    effectivePreviewPreferences(browser, {
      ...previewPreferenceDefaults,
      schemaVersion: undefined,
      enabled: false,
    })?.enabled,
  ).toBe(true);
  expect(
    effectivePreviewPreferences(browser, {
      ...previewPreferenceDefaults,
      enabled: false,
    })?.enabled,
  ).toBe(false);
  expect(
    effectivePreviewPreferences(
      { ...browser, previewEnabled: false },
      undefined,
    )?.enabled,
  ).toBe(false);
});

it.each(["https://same.example/", "page-one"])(
  "跨来源不能用 URL 或重复的页面身份充当浏览器身份：%s",
  async (browser) => {
    const t = setup();
    t.dispatch.mockResolvedValue({
      ...result(),
      value: { structuredContent: { id: "page-one", browser } },
    });
    t.preview.bind({
      callId: "source",
      tool: "mcp__custom__go",
      caseId: "case-one",
      result: {
        ...result(),
        value: { structuredContent: { id: "page-one", browser } },
      },
    });
    await expect(
      t.preview.connect(
        {
          ...recipe,
          tool_name: "mcp__other__photo",
          source_context: { from: "structured", pointer: "/browser" },
          frame_source_context: { from: "structured", pointer: "/browser" },
        },
        t.dispatch,
      ),
    ).rejects.toThrow("浏览器身份");
    expect(t.dispatch).not.toHaveBeenCalled();
    t.preview.stop();
  },
);
