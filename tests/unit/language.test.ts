import { expect, it, vi } from "vitest";
import { languageGuide, testLanguage } from "../../src/language.js";

it("优先读取DSH实时语言偏好，不改写宿主设置", () => {
  let preference = "zh";
  const describe = vi.fn(() => [{ ns: "locale", value: { preference } }]);
  const ctx = { get: () => ({ describe }) } as never;
  expect(testLanguage(ctx, "English task")).toBe("zh");
  preference = "en";
  expect(testLanguage(ctx, "中文任务")).toBe("en");
  expect(describe).toHaveBeenCalledWith({ redactSecrets: true });
  expect(languageGuide("zh")).toContain("面向用户的文字必须使用简体中文");
  expect(languageGuide("zh")).toContain("工具调用说明(reason)");
});
it("宿主未提供显式语言时沿用用户当前消息语言", () => {
  expect(testLanguage({} as never, "检查点赞数不为0")).toBe("zh");
  expect(testLanguage({} as never, "Check status equals 200")).toBe("en");
});
