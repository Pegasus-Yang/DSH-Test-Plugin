const field = (value, key) => value !== null && typeof value === "object" && Object.hasOwn(value, key)
    ? value[key]
    : undefined;
export const toolExtractSchema = {
    type: "object",
    required: ["from"],
    additionalProperties: false,
    properties: {
        from: {
            enum: ["structured", "value", "json", "text", "playwright-result"],
        },
        pointer: { type: "string", pattern: "^(?:|/.*)$" },
        block: { type: "integer", minimum: 0 },
        type: {
            enum: [
                "string",
                "number",
                "integer",
                "boolean",
                "object",
                "array",
                "null",
            ],
        },
        between: {
            type: "object",
            required: ["after", "before"],
            additionalProperties: false,
            properties: {
                after: { type: "string", minLength: 1 },
                before: { type: "string", minLength: 1 },
            },
        },
    },
};
export function toolResultError(result) {
    return (result.isError ||
        (Array.isArray(field(result.value, "content")) &&
            field(result.value, "isError") === true));
}
/** 只走自有字段；JSON Pointer 不支持通配符或表达式。 */
export function jsonPointer(value, pointer = "") {
    if (!pointer)
        return value;
    if (!pointer.startsWith("/") || /~(?![01])/.test(pointer))
        throw new Error("无效 JSON Pointer");
    for (const token of pointer.slice(1).split("/")) {
        const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
        if (value === null ||
            typeof value !== "object" ||
            !Object.hasOwn(value, key))
            throw new Error("工具结果缺少字段: " + pointer);
        value = value[key];
    }
    return value;
}
export function extractToolResult(result, extract) {
    if (toolResultError(result))
        throw new Error("采集工具执行失败");
    const packet = result.value;
    let value;
    if (extract.from === "structured") {
        value = field(packet, "structuredContent");
        if (value === undefined)
            throw new Error("工具未返回 structuredContent");
    }
    else if (extract.from === "value")
        value = packet;
    else {
        const packetContent = field(packet, "content");
        const content = Array.isArray(packetContent)
            ? packetContent
            : result.content;
        const block = content[extract.block ?? 0];
        if (field(block, "type") !== "text" ||
            typeof field(block, "text") !== "string")
            throw new Error("指定工具内容块不是文本");
        const text = field(block, "text");
        if (extract.from === "text")
            value = text;
        else if (extract.from === "json") {
            const fenced = text.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
            value = JSON.parse(fenced ? fenced[1] : text);
        }
        else {
            const match = text.match(/### Result\s*\n([\s\S]*?)(?=\n### |$)/);
            if (!match)
                throw new Error("MCP缺少结构化Result");
            value = JSON.parse(match[1].replace(/^```(?:json)?\s*\n?|\n?```$/g, ""));
        }
    }
    value = jsonPointer(value, extract.pointer);
    if (extract.between) {
        if (typeof value !== "string")
            throw new Error("分隔提取需要文本");
        const { after, before } = extract.between;
        const start = value.indexOf(after), end = value.indexOf(before, start + after.length);
        if (start < 0 ||
            end < 0 ||
            value.indexOf(after, start + after.length) >= 0 ||
            value.indexOf(before, end + before.length) >= 0)
            throw new Error("文本分隔没有唯一匹配");
        value = value.slice(start + after.length, end);
    }
    if (extract.type === "number" || extract.type === "integer") {
        if (typeof value === "string" &&
            /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.trim()))
            value = Number(value.trim());
        if (typeof value !== "number" ||
            !Number.isFinite(value) ||
            (extract.type === "integer" && !Number.isInteger(value)))
            throw new Error("工具结果不是明确数值");
    }
    else if (extract.type === "boolean") {
        if (value === "true")
            value = true;
        if (value === "false")
            value = false;
        if (typeof value !== "boolean")
            throw new Error("工具结果不是明确布尔值");
    }
    else if (extract.type &&
        (extract.type === "array"
            ? !Array.isArray(value)
            : extract.type === "null"
                ? value !== null
                : extract.type === "object"
                    ? value === null || typeof value !== "object" || Array.isArray(value)
                    : typeof value !== extract.type))
        throw new Error("工具结果类型不符: " + extract.type);
    if (value === undefined)
        throw new Error("工具结果没有实际值");
    return value;
}
