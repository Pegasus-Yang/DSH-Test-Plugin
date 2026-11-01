/** 从受信工具响应生成唯一绑定观察；模型不能提交实际值。 */
import { createHash, randomUUID } from "node:crypto";
import { ajv, field, } from "./contracts.js";
import { redact } from "./recorder.js";
import { extractToolResult } from "./tool-results.js";
import { toolArguments } from "./tool-runtime.js";
import { runbridgeResult, remoteReleaseConfirmed, } from "./runbridge.js";
/** 图片取自实际返回，按内容去重；没有媒体能力时不另行调用默认截图工具。 */
export function archiveToolImages(recorder, suite, result) {
    const raw = field(result.value, "content");
    const blocks = [...(Array.isArray(raw) ? raw : []), ...result.content];
    const refs = new Set();
    for (const block of blocks) {
        const data = field(block, "data"), mime = field(block, "mimeType");
        if (field(block, "type") !== "image" ||
            typeof data !== "string" ||
            !["image/png", "image/jpeg", "image/webp"].includes(String(mime)))
            continue;
        const bytes = Buffer.from(data, "base64");
        const sha = createHash("sha256").update(bytes).digest("hex");
        const previous = suite.evidence.find((e) => e.sha256 === sha && e.media_type === mime);
        if (previous) {
            refs.add(previous.evidence_id);
            continue;
        }
        const evidence = recorder.evidence(randomUUID() +
            (mime === "image/jpeg"
                ? ".jpg"
                : mime === "image/webp"
                    ? ".webp"
                    : ".png"), bytes, String(mime), false);
        suite.evidence.push(evidence);
        refs.add(evidence.evidence_id);
    }
    return [...refs];
}
export function mcpResult(value) {
    const blocks = field(value, "content");
    if (!Array.isArray(blocks))
        throw new Error("MCP缺少规范content");
    const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    const match = text.match(/### Result\s*\n([\s\S]*?)(?=\n### |$)/);
    if (!match)
        throw new Error("MCP缺少结构化Result");
    return JSON.parse(match[1].replace(/^```(?:json)?\s*\n?|\n?```$/g, ""));
}
/** 固定的只读DOM采集函数；选择器来自通过Schema校验的计划或本次运行绑定。 */
export function domFunction(captures, origins) {
    return `() => {
    const captures=${JSON.stringify(captures)}, origins=${JSON.stringify(origins)};
    if(!origins.includes(location.origin)) throw new Error('页面已离开允许目标');
    const values={};
    for(const [name,c] of Object.entries(captures)) {
      if(c.mode==='url'){values[name]=c.field==='pathname'?location.pathname:location.href;continue;}
      const nodes=document.querySelectorAll(c.selector), el=nodes[c.index??0];
      if(c.mode==='count'){values[name]=nodes.length;continue;}
      if(c.mode==='visible'){values[name]=!!el&&!!(el.getClientRects().length);continue;}
      if(!el)continue;
      if(c.index===undefined&&nodes.length!==1)throw new Error('采集必须唯一匹配: '+name+' 实际 '+nodes.length);
      if(c.mode==='value'){values[name]=el.value;continue;}
      let text=(c.attribute?el.getAttribute(c.attribute):el.textContent)?.trim();
      if(c.field==='pathname'&&c.attribute==='href'&&text)text=new URL(text,location.href).pathname;
      if(c.mode==='number'){
        if(text===undefined||text===null||!/^\\d+(?:\\.\\d+)?$/.test(text.replaceAll(',','')))throw new Error('不是明确数值: '+name+'='+text);
        values[name]=Number(text.replaceAll(',',''));
      }else if(c.mode==='attribute'){if(text!==null&&text!==undefined)values[name]=text;}
      else values[name]=text;
    }
    return {values,url:location.href,title:document.title};
  }`;
}
export async function captureStep(host, recorder, suite, step, result, binding, exec) {
    const captures = Object.fromEntries(Object.entries(step.action.capture ?? {}).filter(([name]) => !result.observations.some((o) => o.output_name === name)));
    const previousObservations = result.observations.length;
    const dom = Object.fromEntries(Object.entries(captures).filter(([name, c]) => c.kind === "dom" && !host.domBindings?.[name]));
    const origins = Object.values(captures).some((capture) => capture.kind === "dom")
        ? step.action.allowed_targets.map((t) => new URL(t).origin)
        : [];
    const save = (name, value, callId, adapter, evidenceId, path) => {
        if (value === undefined)
            return;
        if (result.observations.some((o) => o.output_name === name))
            throw new Error("观察输出槽重复: " + name);
        const validate = ajv.compile(step.action.outputs[name]);
        if (!validate(value))
            throw new Error("实际输出类型不符合合同: " +
                name +
                " " +
                ajv.errorsText(validate.errors));
        const observation = {
            observation_id: randomUUID(),
            binding: { ...binding },
            producer: { call_id: callId, adapter, field: path },
            context_id: host.id,
            output_name: name,
            value: redact(value),
            evidence_refs: [evidenceId],
            observed_at: new Date().toISOString(),
        };
        recorder.event("observation_bound", observation, binding);
        result.observations.push(observation);
    };
    for (const [name, cap] of Object.entries(captures).filter(([, c]) => c.kind === "tool")) {
        host.assertTool?.(cap.tool_name);
        const response = await host.call(cap.tool_name, toolArguments(cap), exec);
        const evidence = recorder.evidence(randomUUID() + ".json", JSON.stringify(redact(response.result), null, 2), "application/json");
        suite.evidence.push(evidence);
        const imageRefs = archiveToolImages(recorder, suite, response.result);
        save(name, extractToolResult(response.result, cap.extract), response.callId, "tool-result-v1", evidence.evidence_id, JSON.stringify(cap.extract));
        result.observations.at(-1).evidence_refs.push(...imageRefs);
    }
    for (const [name, cap] of Object.entries(captures).filter(([name, c]) => c.kind === "dom" && host.domBindings?.[name])) {
        const binding = host.domBindings[name];
        host.assertTool?.(binding.tool_name);
        const args = {
            ...toolArguments(binding.arguments === undefined && binding.arguments_json === undefined
                ? { arguments: {} }
                : binding),
        };
        if (cap.kind === "dom" && cap.selector)
            args[binding.selector_argument] = cap.selector;
        if (cap.kind === "dom" && cap.attribute)
            args[binding.attribute_argument] = cap.attribute;
        if (cap.kind === "dom" && cap.index !== undefined)
            args[binding.index_argument] = cap.index;
        const response = await host.call(binding.tool_name, args, exec);
        if (response.result.isError)
            throw new Error("原来源的 DOM 工具读取失败");
        const url = String(extractToolResult(response.result, binding.url));
        if (!origins.includes(new URL(url).origin))
            throw new Error("DOM 工具已离开当前冻结目标范围");
        let value = extractToolResult(response.result, binding.extract);
        if (cap.kind === "dom" &&
            cap.field === "pathname" &&
            (cap.mode === "url" ||
                (cap.mode === "attribute" && cap.attribute === "href")))
            value = new URL(String(value), url).pathname;
        const evidence = recorder.evidence(randomUUID() + ".json", JSON.stringify(redact(response.result), null, 2), "application/json");
        suite.evidence.push(evidence);
        save(name, value, response.callId, "tool-dom-v1", evidence.evidence_id, JSON.stringify(binding.extract));
    }
    if (Object.keys(dom).length) {
        const evaluate = host.browser
            ? host.browser.prefix + "browser_capture"
            : host.legacyTools?.evaluate;
        if (!evaluate)
            throw new Error("当前来源没有已绑定的 DOM 读取工具，请使用该来源的通用结果采集；不能回退到另一浏览器");
        const response = await host.call(evaluate, host.browser
            ? { captures: dom, allowed_origins: origins }
            : { function: domFunction(dom, origins) }, exec);
        if (response.result.isError)
            throw new Error("DOM采集工具失败: " + JSON.stringify(response.result.content));
        const evidence = recorder.evidence(randomUUID() + ".json", JSON.stringify(redact(response.result), null, 2), "application/json");
        suite.evidence.push(evidence);
        const data = host.browser
            ? runbridgeResult(response.result.value)
            : mcpResult(response.result.value);
        if (host.browser &&
            (field(data, "truncated") !== false ||
                !origins.includes(new URL(String(field(data, "url"))).origin)))
            throw new Error("远程采集截断或离开本步允许来源");
        for (const name of Object.keys(dom))
            save(name, field(data, "values." + name), response.callId, host.browser ? "runbridge-dom-v1" : "playwright-dom-v1", evidence.evidence_id, "values." + name);
    }
    for (const [name, cap] of Object.entries(captures).filter(([, c]) => c.kind === "http")) {
        const reason = result.capture_attempts?.at(-1)?.reason;
        const response = await host.call("test_api_get", { url: cap.url }, exec, {
            description: `${reason ?? step.description}；发送 GET 请求并采集 ${name}`,
            description_source: reason ? "capture_reason" : "template",
        });
        if (response.result.isError)
            throw new Error("API采集工具失败");
        const evidence = recorder.evidence(randomUUID() + ".json", JSON.stringify(redact(response.result), null, 2), "application/json");
        suite.evidence.push(evidence);
        save(name, field(response.result.value, cap.field ?? ""), response.callId, "http-json-v1", evidence.evidence_id, cap.field ?? "");
    }
    for (const [name, cap] of Object.entries(captures).filter(([, c]) => c.kind === "browser_open")) {
        if (!host.browser)
            throw new Error("远程浏览器启动采集需要 RunBridge 后端");
        const response = await host.call(host.browser.prefix + "browser_start", {}, exec);
        if (response.result.isError)
            throw new Error("远程浏览器启动失败，需核对资源状态");
        const data = runbridgeResult(response.result.value);
        if (data.session?.state !== "ACTIVE" ||
            host.browser.resource?.remote?.session_id !== data.session.session_id)
            throw new Error("没有取得本次活动浏览器的证据");
        const evidence = recorder.evidence(randomUUID() + ".json", JSON.stringify(redact(response.result), null, 2), "application/json");
        suite.evidence.push(evidence);
        save(name, true, response.callId, "runbridge-open-v1", evidence.evidence_id, "session.state=ACTIVE");
    }
    for (const [name, cap] of Object.entries(captures).filter(([, c]) => c.kind === "browser_close")) {
        const close = host.browser
            ? host.browser.prefix + "browser_stop"
            : host.legacyTools?.close;
        if (!close)
            throw new Error("没有原来源的关闭工具，不能默认关闭另一浏览器");
        const response = await host.call(close, {}, exec);
        if (response.result.isError)
            throw new Error("浏览器释放失败");
        if (host.browser) {
            const data = runbridgeResult(response.result.value);
            if (!remoteReleaseConfirmed(data, host.browser.resource))
                throw new Error("远程浏览器清理尚未确认，隔离仍保留");
        }
        const evidence = recorder.evidence(randomUUID() + ".json", JSON.stringify(redact(response.result), null, 2), "application/json");
        suite.evidence.push(evidence);
        save(name, true, response.callId, host.browser ? "runbridge-close-v1" : "playwright-close-v1", evidence.evidence_id, host.browser
            ? host.browser.resource?.remote?.session_id
                ? "session.state=terminal,cleanup=COMPLETE"
                : "request.state=FAILED,session_id=null,execution_outcome=NOT_STARTED"
            : "isError=false");
    }
    if (step.action.capability === "browser" &&
        Object.keys(dom).length &&
        (host.browser || host.legacyTools?.screenshot)) {
        const shot = await host.call(host.browser
            ? host.browser.prefix + "browser_screenshot"
            : host.legacyTools.screenshot, host.browser ? { full_page: true } : { type: "png", fullPage: true }, exec);
        if (!shot.result.isError) {
            const refs = archiveToolImages(recorder, suite, shot.result);
            for (const observation of result.observations.slice(previousObservations))
                observation.evidence_refs = [
                    ...new Set([...observation.evidence_refs, ...refs]),
                ];
        }
    }
    return { outputs: result.observations.map((o) => o.output_name) };
}
