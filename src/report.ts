/** 自包含离线HTML，只展示已持久化事实，不调用模型或工具。 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { statistics, type SuiteRun } from "./contracts.js";
import { atomicWrite, redact, safePath } from "./recorder.js";
const escape = (v: unknown): string =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const json = (v: unknown) => escape(JSON.stringify(redact(v), null, 2));
const badge = (status: string) =>
  `<span class="badge ${escape(status)}">${escape(status)}</span>`;
export function writeReport(
  directory: string,
  run: SuiteRun,
  filename = "report.html",
): void {
  const stats = statistics(run),
    finished = run.instances.filter(
      (i) => i.lifecycle === "FINISHED" || i.lifecycle === "INTERRUPTED",
    ).length;
  const evidence = new Map(run.evidence.map((e) => [e.evidence_id, e]));
  const link = (id: string) => {
    const e = evidence.get(id);
    if (!e) return `<span class="missing">缺少附件索引 ${escape(id)}</span>`;
    let available = false;
    try {
      available = existsSync(safePath(directory, e.relative_path));
    } catch {}
    return available
      ? `<a class="evidence" href="${escape(e.relative_path)}" target="_blank" rel="noopener">${e.media_type === "image/png" ? "查看截图" : "查看原始响应"} ↗</a><small class="hash">SHA256 ${escape(e.sha256)}</small>`
      : `<span class="missing">附件缺失：${escape(e.relative_path)}</span>`;
  };
  const body = run.instances
    .map(
      (
        i,
      ) => `<article class="case" data-case="${escape(i.case_id)}" data-data="${escape(i.data_id)}" data-status="${escape(i.status)}">
    <header><div><span class="eyebrow">${escape(i.case_id)} / ${escape(i.data_id)}</span><h2>${escape(i.name)}</h2></div>${badge(i.status)}</header>
    <p class="muted">会话 ${escape(i.session_id ?? "未启动")} · 有效修订 ${i.applied_revisions.join(" → ")} · 必需断言 ${escape(i.effective_required_assertion_ids.join(", "))}</p>
    ${i.revision_history?.length ? `<details><summary>动态检查来源与事后标记</summary><pre>${json(i.revision_history)}</pre></details>` : ""}
    ${i.issues.length ? `<aside>${i.issues.map(escape).join("<br>")}</aside>` : ""}
    ${i.unsettled_call_ids.length ? `<aside class="danger">未结算调用：${i.unsettled_call_ids.map(escape).join(", ")}。结果已封存不代表外部执行已停止。</aside>` : ""}
    <details class="data"><summary>输入数据与冻结预期</summary><pre>${json(i.data)}</pre></details>
    ${i.steps
      .map(
        (
          s,
          n,
        ) => `<section class="step"><div class="step-title"><span class="number">${n + 1}</span><div><span class="eyebrow">${{ setup: "准备", test: "业务", cleanup: "清理" }[s.phase]} · ${s.required ? "必需" : "可选"} · ${escape(s.step_id)}</span><h3>${escape(s.description)}</h3></div><span class="duration">${(s.duration_ms / 1000).toFixed(1)}秒</span>${badge(s.status)}</div>
    ${s.reason ? `<p class="reason">${escape(s.reason)}</p>` : ""}
    ${s.assertion ? `<div class="comparison"><div><label>实际值 ACTUAL</label><pre>${json(s.assertion.actual)}</pre></div><div><label>预期值 EXPECTED · ${escape(s.assertion.operator)}</label><pre>${json(s.assertion.expected)}</pre></div></div><p>${escape(s.assertion.reason)} · 修订 ${s.assertion.plan_revision}</p><details><summary>断言操作数与证据</summary><pre>${json(s.assertion.operand_snapshot)}</pre>${s.assertion.evidence_refs.map(link).join("")}</details>` : ""}
    ${s.observations.map((o) => `<details class="observation"><summary>观察 ${escape(o.output_name)} = ${escape(JSON.stringify(o.value))}</summary><pre>${json({ observation_id: o.observation_id, producer: o.producer, context_id: o.context_id, binding: o.binding, observed_at: o.observed_at })}</pre>${o.evidence_refs.map(link).join("")}</details>`).join("")}
    ${s.calls.length ? `<details><summary>${s.calls.length} 次工具调用 · 展开执行记录</summary>${s.calls.map((c) => `<div class="call"><strong>${escape(c.name)}</strong> · ${c.finished_at ? (c.isError ? "错误" : "已结算") : "未结算"}<small>${escape(c.call_id)}</small><pre>${json(c.args_redacted)}</pre><details><summary>原始结果（脱敏）</summary><pre>${json(c.result)}</pre></details></div>`).join("")}</details>` : ""}
    </section>`,
      )
      .join("")}</article>`,
    )
    .join("");
  const options = (key: "case_id" | "data_id" | "status") =>
    [...new Set(run.instances.map((i) => i[key]))]
      .map((v) => `<option>${escape(v)}</option>`)
      .join("");
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(run.name)} · 测试报告</title><style>
  :root{color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1c2b3a;background:#f4f7fa}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:48px 28px}.hero{border-top:5px solid #0c8278;padding:28px 0 24px}.eyebrow{font-size:12px;font-weight:650;letter-spacing:.08em;color:#607589}h1{font-size:32px;margin:12px 0}h2{font-size:22px;margin:8px 0}h3{font-size:16px;margin:5px 0}p{line-height:1.7}.muted{color:#647789;font-size:13px;overflow-wrap:anywhere}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:22px 0}.metric{background:white;padding:20px;border:1px solid #dce5eb;border-radius:10px}.metric strong{display:block;font-size:30px;margin-bottom:7px}.metric span{color:#607589;font-size:13px}.filters{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:18px 0}select,button{font:inherit;background:white;border:1px solid #c5d3de;padding:9px 14px;border-radius:6px}label{font-size:12px;color:#607589}article.case{margin:20px 0 32px;background:white;border:1px solid #dce5eb;border-radius:12px;padding:26px;box-shadow:0 4px 14px #22334405}header{display:flex;justify-content:space-between;align-items:center;gap:18px}.badge{display:inline-block;font-size:12px;font-weight:750;background:#e9eef3;color:#4b6074;padding:6px 10px;border-radius:5px;white-space:nowrap}.PASS,.SUCCEEDED{background:#e0f4ed;color:#146c4f}.FAIL,.ERROR{background:#fde8e7;color:#b02f2e}.BLOCKED,.INCONCLUSIVE,.CANCELLED{background:#fff0d8;color:#885611}.step{border-top:1px solid #e5ebf0;padding:23px 0 5px;margin-top:22px}.step-title{display:flex;gap:14px;align-items:center}.number{background:#edf3f6;border-radius:50%;width:30px;height:30px;display:grid;place-items:center;flex-shrink:0;font-size:13px;font-weight:650}.duration{margin-left:auto;white-space:nowrap;font-size:12px;color:#6e8293}.comparison{display:grid;grid-template-columns:1fr 1fr;border:1px solid #dce5eb;border-radius:8px;margin-top:18px;overflow:hidden}.comparison>div{padding:16px 20px;background:#f9fbfc}.comparison>div+div{border-left:1px solid #dce5eb}.comparison pre{font-size:20px;padding:7px 0;margin:0;background:none}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.65 ui-monospace,Menlo,monospace;background:#f3f6f8;border-radius:5px;padding:12px;max-height:500px;overflow:auto}details{margin:12px 0;font-size:13px}summary{cursor:pointer;color:#355d7b;overflow-wrap:anywhere;line-height:1.6}.call{border-left:2px solid #d8e3eb;padding:10px 16px;margin:14px 0}.call small,.hash{display:block;color:#788a99;overflow-wrap:anywhere;font-size:10px;margin:6px 0}.evidence{display:inline-block;margin:10px 12px 0 0;color:#087b73}aside{padding:16px;background:#fff7e9;border-left:3px solid #d3a039;font-size:13px;line-height:1.8;overflow-wrap:anywhere}.danger{background:#fff0ee;border-color:#c44843}.missing{color:#b02f2e}.reason{font-size:13px;color:#926538}#empty{display:none;text-align:center;padding:50px;color:#647789}footer{font-size:12px;color:#718395;line-height:1.8}@media(max-width:700px){main{padding:20px 12px}h1{font-size:24px}.cards{grid-template-columns:repeat(2,1fr)}article.case{padding:16px}.step-title{flex-wrap:wrap}.comparison{grid-template-columns:1fr}.comparison>div+div{border-left:0;border-top:1px solid #dce5eb}.duration{margin-left:0}.badge{font-size:11px}}
  </style><main><div class="hero"><span class="eyebrow">DEEPSEEK HARNESS / TEST RUN</span><h1>${escape(run.name)}</h1><p class="muted">${escape(run.created_at)} → ${escape(run.finished_at ?? "运行中")}<br>运行 ${escape(run.suite_run_id)}</p></div>
  ${run.incomplete || run.resource_quarantined ? `<aside class="danger">${run.incomplete ? "记录不完整。" : ""}${run.resource_quarantined ? "环境已隔离，外部执行可能仍未停止。" : ""}</aside>` : ""}
  <div class="cards"><div class="metric"><strong>${stats.total}</strong><span>测试实例</span></div><div class="metric"><strong>${stats.PASS ?? 0}</strong><span>通过</span></div><div class="metric"><strong>${(stats.FAIL ?? 0) + (stats.ERROR ?? 0)}</strong><span>失败 / 错误</span></div><div class="metric"><strong>${stats.total ? Math.round((finished / stats.total) * 100) : 0}%</strong><span>结果结算率 · 不代表外部执行完成</span></div></div>
  <div class="filters"><label>用例 <select id="case"><option value="">全部</option>${options("case_id")}</select></label><label>数据 <select id="data"><option value="">全部</option>${options("data_id")}</select></label><label>状态 <select id="status"><option value="">全部</option>${options("status")}</select></label><button id="clear">清除筛选</button><span id="count" class="muted"></span></div>${body}<p id="empty">没有符合筛选条件的实例</p>
  <details><summary>运行配置与预算</summary><pre>${json(run.manifest)}</pre></details><footer>本报告依据冻结计划、绑定的实际观察和确定性比较结果生成。<br>原始数据：<a href="results.json">results.json</a> · <a href="events.jsonl">事件账本</a> · <a href="plan.json">冻结计划</a></footer></main>
  <script>const filters=['case','data','status'].map(id=>document.getElementById(id));function update(){let n=0;for(const el of document.querySelectorAll('article.case')){const show=filters.every(f=>!f.value||el.dataset[f.id]===f.value);el.hidden=!show;if(show)n++;}document.getElementById('count').textContent='显示 '+n+' 个实例';document.getElementById('empty').style.display=n?'none':'block';}filters.forEach(f=>f.addEventListener('change',update));document.getElementById('clear').onclick=()=>{filters.forEach(f=>f.value='');update();};update();</script></html>`;
  atomicWrite(safePath(directory, filename), html);
}
