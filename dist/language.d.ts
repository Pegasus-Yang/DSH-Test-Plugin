/** 复用宿主语言偏好；浏览器自动语言未传到Host时沿用用户消息语言。 */
import type { Context } from "@deepseek-ai/cordis";
export declare function testLanguage(ctx: Context, task: string): string;
export declare function languageGuide(language: string): string;
