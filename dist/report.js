/** 自包含离线报告：总览、用例详情、断言和附件均来自已持久化事实。 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { statistics } from "./contracts.js";
import { atomicWrite, redact, safePath } from "./recorder.js";
import { reportStyle } from "./report-style.js";
import { reportInteractions } from "./report-client.js";
import { recordingMedia } from "./report-media.js";
import { ReportData } from "./report-data.js";
import { projectActualCase } from "./actual-operations.js";
import { expectationText } from "./expectation-text.js";
import { executionProcess } from "./report-process.js";
import { escape, json, labels, badge, icon, duration, checkReason, } from "./report-format.js";
import { actualStepsDocument, manualCaseFilename } from "./manual-case.js";
import { join } from "node:path";
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
    const manualDownload = (index, primary = false) => {
        const file = manualCaseFilename(index, filename === "report-rebuilt.html");
        return existsSync(join(directory, file))
            ? `<a${primary ? ' class="primary-download"' : ""} href="${file}?download=1" download="${file}">${index === undefined ? "下载完整批次手工用例" : "下载手工用例 .md"}</a>`
            : '<span class="download-unavailable">手工用例未生成，请重建报告</span>';
    };
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
        return `<section class="attachment" tabindex="-1" id="evidence-${caseIndex}-${escape(id)}"><div class="attachment-header"><h3>${image ? "页面截图" : "工具响应"}</h3>${link}</div>${content}<div class="hash">${escape(e.relative_path)}<br>SHA256 ${escape(e.sha256)}</div></section>`;
    };
    const compare = (s, caseIndex) => {
        const a = s.assertion;
        const spec = run.instances[caseIndex].effective_steps.find((step) => step.step_id === s.step_id)?.assertion;
        const expected = expectationText({
            description: s.description,
            operator: a.operator,
            value: a.expected,
            unit: spec?.unit,
            tolerance: spec?.tolerance,
        });
        return `<div class="comparison"><div><label>预期结果</label><p class="expected-sentence">${escape(expected)}</p></div><div><label>本次实际值</label><pre class="actual-value">${json(a.actual)}</pre></div><div class="comparison-footer"><span>${escape(checkReason(a))}</span>${a.evidence_refs[0] ? `<button class="evidence-button" data-evidence="evidence-${caseIndex}-${escape(a.evidence_refs[0])}">${icon("photo")} 查看证据</button>` : ""}</div></div><details class="inspect comparison-source"><summary>比较器与冻结依据 · 修订 ${a.plan_revision}</summary><p>原始结论：${escape(a.reason)}</p><p>比较符：${escape(a.operator)}${spec?.unit ? ` · 单位：${escape(spec.unit)}` : ""}${spec?.tolerance !== undefined ? ` · 容差：${escape(spec.tolerance)}` : ""}</p><pre class="frozen-value">${json(a.expected)}</pre><pre>${json(a.operand_snapshot)}</pre></details>`;
    };
    const input = run.plan.planning?.input;
    const sourceOf = (caseId) => input?.instances.find((item) => item.id === caseId);
    const caseKey = (caseId) => sourceOf(caseId)?.template_id ?? caseId;
    const cases = run.instances
        .map((i, index) => {
        const actual = projectActualCase(run, i);
        const media = recordingMedia(directory, run, i);
        const caseMs = i.steps.reduce((n, s) => n + s.duration_ms, 0);
        const ids = [
            ...new Set(i.steps.flatMap((s) => [
                ...s.observations.flatMap((o) => o.evidence_refs),
                ...(s.assertion?.evidence_refs ?? []),
            ])),
        ];
        const source = sourceOf(i.case_id);
        const original = source
            ? input.templates.find((t) => t.id === source.template_id)?.text
            : run.plan.planning?.original_task;
        const sourceInfo = `<details class="inspect case-source"><summary>用例来源与参数</summary><p>用例标识：${escape(i.case_id)} · 数据集：${escape(i.data_id)}</p>${original ? `<h3>原始用例</h3><pre>${escape(original)}</pre>` : "<p>该运行未保存独立的原始用例文字。</p>"}${source ? `<p>用例文件：${escape(input?.case_file?.path ?? "对话模板")}；CSV：${escape(input?.csv_file?.path ?? "无")}；数据行：${escape(source.data_row ?? "—")}</p><h3>参数值</h3><pre>${json(source.parameters)}</pre><h3>展开后的任务</h3><pre>${escape(source.task)}</pre>` : ""}</details>`;
        const assertions = i.steps.filter((s) => s.assertion || i.effective_required_assertion_ids.includes(s.step_id));
        const passed = assertions.filter((s) => s.assertion?.status === "PASS").length;
        const errors = assertions.filter((s) => s.assertion?.status === "ERROR").length;
        const failed = assertions.filter((s) => s.assertion?.status === "FAIL").length;
        const other = assertions.length - passed - errors - failed;
        const checkSummary = `${passed} 通过${failed ? ` · ${failed} 失败` : ""}${errors ? ` · ${errors} 异常` : ""}${other ? ` · ${other} 未通过或未执行` : ""}`;
        const focus = i.steps.find((s) => ["FAIL", "ERROR", "INCONCLUSIVE", "BLOCKED"].includes(s.status));
        const completeness = {
            COMPLETE: "记录完整",
            PARTIAL: "记录需复核",
            NOT_RECORDED: "未记录实际动作",
        }[actual.completeness];
        const more = `<details class="download-menu"><summary>更多下载</summary><div>${download(`actual-steps-${i.case_run_id}.json`, Buffer.from(JSON.stringify({ ...actualStepsDocument(run), cases: [actual] }, null, 2)), "application/json", "实际步骤 JSON")}${run.instances.length > 1 ? manualDownload() : ""}</div></details>`;
        return `<article class="case" id="case-${index}" data-case="${escape(caseKey(i.case_id))}" data-data="${escape(i.data_id)}" data-status="${escape(i.status)}" data-search="${escape([i.name, i.case_id, i.data_id, i.status].join(" ").toLocaleLowerCase())}"${index ? " hidden" : ""}>
        <header class="case-head"><div class="case-title-row"><div class="case-heading"><h2>${escape(i.name)}</h2>${badge(i.status)}</div><div class="case-export">${manualDownload(index, true)}<small>含实际操作与原有预期，可交给他人再次执行</small></div></div><div class="case-meta"><span>数据集 <b>${escape(i.data_id)}</b></span><span>步骤耗时 <b>${duration(caseMs)}</b></span><span>检查 <b>${checkSummary}</b></span><span>${completeness}</span>${more}</div></header>
        ${focus ? `<aside class="case-summary"><div><strong>${escape(focus.description)}</strong><span>${escape(focus.assertion ? checkReason(focus.assertion) : (focus.reason ?? labels[focus.status] ?? focus.status))}</span></div><button class="text-button" data-process-focus>定位异常</button></aside>` : actual.needs_review ? '<aside class="case-summary"><span>实际操作记录需复核。</span><button class="text-button" data-process-focus>查看过程</button></aside>' : ""}
        ${i.issues.length ? `<aside class="issue">${i.issues.map(escape).join("<br>")}</aside>` : ""}${i.unsettled_call_ids.length ? `<aside class="issue danger">尚有 ${i.unsettled_call_ids.length} 次未结算调用；外部执行可能仍未停止。</aside>` : ""}${media.notice}
        <div class="tabs" role="tablist" aria-label="用例详情">${[
            ["process", "执行过程"],
            ["assertions", `检查结果 (${assertions.length})`],
            ["attachments", `附件 (${ids.length})`],
            ...(media.videos ? [["recordings", "操作录像"]] : []),
        ]
            .map(([key, label]) => `<button role="tab" id="tab-${index}-${key}" aria-controls="panel-${index}-${key}" aria-selected="${key === "process"}" tabindex="${key === "process" ? "0" : "-1"}" data-tab="${key}">${label}</button>`)
            .join("")}</div>
        <div class="panel process" id="panel-${index}-process" role="tabpanel" aria-labelledby="tab-${index}-process" data-panel="process">${executionProcess({ run, instance: i, actual, index, compare, callDetails })}${sourceInfo}<details class="inspect process-help"><summary>记录说明</summary><p>操作完成与业务检查分别记录。没有独立检查的动作不额外填写预期；未执行、未知和失败尝试保留原状态。规划、输入及原生调用可在对应步骤中展开。</p></details></div>
        <div class="panel" id="panel-${index}-assertions" role="tabpanel" aria-labelledby="tab-${index}-assertions" data-panel="assertions" hidden>${assertions.map((s) => `<section class="assertion-item"><h3>${escape(s.description)} ${badge(s.status, s.status === "ERROR" ? "检查执行异常" : (labels[s.status] ?? s.status))}</h3>${s.assertion ? compare(s, index) : `<p class="reason">${escape(s.reason ?? "此检查未执行，没有实际值与比较结果。")}</p>`}</section>`).join("") || '<p class="empty">尚无已执行的检查；不能据此判定通过。</p>'}<details class="inspect"><summary>输入数据与冻结预期</summary><pre>${json(i.data)}</pre></details>${i.revision_history?.length ? `<details class="inspect"><summary>动态检查来源与事后标记</summary><pre>${json(i.revision_history)}</pre></details>` : ""}</div>
        <div class="panel attachments" id="panel-${index}-attachments" role="tabpanel" aria-labelledby="tab-${index}-attachments" data-panel="attachments" hidden>${ids.map((id) => attachment(id, index)).join("") || '<p class="empty">本用例没有采集附件</p>'}</div>${media.videos ? `<div class="panel recordings" id="panel-${index}-recordings" role="tabpanel" aria-labelledby="tab-${index}-recordings" data-panel="recordings" hidden>${media.videos}</div>` : ""}</article>`;
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
    const links = `<div class="footer-links">${download("actual-steps.json", Buffer.from(JSON.stringify(actualStepsDocument(run), null, 2)), "application/json", "下载完整批次实际步骤")}${download("results.json", Buffer.from(JSON.stringify(redact(run), null, 2)), "application/json", "下载运行数据")}${download("plan.json", Buffer.from(JSON.stringify(redact(run.plan), null, 2)), "application/json", "下载冻结计划")}${existsSync(eventPath) ? `<a href="events.jsonl?download=1" download="events.jsonl">下载事件账本</a>` : ""}</div>`;
    const lease = run.node_lease;
    const leaseConfirmed = lease?.state === "RELEASED" && lease.cleanup === "COMPLETE";
    const leaseSummary = lease
        ? '<aside class="issue' +
            (leaseConfirmed || lease.state === "NOT_ACQUIRED" ? "" : " danger") +
            '"><strong>Node 使用权：' +
            escape(leaseConfirmed
                ? "已归还"
                : lease.state === "NOT_ACQUIRED"
                    ? "未领取"
                    : "归还未获确认") +
            "</strong><p>" +
            escape(lease.node_id) +
            " / " +
            escape(lease.grant_id ?? lease.request_id) +
            " · " +
            escape(lease.state) +
            " · 清理 " +
            escape(lease.cleanup ?? "尚未确认") +
            "</p><p>到期：" +
            escape(lease.expires_at ? time(lease.expires_at) : "尚未取得") +
            " · 空闲截止：" +
            escape(lease.idle_deadline_at
                ? time(lease.idle_deadline_at)
                : lease.inflight
                    ? "真实执行中，空闲倒计时暂停"
                    : "尚未取得") +
            "</p>" +
            (lease.error ? "<p>" + escape(lease.error) + "</p>" : "") +
            "<p>业务断言与设备归还分别记录；浏览器关闭不代表整 Node 已交还。</p></aside>"
        : "";
    const leaseCompact = lease
        ? `<div class="resource-status${leaseConfirmed || lease.state === "NOT_ACQUIRED" ? "" : " resource-warning"}"><span>Node ${leaseConfirmed ? "已归还" : lease.state === "NOT_ACQUIRED" ? "未领取" : "归还未获确认"}</span><button class="text-button" data-nav="info">查看详情</button></div>`
        : "";
    const technicalDownloads = `<details class="technical-downloads"><summary>运行资料下载</summary>${links}</details>`;
    const batchDownload = `<div class="batch-export">${manualDownload(undefined, true)}<p>导出全部实例的操作步骤与原有预期，供再次执行。</p></div>`;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(run.name)} · 测试报告</title><style>${reportStyle}</style></head><body><nav class="rail" aria-label="报告导航"><div class="brand">DSH / TEST REPORT</div>${[
        ["overview", "home", "概览"],
        ["cases", "list-details", "测试用例"],
        ["info", "info-circle", "运行信息"],
    ]
        .map(([key, img, label]) => `<button class="nav-button${key === "cases" ? " active" : ""}" data-nav="${key}" aria-current="${key === "cases" ? "page" : "false"}">${icon(img)}${label}</button>`)
        .join("")}<small>静态测试报告<br>可离线查看</small></nav><main class="app"><header class="run-header"><div class="run-title"><h1>${escape(run.name)}</h1><div class="run-meta"><span>${escape(time(run.created_at))}</span><span>${run.lifecycle === "FINISHED" ? "已结束" : "记录未结算"}</span><span>静态报告</span></div></div>${leaseCompact}</header>${run.manifest.plan_approved === false ? '<aside class="issue">计划未获批准，未执行任何业务。</aside>' : ""}${run.incomplete || run.resource_quarantined ? `<aside class="issue danger">${run.incomplete ? "记录不完整。" : ""}${run.resource_quarantined ? "环境已隔离，外部执行可能仍未停止。" : ""}</aside>` : ""}${run.manifest.actual_steps_export_error ? `<aside class="issue">${escape(run.manifest.actual_steps_export_error)}</aside>` : ""}<section class="workspace" data-view="cases"><aside class="case-list"><div class="list-title"><h3>测试用例</h3><span>${stats.total} 个实例</span></div><label class="search">${icon("search")}<input id="search" type="search" placeholder="搜索用例名称或标识…" aria-label="搜索用例"></label><div class="filters"><label>用例<select id="case"><option value="">全部</option>${options("case_id")}</select></label><label>数据<select id="data"><option value="">全部</option>${options("data_id")}</select></label><label>状态<select id="status"><option value="">全部</option>${options("status")}</select></label></div><div class="list-subtitle"><span id="count" aria-live="polite"></span><button id="clear" class="text-button">清除筛选</button></div><div class="case-rows">${list}</div><p class="empty" id="empty" hidden>没有符合筛选条件的实例</p></aside><div class="detail">${cases}<div id="no-detail" class="empty" hidden>没有可展示的用例，请调整筛选条件。</div></div></section><section class="overview" data-view="overview" hidden><h2>运行总览</h2><div class="metrics"><div class="metric"><strong>${stats.total}</strong><span>用例总数</span></div><div class="metric"><strong class="positive">${stats.PASS ?? 0}</strong><span>通过</span></div><div class="metric"><strong class="${stats.total - (stats.PASS ?? 0) ? "negative" : ""}">${stats.total - (stats.PASS ?? 0)}</strong><span>未通过 / 未完成</span></div><div class="metric"><strong>${duration(totalMs)}</strong><span>运行总耗时（含规划）</span></div></div>${batchDownload}${input ? `<p>原始用例 ${input.templates.length} 条 · CSV 数据 ${input.rows.length} 行 · 执行实例 ${input.instances.length} 个</p>` : ""}<p>${stats.total ? (((stats.PASS ?? 0) / stats.total) * 100).toFixed(1) + "%" : "—"} 用例通过率 · ${passedAssertions} / ${assertionCount} 条已执行断言通过</p><div class="distribution">${Object.entries(stats)
        .filter(([k, v]) => k !== "total" && v > 0)
        .map(([k, v]) => `<button data-filter-status="${escape(k)}">${badge(k)}<strong>${v}</strong></button>`)
        .join("")}</div><h2>测试套件与用例</h2><div class="table-wrap"><table><thead><tr><th>用例名称</th><th>数据集</th><th>状态</th><th>断言通过 / 已执行</th><th>步骤耗时</th></tr></thead><tbody>${run.instances.map((i, index) => `<tr><td><button class="case-link" data-open-case="case-${index}">${escape(i.name)}</button></td><td>${escape(i.data_id)}</td><td>${badge(i.status)}</td><td>${i.steps.filter((s) => s.assertion?.status === "PASS").length} / ${i.steps.filter((s) => s.assertion).length}</td><td>${duration(i.steps.reduce((n, s) => n + s.duration_ms, 0))}</td></tr>`).join("")}</tbody></table></div><p class="note">通过率以全部用例实例为分母。取消、阻塞和未确定不会计为通过。断言统计仅计入真实比较记录；未执行的断言可在用例详情中查看。</p>${technicalDownloads}</section><section class="run-info" data-view="info" hidden><h2>运行信息</h2>${leaseSummary}<dl><dt>运行 ID</dt><dd>${escape(run.suite_run_id)}</dd><dt>开始时间</dt><dd>${escape(time(run.created_at))}</dd><dt>结束时间</dt><dd>${escape(time(run.finished_at))}</dd><dt>执行模式</dt><dd>${escape(run.manifest.execution ?? run.manifest.tools_mode ?? "未记录")}</dd><dt>发起会话</dt><dd>${escape(run.manifest.origin_session_id ?? "未记录")}</dd><dt>插件版本</dt><dd>${escape(run.manifest.plugin_version ?? "未记录")}</dd></dl><details class="inspect"><summary>完整运行配置与预算</summary><pre>${json(run.manifest)}</pre></details><p>本报告依据冻结计划、绑定的实际观察和确定性比较结果生成。采集定位的运行时调整保存在对应步骤中，原始预期保持不变。</p>${technicalDownloads}</section></main>${run.evidence.some((e) => e.media_type.startsWith("image/")) ? '<dialog id="image-dialog" aria-label="页面截图预览"><button id="close-image" class="text-button">关闭预览</button><img id="full-image" alt="实际页面截图完整预览"></dialog>' : ""}<script type="application/json" id="report-data">${data.script()}</script><script>(${reportInteractions.toString()})();</script></body></html>`;
    atomicWrite(safePath(directory, filename), html);
}
