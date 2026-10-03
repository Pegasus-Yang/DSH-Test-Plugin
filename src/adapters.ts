/** 从受信工具响应生成唯一绑定观察；模型不能提交实际值。 */
import { randomUUID } from "node:crypto";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import {
  ajv,
  field,
  type Binding,
  type Json,
  type Step,
  type StepResult,
  type SuiteRun,
} from "./contracts.js";
import { Recorder, redact } from "./recorder.js";
import type { HarnessSession } from "./host.js";

export function mcpResult(value: unknown): unknown {
  const blocks = field(value, "content");
  if (!Array.isArray(blocks)) throw new Error("MCP缺少规范content");
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const match = text.match(/### Result\s*\n([\s\S]*?)(?=\n### |$)/);
  if (!match) throw new Error("MCP缺少结构化Result");
  return JSON.parse(match[1]!.replace(/^```(?:json)?\s*\n?|\n?```$/g, ""));
}

/** 固定的只读DOM采集函数；选择器来自通过Schema校验的冻结计划。 */
export function domFunction(
  captures: Record<string, unknown>,
  origins: string[],
): string {
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
      const text=(c.attribute?el.getAttribute(c.attribute):el.textContent)?.trim();
      if(c.mode==='number'){
        if(text===undefined||text===null||!/^\\d+(?:\\.\\d+)?$/.test(text.replaceAll(',','')))throw new Error('不是明确数值: '+name+'='+text);
        values[name]=Number(text.replaceAll(',',''));
      }else if(c.mode==='attribute'){if(text!==null&&text!==undefined)values[name]=text;}
      else values[name]=text;
    }
    return {values,url:location.href,title:document.title};
  }`;
}

export async function captureStep(
  host: HarnessSession,
  recorder: Recorder,
  suite: SuiteRun,
  step: Step,
  result: StepResult,
  binding: Binding,
  exec: ToolRunContext,
): Promise<Json> {
  const captures = step.action!.capture ?? {};
  const dom = Object.fromEntries(
    Object.entries(captures).filter(([, c]) => c.kind === "dom"),
  );
  const origins = step.action!.allowed_targets.map((t) => new URL(t).origin);
  const save = (
    name: string,
    value: unknown,
    callId: string,
    adapter: string,
    evidenceId: string,
    path: string,
  ) => {
    if (value === undefined) return;
    if (result.observations.some((o) => o.output_name === name))
      throw new Error("观察输出槽重复: " + name);
    const validate = ajv.compile(step.action!.outputs[name]!);
    if (!validate(value))
      throw new Error(
        "实际输出类型不符合合同: " +
          name +
          " " +
          ajv.errorsText(validate.errors),
      );
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
  if (Object.keys(dom).length) {
    const response = await host.call(
      "mcp__playwright__browser_evaluate",
      { function: domFunction(dom, origins) },
      exec,
    );
    if (response.result.isError)
      throw new Error(
        "DOM采集工具失败: " + JSON.stringify(response.result.content),
      );
    const evidence = recorder.evidence(
      randomUUID() + ".json",
      JSON.stringify(redact(response.result), null, 2),
      "application/json",
    );
    suite.evidence.push(evidence);
    const data = mcpResult(response.result.value);
    for (const name of Object.keys(dom))
      save(
        name,
        field(data, "values." + name),
        response.callId,
        "playwright-dom-v1",
        evidence.evidence_id,
        "values." + name,
      );
  }
  for (const [name, cap] of Object.entries(captures).filter(
    ([, c]) => c.kind === "http",
  )) {
    const response = await host.call("test_api_get", { url: cap.url }, exec);
    if (response.result.isError) throw new Error("API采集工具失败");
    const evidence = recorder.evidence(
      randomUUID() + ".json",
      JSON.stringify(redact(response.result), null, 2),
      "application/json",
    );
    suite.evidence.push(evidence);
    save(
      name,
      field(response.result.value, cap.field ?? ""),
      response.callId,
      "http-json-v1",
      evidence.evidence_id,
      cap.field ?? "",
    );
  }
  for (const [name, cap] of Object.entries(captures).filter(
    ([, c]) => c.kind === "browser_close",
  )) {
    const response = await host.call(
      "mcp__playwright__browser_close",
      {},
      exec,
    );
    if (response.result.isError) throw new Error("浏览器释放失败");
    const evidence = recorder.evidence(
      randomUUID() + ".json",
      JSON.stringify(redact(response.result), null, 2),
      "application/json",
    );
    suite.evidence.push(evidence);
    save(
      name,
      true,
      response.callId,
      "playwright-close-v1",
      evidence.evidence_id,
      "isError=false",
    );
  }
  if (step.action!.capability === "browser" && Object.keys(dom).length) {
    const shot = await host.call(
      "mcp__playwright__browser_take_screenshot",
      { type: "png", fullPage: false },
      exec,
    );
    if (!shot.result.isError) {
      const blocks = [
        ...shot.result.content,
        ...(Array.isArray(field(shot.result.value, "content"))
          ? (field(shot.result.value, "content") as unknown[])
          : []),
      ];
      const img = blocks.find((b) => field(b, "type") === "image");
      if (img && typeof field(img, "data") === "string") {
        const evidence = recorder.evidence(
          randomUUID() + ".png",
          Buffer.from(field(img, "data") as string, "base64"),
          "image/png",
          false,
        );
        suite.evidence.push(evidence);
        for (const observation of result.observations)
          observation.evidence_refs.push(evidence.evidence_id);
      }
    }
  }
  return { outputs: result.observations.map((o) => o.output_name) };
}
