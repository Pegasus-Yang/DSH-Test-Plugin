/** 自包含离线报告：总览、用例详情、断言和附件均来自已持久化事实。 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { statistics } from "./contracts.js";
import { atomicWrite, redact, safePath } from "./recorder.js";
import { reportStyle } from "./report-style.js";
import { reportInteractions } from "./report-client.js";
import { reportIcons } from "./report-icons.js";
import { recordingMedia } from "./report-media.js";
import { ReportData } from "./report-data.js";
import { projectActualCase, inputText, expectedText, operationLabels, } from "./actual-operations.js";
import { actualStepsDocument, manualCasesMarkdown } from "./manual-case.js";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const json = (value) => escape(JSON.stringify(redact(value), null, 2));
const labels = {
    PASS: "通过",
    SUCCEEDED: "完成",
    FAIL: "失败",
    ERROR: "执行异常",
    BLOCKED: "阻塞",
    SKIPPED: "跳过",
    CANCELLED: "已取消",
    INCONCLUSIVE: "结论不足",
    RUNNING: "运行中",
    PENDING: "待执行",
    WAITING_APPROVAL: "待审批",
};
const badge = (status) => `<span class="badge ${escape(status)}" title="${escape(status)}">${escape(labels[status] ?? status)}</span>`;
const icon = (name, className = "icon") => `<img class="${className}" src="${reportIcons[name]}" alt="" aria-hidden="true">`;
const duration = (ms) => !Number.isFinite(ms) || ms < 0
    ? "—"
    : ms >= 60000
        ? `${Math.floor(ms / 60000)}分${Math.round((ms % 60000) / 1000)}秒`
        : `${(ms / 1000).toFixed(1)}秒`;
const time = (value) => value
    ? new Date(value).toLocaleString("zh-CN", {
        hour12: false,
        timeZoneName: "short",
    })
    : "尚未结束";
export function writeReport(directory, run, filename = "report.html") {
    const stats = statistics(run);
    const data = new ReportData();
    const download = (name, bytes, mime, label) => `<a href="#" data-report-download="${data.download(bytes, mime)}" download="${escape(name)}">${escape(label)}</a>`;
    const callDetails = (id, value) => {
        data.call(id, value);
        return `<details class="inspect" data-report-call="${escape(id)}"><summary>查看原生调用依据（脱敏）</summary><pre></pre></details>`;
    };
    const totalMs = run.finished_at
        ? Date.parse(run.finished_at) - Date.parse(run.created_at)
        : NaN;
    const assertionCount = run.instances.reduce((n, i) => n + i.steps.filter((s) => s.assertion).length, 0);
    const passedAssertions = run.instances.reduce((n, i) => n + i.steps.filter((s) => s.assertion?.status === "PASS").length, 0);
    const evidence = new Map(run.evidence.map((e) => [e.evidence_id, e]));
    const attachment = (id, caseIndex) => {
        const e = evidence.get(id);
        if (!e)
            return `<p class="missing">缺少附件索引：${escape(id)}</p>`;
        let path;
        try {
            const candidate = safePath(directory, e.relative_path);
            if (existsSync(candidate))
                path = candidate;
        }
        catch { }
        if (!path)
            return `<p class="missing">附件缺失：${escape(e.relative_path)}</p>`;
        const bytes = readFileSync(path);
        const url = `data:${e.media_type};base64,${bytes.toString("base64")}`;
        const image = e.media_type.startsWith("image/");
        let content = "";
        if (image)
            content = `<button class="image-open" data-preview aria-label="放大页面截图"><img class="preview" data-report-asset="${escape(id)}" src="${escape(url)}" alt="本次测试实际采集的页面截图" loading="lazy"></button>`;
        else if (statSync(path).size <= 262144)
            content = `<details class="inspect" data-report-text="${data.download(bytes, e.media_type)}"><summary>查看原始响应</summary><pre></pre></details>`;
        const name = e.relative_path.split("/").at(-1);
        const link = image
            ? `<a href="#" data-report-image-download="${escape(id)}" download="${escape(name)}">下载附件 ${icon("external-link")}</a>`
            : download(name, bytes, e.media_type, "下载附件");
        return `<section class="attachment" id="evidence-${caseIndex}-${escape(id)}"><div class="attachment-header"><h3>${image ? "页面截图" : "工具响应"}</h3>${link}</div>${content}<div class="hash">${escape(e.relative_path)}<br>SHA256 ${escape(e.sha256)}</div></section>`;
    };
    const compare = (s, caseIndex) => {
        const a = s.assertion;
        return `<div class="comparison"><div><label>实际值 ACTUAL</label><pre>${json(a.actual)}</pre></div><div><label>预期值 EXPECTED · ${escape(a.operator)}</label><pre>${json(a.expected)}</pre></div><div class="comparison-footer"><span>${escape(a.reason)}</span>${a.evidence_refs[0] ? `<button class="evidence-button" data-evidence="evidence-${caseIndex}-${escape(a.evidence_refs[0])}">${icon("photo")} 查看证据</button>` : ""}</div></div><details class="inspect"><summary>断言来源与操作数 · 修订 ${a.plan_revision}</summary><pre>${json(a.operand_snapshot)}</pre></details>`;
    };
    const input = run.plan.planning?.input;
    const sourceOf = (caseId) => input?.instances.find((item) => item.id === caseId);
    const caseKey = (caseId) => sourceOf(caseId)?.template_id ?? caseId;
    const cases = run.instances
        .map((i, index) => {
        const actual = projectActualCase(run, i);
        const hasActual = actual.completeness !== "NOT_RECORDED" &&
            actual.steps.length +
                actual.preconditions.recorded.length +
                actual.cleanup.recorded.length +
                actual.not_dispatched.length >
                0;
        const actualRows = (rows) => `<div class="actual-list">${rows
            .map((row) => {
            const call = actual.call_records.find((c) => c.call_id === row.tool_call_id);
            return `<section class="actual-row" data-actual-id="${escape(row.id)}"><div class="actual-heading">${row.number ? `<span class="number">${row.number}</span>` : ""}<h3>${escape(row.description)}</h3><span class="badge ${escape(row.state)}">${escape(operationLabels[row.state] ?? row.state)}</span></div><div class="actual-source">来源：${escape(row.source_step_id)} · ${escape(row.source_description)}${row.operation?.granularity === "composite" ? " · 复合操作，内部动作需复核" : ""}</div><dl class="actual-values"><dt>实际输入</dt><dd>${escape(inputText(row))}</dd><dt>原有预期</dt><dd>${escape(expectedText(row))}</dd></dl>${row.operation?.reason ? `<p class="reason">${escape(row.operation.reason)}</p>` : ""}${row.assertion ? `<p>本次实际值：<code>${escape(JSON.stringify(row.assertion.actual))}</code></p>` : ""}${row.evidence_refs[0] ? `<button class="evidence-button" data-evidence="evidence-${index}-${escape(row.evidence_refs[0])}">查看本次采集证据</button>` : ""}${call ? callDetails(`${i.case_run_id}:${call.call_id}`, call) : ""}</section>`;
        })
            .join("")}</div>`;
        const actualPanel = hasActual
            ? `<div class="panel actual" id="panel-${index}-actual" role="tabpanel" aria-labelledby="tab-${index}-actual" data-panel="actual"><div class="actual-intro"><strong>实际步骤说明：${actual.completeness === "COMPLETE" ? "已完整记录" : "需复核"}</strong><p>操作结果来自原生工具，业务结果看检查。没有独立检查的中间预期保留为待补充。</p>${actual.completeness_reasons.map((r) => `<p class="reason">${escape(r)}</p>`).join("")}<div class="footer-links">${download(`actual-steps-${i.case_run_id}.json`, Buffer.from(JSON.stringify({ ...actualStepsDocument(run), cases: [actual] }, null, 2)), "application/json", "下载实际步骤 JSON")}${download(`manual-cases-${i.case_run_id}.md`, Buffer.from(manualCasesMarkdown(run, i.case_run_id)), "text/markdown", "下载手工用例 Markdown")}</div></div>${actual.preconditions.recorded.length ? `<details class="inspect"><summary>前置操作 · ${actual.preconditions.recorded.length} 条</summary>${actualRows(actual.preconditions.recorded)}</details>` : ""}${actualRows(actual.steps)}${actual.cleanup.recorded.length ? `<details class="inspect"><summary>业务收尾 · ${actual.cleanup.recorded.length} 条</summary>${actualRows(actual.cleanup.recorded)}</details>` : ""}${actual.not_dispatched.length ? `<details class="inspect"><summary>未执行的说明 · ${actual.not_dispatched.length} 条（不计序号）</summary>${actualRows(actual.not_dispatched)}</details>` : ""}</div>`
            : "";
        const media = recordingMedia(directory, run, i);
        const caseMs = i.steps.reduce((n, s) => n + s.duration_ms, 0);
        const ids = [
            ...new Set(i.steps.flatMap((s) => [
                ...s.observations.flatMap((o) => o.evidence_refs),
                ...(s.assertion?.evidence_refs ?? []),
            ])),
        ];
        const textSteps = run.plan.cases
            .find((c) => c.case_id === i.case_id)
            ?.steps.filter((s) => s.kind === "intent") ?? [];
        const textPlan = textSteps.length
            ? `<details class="inspect"><summary>原始文字步骤与检查点</summary><ol>${textSteps.map((s) => `<li>${escape(s.description)}${s.checks?.length ? `<p>检查：${s.checks.map(escape).join("；")}</p>` : ""}</li>`).join("")}</ol><p>具体工具、采集方式和比较器在执行当前步骤时确定，见下方执行记录。</p></details>`
            : "";
        const source = sourceOf(i.case_id);
        const sourceInfo = source
            ? `<details class="inspect"><summary>用例来源与参数 · 用例 ${source.case_number} · 数据行 ${source.data_row ?? "—"}</summary><p>用例文件：${escape(input?.case_file?.path ?? "对话模板")}；CSV：${escape(input?.csv_file?.path ?? "无")}</p><h3>原始用例</h3><pre>${escape(input.templates.find((t) => t.id === source.template_id).text)}</pre><h3>参数值</h3><pre>${json(source.parameters)}</pre><h3>展开后的任务</h3><pre>${escape(source.task)}</pre></details>`
            : "";
        const focus = i.steps.find((s) => ["FAIL", "ERROR", "INCONCLUSIVE"].includes(s.status)) ?? [...i.steps].reverse().find((s) => s.assertion);
        const steps = i.steps
            .map((s, n) => `<details class="step"${focus === s ? " open" : ""}><summary><span class="number">${n + 1}</span><span class="step-copy"><strong>${escape(s.description)}</strong><small>${{ setup: "准备", test: "业务", cleanup: "清理" }[s.phase]} · ${s.required ? "必需" : "可选"} · ${escape(s.step_id)}</small></span><span class="duration">${duration(s.duration_ms)}</span>${badge(s.status)}${icon("chevron-down", "chevron")}</summary><div class="step-content">${s.reason ? `<p class="reason">${escape(s.reason)}</p>` : ""}${s.assertion ? compare(s, index) : ""}${s.observations.map((o) => `<div class="observation-line">${escape(o.output_name)} = <code>${escape(JSON.stringify(o.value))}</code>${o.evidence_refs[0] ? ` <button class="evidence-button" data-evidence="evidence-${index}-${escape(o.evidence_refs[0])}">查看证据</button>` : ""}</div>`).join("")}${s.capture_attempts?.length ? `<details class="inspect"><summary>采集方式与调整记录 · ${s.capture_attempts.length} 次</summary><pre>${json(s.capture_attempts)}</pre></details>` : ""}${s.calls.length ? `<details class="inspect"><summary>${s.calls.length} 次工具调用 · 展开执行记录</summary>${s.calls.map((c) => `<div class="call"><strong>${escape(c.name)}</strong><small>${c.finished_at ? (c.isError ? "错误" : "已结算") : "未结算"}</small><pre>${json(c.args_redacted)}</pre>${callDetails(`${i.case_run_id}:${c.call_id}`, c)}</div>`).join("")}</details>` : ""}</div></details>`)
            .join("");
        const assertions = i.steps.filter((s) => s.assertion || i.effective_required_assertion_ids.includes(s.step_id));
        return `<article class="case" id="case-${index}" data-case="${escape(caseKey(i.case_id))}" data-data="${escape(i.data_id)}" data-status="${escape(i.status)}" data-search="${escape([i.name, i.case_id, i.data_id, i.status].join(" ").toLocaleLowerCase())}"${index ? " hidden" : ""}><header class="case-head"><div class="case-heading">${i.status === "PASS" ? icon("circle-check", "status-icon") : ""}<h2>${escape(i.name)}</h2>${badge(i.status)}</div><div class="case-meta"><span>用例标识<b>${escape(i.case_id)}</b></span><span>数据集<b>${escape(i.data_id)}</b></span><span>步骤耗时<b>${duration(caseMs)}</b></span></div></header>${i.issues.length ? `<aside class="issue">${i.issues.map(escape).join("<br>")}</aside>` : ""}${i.unsettled_call_ids.length ? `<aside class="issue danger">尚有 ${i.unsettled_call_ids.length} 次未结算调用；外部执行可能仍未停止。</aside>` : ""}${sourceInfo}${textPlan}${media.notice}<div class="tabs" role="tablist" aria-label="用例详情">${[
            ...(hasActual ? [["actual", "实际步骤"]] : []),
            ["steps", "步骤"],
            ["assertions", "断言"],
            ["attachments", "附件"],
            ...(media.videos ? [["recordings", "操作录像"]] : []),
        ]
            .map(([key, label]) => `<button role="tab" id="tab-${index}-${key}" aria-controls="panel-${index}-${key}" aria-selected="${key === (hasActual ? "actual" : "steps")}" data-tab="${key}">${label}${key === "assertions" ? ` (${assertions.length})` : key === "attachments" ? ` (${ids.length})` : ""}</button>`)
            .join("")}</div>${actualPanel}<div class="panel" id="panel-${index}-steps" role="tabpanel" aria-labelledby="tab-${index}-steps" data-panel="steps"${hasActual ? " hidden" : ""}>${steps || '<p class="empty">尚未执行任何步骤</p>'}</div><div class="panel" id="panel-${index}-assertions" role="tabpanel" aria-labelledby="tab-${index}-assertions" data-panel="assertions" hidden>${assertions.map((s) => `<section class="assertion-item"><h3>${escape(s.description)} ${badge(s.status)}</h3>${s.assertion ? compare(s, index) : `<p class="reason">${escape(s.reason ?? "此断言未执行，没有实际值与比较结果。")}</p>`}</section>`).join("") || '<p class="empty">尚无已执行的断言；不能据此判定通过。</p>'}<details class="inspect"><summary>输入数据与冻结预期</summary><pre>${json(i.data)}</pre></details>${i.revision_history?.length ? `<details class="inspect"><summary>动态检查来源与事后标记</summary><pre>${json(i.revision_history)}</pre></details>` : ""}</div><div class="panel attachments" id="panel-${index}-attachments" role="tabpanel" aria-labelledby="tab-${index}-attachments" data-panel="attachments" hidden>${ids.map((id) => attachment(id, index)).join("") || '<p class="empty">本用例没有采集附件</p>'}</div>${media.videos ? `<div class="panel recordings" id="panel-${index}-recordings" role="tabpanel" aria-labelledby="tab-${index}-recordings" data-panel="recordings" hidden>${media.videos}</div>` : ""}</article>`;
    })
        .join("");
    const options = (key) => [
        ...new Set(run.instances.map((i) => key === "case_id" ? caseKey(i.case_id) : i[key])),
    ]
        .map((v) => `<option value="${escape(v)}">${escape(key === "status" ? (labels[v] ?? v) : v)}</option>`)
        .join("");
    const list = run.instances
        .map((i, index) => `<button class="case-row" data-select-case="case-${index}" aria-current="${index === 0}">${i.status === "PASS" ? icon("circle-check", "status-icon") : ""}<span class="row-content"><strong>${escape(i.name)}</strong><small>${escape(i.data_id)} · ${escape(labels[i.status] ?? i.status)}</small></span><span class="row-time">${duration(i.steps.reduce((n, s) => n + s.duration_ms, 0))}</span></button>`)
        .join("");
    const eventPath = safePath(directory, "events.jsonl");
    const links = `<div class="footer-links">${download("actual-steps.json", Buffer.from(JSON.stringify(actualStepsDocument(run), null, 2)), "application/json", "下载完整批次实际步骤")}${download("manual-cases.md", Buffer.from(manualCasesMarkdown(run)), "text/markdown", "下载完整批次手工用例")}${download("results.json", Buffer.from(JSON.stringify(redact(run), null, 2)), "application/json", "下载运行数据")}${download("plan.json", Buffer.from(JSON.stringify(redact(run.plan), null, 2)), "application/json", "下载冻结计划")}${existsSync(eventPath) ? `<a href="events.jsonl?download=1" download="events.jsonl">下载事件账本</a>` : ""}</div>`;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(run.name)} · 测试报告</title><style>${reportStyle}</style></head><body><nav class="rail" aria-label="报告导航"><div class="brand">DSH / TEST REPORT</div>${[
        ["overview", "home", "概览"],
        ["cases", "list-details", "测试用例"],
        ["info", "info-circle", "运行信息"],
    ]
        .map(([key, img, label]) => `<button class="nav-button${key === "cases" ? " active" : ""}" data-nav="${key}" aria-current="${key === "cases" ? "page" : "false"}">${icon(img)}${label}</button>`)
        .join("")}<small>静态测试报告<br>可离线查看</small></nav><main class="app"><header class="run-header"><h1>${escape(run.name)}</h1><div class="run-meta"><span>${escape(time(run.created_at))}</span><span>${run.lifecycle === "FINISHED" ? "已结束" : "记录未结算"}</span><span>静态报告</span></div><div class="metrics"><div class="metric"><strong>${stats.total}</strong><span>用例总数</span></div><div class="metric"><strong class="positive">${stats.PASS ?? 0}</strong><span>通过</span></div><div class="metric"><strong class="${stats.total - (stats.PASS ?? 0) ? "negative" : ""}">${stats.total - (stats.PASS ?? 0)}</strong><span>未通过 / 未完成</span></div><div class="metric"><strong>${duration(totalMs)}</strong><span>运行总耗时（含规划）</span></div></div></header>${run.manifest.plan_approved === false ? '<aside class="issue">计划未获批准，未执行任何业务。</aside>' : ""}${run.incomplete || run.resource_quarantined ? `<aside class="issue danger">${run.incomplete ? "记录不完整。" : ""}${run.resource_quarantined ? "环境已隔离，外部执行可能仍未停止。" : ""}</aside>` : ""}${run.manifest.actual_steps_export_error ? `<aside class="issue">${escape(run.manifest.actual_steps_export_error)}</aside>` : ""}<section class="workspace" data-view="cases"><aside class="case-list"><div class="list-title"><h3>测试用例</h3><span>${stats.total} 个实例</span></div><label class="search">${icon("search")}<input id="search" type="search" placeholder="搜索用例名称或标识…" aria-label="搜索用例"></label><div class="filters"><label>用例<select id="case"><option value="">全部</option>${options("case_id")}</select></label><label>数据<select id="data"><option value="">全部</option>${options("data_id")}</select></label><label>状态<select id="status"><option value="">全部</option>${options("status")}</select></label></div><div class="list-subtitle"><span id="count" aria-live="polite"></span><button id="clear" class="text-button">清除筛选</button></div><div class="case-rows">${list}</div><p class="empty" id="empty" hidden>没有符合筛选条件的实例</p></aside><div class="detail">${cases}<div id="no-detail" class="empty" hidden>没有可展示的用例，请调整筛选条件。</div></div></section><section class="overview" data-view="overview" hidden><h2>运行总览</h2>${input ? `<p>原始用例 ${input.templates.length} 条 · CSV 数据 ${input.rows.length} 行 · 执行实例 ${input.instances.length} 个</p>` : ""}<p>${stats.total ? (((stats.PASS ?? 0) / stats.total) * 100).toFixed(1) + "%" : "—"} 用例通过率 · ${passedAssertions} / ${assertionCount} 条已执行断言通过</p><div class="distribution">${Object.entries(stats)
        .filter(([k, v]) => k !== "total" && v > 0)
        .map(([k, v]) => `<button data-filter-status="${escape(k)}">${badge(k)}<strong>${v}</strong></button>`)
        .join("")}</div><h2>测试套件与用例</h2><div class="table-wrap"><table><thead><tr><th>用例名称</th><th>数据集</th><th>状态</th><th>断言通过 / 已执行</th><th>步骤耗时</th></tr></thead><tbody>${run.instances.map((i, index) => `<tr><td><button class="case-link" data-open-case="case-${index}">${escape(i.name)}</button></td><td>${escape(i.data_id)}</td><td>${badge(i.status)}</td><td>${i.steps.filter((s) => s.assertion?.status === "PASS").length} / ${i.steps.filter((s) => s.assertion).length}</td><td>${duration(i.steps.reduce((n, s) => n + s.duration_ms, 0))}</td></tr>`).join("")}</tbody></table></div><p class="note">通过率以全部用例实例为分母。取消、阻塞和未确定不会计为通过。断言统计仅计入真实比较记录；未执行的断言可在用例详情中查看。</p>${links}</section><section class="run-info" data-view="info" hidden><h2>运行信息</h2><dl><dt>运行 ID</dt><dd>${escape(run.suite_run_id)}</dd><dt>开始时间</dt><dd>${escape(time(run.created_at))}</dd><dt>结束时间</dt><dd>${escape(time(run.finished_at))}</dd><dt>执行模式</dt><dd>${escape(run.manifest.execution ?? run.manifest.tools_mode ?? "未记录")}</dd><dt>发起会话</dt><dd>${escape(run.manifest.origin_session_id ?? "未记录")}</dd><dt>插件版本</dt><dd>${escape(run.manifest.plugin_version ?? "未记录")}</dd></dl><details class="inspect"><summary>完整运行配置与预算</summary><pre>${json(run.manifest)}</pre></details><p>本报告依据冻结计划、绑定的实际观察和确定性比较结果生成。采集定位的运行时调整保存在对应步骤中，原始预期保持不变。</p>${links}</section></main>${run.evidence.some((e) => e.media_type.startsWith("image/")) ? '<dialog id="image-dialog" aria-label="页面截图预览"><button id="close-image" class="text-button">关闭预览</button><img id="full-image" alt="实际页面截图完整预览"></dialog>' : ""}<script type="application/json" id="report-data">${data.script()}</script><script>(${reportInteractions.toString()})();</script></body></html>`;
    atomicWrite(safePath(directory, filename), html);
}
