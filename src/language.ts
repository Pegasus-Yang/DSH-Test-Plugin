/** 复用宿主语言偏好；浏览器自动语言未传到Host时沿用用户消息语言。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import { field } from "./contracts.js";

export function testLanguage(ctx: Context, task: string): string {
  const locale = ctx
    .get?.("settings")
    ?.describe({ redactSecrets: true })
    .find((s) => s.ns === "locale");
  const preference = field(locale?.value, "preference");
  return typeof preference === "string" && preference
    ? preference
    : /[\u3400-\u9fff]/u.test(task)
      ? "zh"
      : "en";
}

export function languageGuide(language: string): string {
  return `语言要求 / Language rule: 当前DSH会话输出语言为 ${language}。${language.startsWith("zh") ? "面向用户的文字必须使用简体中文，不要使用I'll、Let me、Now等英文过程描述。" : `All user-visible explanations must use locale ${language}.`}
对话中的简短分析摘要、拆分说明、计划名称与步骤、执行进度、工具调用说明(reason)、追问和最终回复都遵循此语言；不得因工具名或宿主英文提示切换语言。仅URL、代码、字段名、原始响应和用户原文保留原样。提供简短的决策说明即可，不展开私有推理过程。`;
}
