import { inflateSync } from "node:zlib";
import { extractToolResult, toolResultError, } from "./tool-results.js";
import { toolArguments } from "./tool-runtime.js";
import { toolSource } from "./tool-capabilities.js";
export function imageFrame(result) {
    const value = result.value;
    const blocks = [...(value?.content ?? []), ...result.content];
    const block = blocks.find((block) => block.type === "image" && typeof block.data === "string");
    if (!block || !block.data || !/^[A-Za-z0-9+/]*={0,2}$/.test(block.data))
        throw new Error("工具没有返回可解码的规范图片");
    const bytes = Buffer.from(block.data, "base64");
    const png = bytes.length > 44 &&
        bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("ascii", 12, 16) === "IHDR" &&
        bytes.readUInt32BE(16) > 0 &&
        bytes.readUInt32BE(20) > 0 &&
        bytes.includes(Buffer.from("IEND"));
    const jpeg = bytes.length > 16 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes.at(-2) === 255 &&
        bytes.at(-1) === 217;
    const webp = bytes.length > 20 &&
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP" &&
        bytes.readUInt32LE(4) + 8 === bytes.length;
    const mime = png
        ? "image/png"
        : jpeg
            ? "image/jpeg"
            : webp
                ? "image/webp"
                : undefined;
    if (!mime || block.mimeType !== mime)
        throw new Error("图片内容、长度或 MIME 类型无效");
    if (png) {
        let offset = 8, ended = false;
        const chunks = [];
        while (offset + 12 <= bytes.length) {
            const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
            if (offset + 12 + length > bytes.length)
                throw new Error("PNG 图片被截断");
            if (type === "IDAT")
                chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
            offset += 12 + length;
            if (type === "IEND") {
                ended = offset === bytes.length;
                break;
            }
        }
        const depth = bytes[24], channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[bytes[25]];
        if (!ended || !chunks.length || !channels || bytes[28] !== 0)
            throw new Error("PNG 图片结构无效或当前解码器不支持此编码");
        const row = Math.ceil((bytes.readUInt32BE(16) * depth * channels) / 8) + 1;
        const raw = inflateSync(Buffer.concat(chunks), {
            maxOutputLength: 64 * 1024 * 1024,
        });
        if (raw.length !== row * bytes.readUInt32BE(20))
            throw new Error("PNG 像素数据不完整");
        for (let index = 0; index < raw.length; index += row)
            if (raw[index] > 4)
                throw new Error("PNG 像素过滤数据无效");
    }
    return { bytes, mime };
}
export class ToolPreview {
    host;
    context;
    recipe;
    identity;
    sourceIdentity;
    timer;
    generation = 0;
    count = 0;
    attempts = 0;
    started = 0;
    pending = false;
    stopped = false;
    reason = "等待测试打开实际页面";
    mode = "waiting";
    constructor(host) {
        this.host = host;
    }
    bind(context) {
        const catalog = this.host.catalog().snapshot();
        const source = (name) => toolSource(catalog.find((entry) => entry.name === name) ?? { name });
        const changed = !this.context ||
            context.caseId !== this.context.caseId ||
            source(context.tool) !== source(this.context.tool);
        let identityChanged = false;
        if (!changed && this.recipe) {
            try {
                identityChanged =
                    extractToolResult(context.result, this.recipe.context) !==
                        this.identity ||
                        (!!this.recipe.source_context &&
                            extractToolResult(context.result, this.recipe.source_context) !==
                                this.sourceIdentity);
            }
            catch {
                identityChanged = true;
            }
        }
        if (changed || identityChanged) {
            this.reset();
            this.host.clear();
        }
        this.context = context;
    }
    reset() {
        clearTimeout(this.timer);
        this.generation++;
        this.recipe = undefined;
        this.identity = undefined;
        this.sourceIdentity = undefined;
        this.attempts = 0;
        this.count = 0;
        this.started = 0;
        this.stopped = false;
        this.mode = "waiting";
        this.reason = "可让 Agent 尝试当前来源的画面能力";
    }
    state() {
        const catalog = this.host.catalog().snapshot();
        const selected = this.context &&
            catalog.find((entry) => entry.name === this.context.tool);
        const source = selected && toolSource(selected);
        return {
            mode: this.mode,
            reason: this.reason,
            source,
            context_call_id: this.context?.callId,
            tool: this.recipe?.tool_name,
            frames: this.count,
            attempts: this.attempts,
            generation: this.generation,
            candidates: source
                ? catalog
                    .filter((entry) => toolSource(entry) === source &&
                    /截图|画面|screenshot|snapshot|stream|preview|cdp/i.test(entry.name + " " + entry.description))
                    .map((entry) => entry.name)
                : [],
        };
    }
    unavailable(reason) {
        clearTimeout(this.timer);
        this.generation++;
        this.recipe = undefined;
        this.host.clear();
        this.mode = "unavailable";
        this.reason = reason;
        this.host.event("media_unavailable", { reason });
    }
    retry() {
        this.reset();
    }
    reserveAttempt() {
        if (!this.context)
            throw new Error("等待当前测试完成一次实际页面操作后再尝试接入");
        if (!this.started)
            this.started = Date.now();
        if (this.attempts >= 3 || Date.now() - this.started > 30000)
            throw new Error("本轮画面探索预算已用完，可手动重新尝试");
        this.attempts++;
    }
    nextCase() {
        this.stop();
        this.reason = "等待测试打开实际页面";
    }
    stop() {
        clearTimeout(this.timer);
        this.generation++;
        this.stopped = true;
        this.recipe = undefined;
        this.context = undefined;
        this.mode = "waiting";
        this.reason = "画面采集已停止";
        this.host.clear();
    }
    async connect(recipe, dispatch, reserved = false) {
        if (!this.context)
            throw new Error("等待当前测试完成一次实际页面操作后再尝试接入");
        if (this.pending)
            throw new Error("已有画面采集在途");
        if (!reserved)
            this.reserveAttempt();
        const catalog = this.host.catalog();
        catalog.assert(recipe.tool_name);
        const entries = catalog.snapshot();
        const candidate = entries.find((entry) => entry.name === recipe.tool_name);
        const active = entries.find((entry) => entry.name === this.context.tool);
        const crossSource = toolSource(candidate) !== toolSource(active);
        if (crossSource &&
            (!recipe.source_context ||
                !recipe.frame_source_context ||
                !recipe.frame_context))
            throw new Error("画面工具不属于当前实际使用的来源，不能连接另一浏览器");
        const identity = extractToolResult(this.context.result, recipe.context);
        if ((typeof identity !== "string" || !identity.trim()) &&
            typeof identity !== "number")
            throw new Error("没有从本轮实际调用取得明确页面或会话身份");
        if (typeof identity === "string" && /^https?:\/\//i.test(identity))
            throw new Error("URL 不能单独证明页面身份，请读取原页面或会话标识");
        const sourceIdentity = recipe.source_context
            ? extractToolResult(this.context.result, recipe.source_context)
            : undefined;
        if (crossSource &&
            (typeof sourceIdentity !== "string" || !sourceIdentity.trim()) &&
            typeof sourceIdentity !== "number")
            throw new Error("跨来源画面需要原浏览器身份和原页面身份的真实依据");
        if (crossSource &&
            (/^(?:https?|wss?|file):/i.test(String(sourceIdentity)) ||
                String(sourceIdentity) === String(identity)))
            throw new Error("跨来源需要独立的原浏览器身份，不能用 URL 或重复的页面身份代替");
        if (!recipe.frame_context && !recipe.identity_argument)
            throw new Error("需要核对图片返回身份或将原身份注入截图参数，不能仅凭 URL 认定归属");
        clearTimeout(this.timer);
        this.generation++;
        this.count = 0;
        this.recipe = structuredClone(recipe);
        this.identity = identity;
        this.sourceIdentity = sourceIdentity;
        this.stopped = false;
        this.mode = "trying";
        this.host.event("media_candidate", {
            recipe,
            context_call_id: this.context.callId,
        });
        await this.capture(dispatch);
        if (this.recipe?.mode === "poll")
            this.arm();
        return this.state();
    }
    arm() {
        clearTimeout(this.timer);
        this.timer = setTimeout(async () => {
            try {
                if (!this.stopped && this.host.viewing())
                    await this.host.poll();
            }
            finally {
                if (!this.stopped && this.recipe?.mode === "poll")
                    this.arm();
            }
        }, 2000);
        this.timer.unref();
    }
    async capture(dispatch) {
        if (this.pending || this.stopped || !this.recipe || !this.context)
            return;
        const generation = this.generation, recipe = this.recipe, context = this.context;
        this.pending = true;
        try {
            this.host.catalog().assert(recipe.tool_name);
            const args = {
                ...toolArguments(recipe.arguments === undefined && recipe.arguments_json === undefined
                    ? { arguments: {} }
                    : recipe),
            };
            if (recipe.identity_argument)
                args[recipe.identity_argument] = this.identity;
            const result = await dispatch(recipe.tool_name, args);
            if (generation !== this.generation)
                return;
            if (toolResultError(result))
                throw new Error("画面工具执行失败");
            if (recipe.frame_context &&
                extractToolResult(result, recipe.frame_context) !== this.identity) {
                this.mode = "unverified";
                throw new Error("图片返回的资源身份与当前测试页面不一致");
            }
            if (recipe.frame_source_context &&
                extractToolResult(result, recipe.frame_source_context) !==
                    this.sourceIdentity) {
                this.mode = "unverified";
                throw new Error("图片返回的浏览器身份与原测试连接不一致");
            }
            if (recipe.transport === "cdp") {
                if (!recipe.image)
                    throw new Error("CDP 接入需要真实返回中的端点元数据提取规则");
                const metadata = extractToolResult(result, recipe.image);
                if (!metadata ||
                    typeof metadata !== "object" ||
                    metadata.target_id !== this.identity)
                    throw new Error("调试通道不是原页面的目标身份");
                await this.host.cdp(context, metadata);
                this.reason = "调试通道已交付，等待有效首帧";
                return;
            }
            let image = result;
            if (recipe.image) {
                const payload = extractToolResult(result, recipe.image);
                if (payload &&
                    typeof payload === "object" &&
                    typeof payload.data === "string") {
                    image = {
                        isError: false,
                        content: [{ ...payload, type: "image" }],
                    };
                }
                else {
                    const url = new URL(String(payload));
                    if (!["http:", "https:"].includes(url.protocol))
                        throw new Error("当前采集器不支持该图片通道协议");
                    const response = await fetch(url, {
                        signal: AbortSignal.timeout(5000),
                        redirect: "error",
                        cache: "no-store",
                    });
                    if (!response.ok)
                        throw new Error("图片端点不可达");
                    image = {
                        isError: false,
                        content: [
                            {
                                type: "image",
                                mimeType: response.headers.get("content-type")?.split(";")[0] ?? "",
                                data: Buffer.from(await response.arrayBuffer()).toString("base64"),
                            },
                        ],
                    };
                }
            }
            const frame = imageFrame(image);
            if (generation !== this.generation)
                return;
            this.count++;
            this.mode = recipe.mode === "poll" && this.count > 1 ? "poll" : "once";
            this.reason =
                this.mode === "poll"
                    ? "定时截图已连接 · 每 2 秒刷新"
                    : "单次截图已验证";
            this.host.frame(context, {
                ...frame,
                id: String(this.count),
                capturedAt: new Date().toISOString(),
            }, this.mode);
            this.host.event("media_frame", {
                tool: recipe.tool_name,
                frame: this.count,
                mode: this.mode,
            });
        }
        catch (error) {
            this.host.clear();
            this.reason = error instanceof Error ? error.message : "画面接入失败";
            if (this.mode !== "unverified")
                this.mode = "unavailable";
            this.recipe = undefined;
            this.host.event("media_failed", { reason: this.reason });
        }
        finally {
            this.pending = false;
        }
    }
}
