import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { ToolCallId } from "@deepseek-ai/dsh-llm/brand";
import { createHash, randomUUID } from "node:crypto";
import { runbridgeEnabled } from "./browser-preferences.js";
import { legacyBrowserTools, toolSource, } from "./tool-capabilities.js";
import { ToolPreview } from "./tool-preview.js";
import { isPlaywrightMcp, playwrightPreviewContext, playwrightPreviewFrame, } from "./playwright-preview.js";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { aggregate, ajv, expand, field, parsePlan, actionSchema, assertionSchema, statistics, captureSchema, validateCaptures, } from "./contracts.js";
import { Recorder } from "./recorder.js";
import { TestToolCatalog, businessTool, toolArguments, toolConnections, } from "./tool-runtime.js";
import { extractToolResult, toolExtractSchema, toolResultError, } from "./tool-results.js";
import { toolResourceStep, validateToolResource, } from "./tool-resource.js";
import { RecoveryManager } from "./recovery.js";
import { archiveToolImages, captureStep } from "./adapters.js";
import { RunBridge } from "./runbridge.js";
import { evaluate } from "./assertions.js";
import { writeReport } from "./report.js";
import { ReportAccess } from "./report-access.js";
import { PreviewManager } from "./preview.js";
import { projectProgress, } from "./progress-model.js";
import { defaults } from "./config.js";
import { parseTextPlan, textPlanSchema, textReview, validateTextExpectation, parseTextExpected, batchTextPlanSchema, parseBatchPlan, announcementParts, } from "./text-plan.js";
import { testLanguage, languageGuide } from "./language.js";
import { applyRevision } from "./revisions.js";
import { compositeOperation, operationTool, operationSchemaVersion, sealOperations, } from "./actual-operations.js";
import { writeManualCases } from "./manual-case.js";
import { ManualSource } from "./manual-source.js";
const empty = {
    type: "object",
    properties: {},
    additionalProperties: false,
};
const output = {
    schema: { type: "object" },
    render: (_, value) => [
        { type: "text", text: JSON.stringify(value, null, 2) },
    ],
};
const guide = `当前对话已启用测试增强，仍由本会话正常推理、工具调用、审批、追问和回复完成任务，不创建其他会话或后台任务。
规划阶段只根据用户描述分析目标、业务步骤、输入和预期。禁止访问网站、运行命令、调用API或提前验证用例；不能通过预跑寻找选择器。只可使用test_submit_plan、test_current、todo_write和ask_user_question。已给目标、输入和预期时直接形成计划；缺少必要信息时在本会话追问。
test_submit_plan按工具schema提交：普通任务为{name,rationale:"一两句面向用户的拆分说明",steps:[{description,checks?:string[]}]}；文件/参数化批量模式为{name,rationale,cases:[{instance_id,name,rationale,steps}]}，按planning_input.instances每个id恰好提交一次，使用对应已展开task与参数，不能合并、遗漏或自行改参数。把用户的一段话按常规理解拆成几个业务动作短句，checks只写用户预期的自然语言。不要提供suite_id、执行工具、选择器、能力类型、URL白名单、输出Schema、字段路径或比较器；不要为了未知页面结构追问用户。例如steps:[{description:"访问ceshiren.com"},{description:"搜索agent"},{description:"打开第一条搜索结果"},{description:"查看帖子的点赞数",checks:["点赞数不为0"]}]。用户没有提供的操作细节无需在规划期补齐。rationale简要说明为什么按这些业务动作拆分、怎样核对目标，不展开详细推理。/test提交成功后，必须先在正常对话中用原始任务、拆分思路、步骤清单三个部分通报返回的plan_summary，再执行第一个动作；/test-plan通过原生审核卡片展示这三部分。
文字计划执行：每次只处理test_current的当前步骤。先test_define_step({capability:"tool",allowed_targets:[当前目标地址或对象],reason:"本步依据"})；GET接口可继续capability:"api"。不配置未来步骤，当前业务工具只从真实目录选择。已有固定计划不能重写。
实际操作说明：使用test_execute_operation({description:"实际对象、动作与必要业务输入",tool_name:"目录中的完整工具名",arguments:{工具原有参数},purpose:"action"或"observe"})。所有服务均保持原有名称和Schema。按当前真实页面选择一个动作，不合并常规交互，不编造后续操作。截图可用purpose:"observe"，图片自动归档。用户收尾在cleanup阶段使用purpose:"cleanup"。上下文默认由外部服务管理，不自动reset或close；明确要求的初始化与清理形成真实前置或收尾。执行成功不代表业务通过，未知写结果不能重放。
文字检查点：获得可信观察后，对当前步骤的每个checks，调用test_bind_check({check_index:从0开始,assertion:{observation_ref:"step_编号.输出名.可选嵌套路径",operator:"eq/neq/...",expected_value:"用户预期原文，例如agent或0；不加引号或数组包装"}})。也可用expected_observation_ref比较前一步观察（例如第一条搜索结果链接）。rule_ref由插件绑定文字检查点；不用提交actual。预期来自原文和文字检查，不能按实际值改写；数字不为0用neq和expected_value直接填"0"（按数字条件解析为数值0）。正文或文本不为空必须用text采集、operator:"neq"、expected_value:""（空字符串），不能填0或字符串0，也不能以元素可见替代正文非空。每个文字检查都必须绑定程序断言，不能靠口头宣布通过；纯检查步骤可以直接引用前一步的可信观察。绑定后test_finish_step结算当前步骤并计算断言。无法完成用test_fail_step说明原因。
接口数组检查：接口数组的长度检查必须引用step_id.response.body.length；字段如step_id.response.body.0.iid，标签数量用step_id.response.body.0.labels.length。不要把整个数组与数量比较；只复用已采集响应，不重复请求。unit只表示展示单位，不会把数组转换成长度；长度断言必须在observation_ref引用.length，不能使用整个body配合unit:"length"。
执行阶段：按test_current操作当前目标，使用实际工具Schema，所有来源平等。缺少必要能力时test_fail_step如实记录。没有截图、预览或关闭能力不妨碍其他步骤；用例明确要求这些能力时按未满足处理。
运行时采集：调用test_capture({capture:{counter:{kind:"tool",tool_name:"实际读取工具名",arguments:{原参数},extract:{from:"structured",pointer:"/text",type:"number"}}},reason:"读取当前对象真实值"})。返回格式不确定时，先通过test_execute_operation的purpose:observe查看只读工具的真实返回，再登记采集；不能靠猜测首次绑定后再改规则。from=structured读取MCP structuredContent；value读取原工具的未解析value，MCP通常是包含content的整个包，不是文本中的结果；json解析指定文本块的完整JSON；text读取指定文本块；playwright-result解析实际### Result段里的JSON，当前返回仍使用此格式时也必须使用它。pointer使用JSON Pointer；block从0开始。纯文本可用between:{after:"固定前缀",before:"固定后缀"}提取唯一片段。提取规则派发前保存，执行后不可改写；不得提交actual或按结果改预期。动作返回通过test_execute_operation的observations预先定义提取，从同一次调用取得，不重复写操作。纯GET保留kind:http。旧dom仅绑定同一实际来源的兼容读取工具。固定采集调用test_capture({})。
采集成功后调用test_finish_step；程序计算断言，模型不能填写实际值或口头改判。定位失败可修正重试；确实无法完成时test_fail_step说明原因。用户停止后不再执行业务，只按同会话收尾指导执行预授权清理。全部完成调用test_finish，并在原生最终回复写明逐步结果、断言实际/预期、保存位置和工具返回的报告链接。BLOCKED、SKIPPED或缺证据不能写成通过。`;
function notice(text) {
    return createUserMessage({
        source: { kind: "plugin:test", form: "notice", summary: "测试增强上下文" },
        content: [{ type: "text", text }],
    });
}
function closeStep(id, description) {
    return {
        step_id: id,
        kind: "action",
        description,
        required: true,
        depends_on: [],
        run_if: "resource_exists",
        resource_ref: "browser_context",
        action: {
            goal: "调用test_capture关闭并验证浏览器上下文释放，然后test_finish_step。",
            capability: "browser",
            allowed_targets: [],
            inputs: {},
            outputs: { released: { type: "boolean" } },
            completion_requirements: ["released"],
            capture: { released: { kind: "browser_close" } },
        },
    };
}
const nativeOperationArguments = toolArguments;
export class NativeTests {
    ctx;
    preparePreview;
    config;
    reports;
    preview;
    recovery;
    sessions = new Map();
    historicalProgress = new Map();
    starting = false;
    constructor(ctx, config, preparePreview) {
        this.ctx = ctx;
        this.preparePreview = preparePreview;
        this.config = { ...defaults, ...config };
        this.preview = new PreviewManager(this.config.preview);
        this.recovery = new RecoveryManager(this.config.outputRoot, this.config.cleanupTimeoutMs, () => this.starting ||
            [...this.sessions.values()].some((s) => !s.closed || s.disposing), () => this.preview.shutdown());
        for (const key of [
            "stepTimeoutMs",
            "cleanupTimeoutMs",
            "cancelGraceMs",
            "maxRevisions",
        ])
            if (!Number.isFinite(this.config[key]) || this.config[key] <= 0)
                throw new Error("配置必须为有限正数: " + key);
        mkdirSync(this.config.outputRoot, { recursive: true });
        const released = new Set();
        for (const file of readdirSync(this.config.outputRoot).filter((n) => /^release-.*\.json$/.test(n))) {
            try {
                released.add(JSON.parse(readFileSync(join(this.config.outputRoot, file), "utf8"))
                    .quarantine.details.run_id);
            }
            catch {
                /* 不是有效处置证据。 */
            }
        }
        for (const id of readdirSync(this.config.outputRoot).filter((n) => /^run-[\w-]+$/.test(n))) {
            try {
                const run = JSON.parse(readFileSync(join(this.config.outputRoot, id, "results.json"), "utf8"));
                if (run.manifest.execution === "native-conversation" &&
                    run.lifecycle !== "FINISHED" &&
                    !released.has(id))
                    this.quarantine(run, "宿主重启发现未结算测试；请检查外部操作和资源，不能自动重放");
            }
            catch {
                /* 不读取或修改宿主会话数据。 */
            }
        }
        this.reports = new ReportAccess(this.config.outputRoot);
    }
    async start(agent, task, plan, review = false, input) {
        if (!task.trim())
            throw new Error("请提供动作、输入和可验证预期");
        if (agent.status !== "idle")
            throw new Error("请等待当前对话轮次结束后再启动测试");
        const quarantine = this.recovery.status().quarantine;
        if (quarantine)
            throw new Error(`测试环境尚未释放，已隔离：${quarantine.reason}。${quarantine.overdue ? "隔离时间已超过清理超时，可能异常卡住。" : ""}请进入“设置 → 测试插件 → 测试环境”，确认旧操作已停止后处理并释放，再重新执行测试命令；无法自动处理时，在同一设置页提交实际处置证据。`);
        if (this.starting ||
            this.recovery.busy ||
            [...this.sessions.values()].some((s) => !s.closed || s.disposing))
            throw new Error("已有测试运行，请先结束或停止该测试");
        if (review && !this.ctx.commands.find(agent, "plan"))
            throw new Error("/test-plan 需要宿主启用原生 dsh-plan-mode 和用户审核通道");
        this.starting = true;
        try {
            await this.preparePreview?.();
            const test = new NativeTest(this, agent, task, review, input);
            this.sessions.set(agent.id, test);
            try {
                await test.preparePlanning();
                if (review)
                    await test.enterPlanMode();
                test.attach();
                if (plan !== undefined)
                    test.submit(plan, true);
                return await test.start(task);
            }
            catch (error) {
                await test.dispose();
                throw error;
            }
        }
        finally {
            this.starting = false;
        }
    }
    reportId(sessionId) {
        const current = this.sessions.get(sessionId);
        if (current)
            return current.run.suite_run_id;
        for (const id of readdirSync(this.config.outputRoot)
            .filter((id) => /^run-[\w-]+$/.test(id))
            .sort()
            .reverse()) {
            try {
                const run = JSON.parse(readFileSync(join(this.config.outputRoot, id, "results.json"), "utf8"));
                if (run.manifest.origin_session_id === sessionId &&
                    run.lifecycle === "FINISHED" &&
                    existsSync(join(this.config.outputRoot, id, "report.html")))
                    return id;
            }
            catch {
                /* 不把损坏记录作为当前会话报告。 */
            }
        }
    }
    presentation(sessionId) {
        const current = this.sessions.get(sessionId);
        if (current)
            return current.presentation();
        if (!this.historicalProgress.has(sessionId)) {
            const id = this.reportId(sessionId);
            this.historicalProgress.set(sessionId, id
                ? JSON.parse(readFileSync(join(this.config.outputRoot, id, "results.json"), "utf8"))
                : null);
        }
        const run = this.historicalProgress.get(sessionId);
        return run
            ? projectProgress({
                run,
                phase: "finished",
                reportUrl: this.reports.url(run.suite_run_id),
            })
            : null;
    }
    quarantine(run, reason) {
        run.resource_quarantined = true;
        this.recovery.mark(run, reason);
    }
    release(evidenceFile) {
        this.recovery.release(evidenceFile);
    }
    async shutdown() {
        this.recovery.cancel();
        for (const test of this.sessions.values())
            if (!test.closed)
                await test.shutdown();
            else
                await test.dispose();
        await this.preview.shutdown();
    }
}
export class NativeTest {
    owner;
    review;
    input;
    recorder;
    run;
    agent;
    browser;
    closed = false;
    planned = false;
    selectedTool;
    selectedInstance;
    connectionReady = false;
    media;
    mediaCalls = new Set();
    previewPolls = new Set();
    mediaPrompted = new Set();
    dispatchedCalls = new Set();
    toolCatalog;
    captureLocks = new Map();
    domBindings = new Map();
    resourceConfig;
    resourcePhase;
    reportReady = false;
    cancelled = false;
    cleanupTurn = false;
    finalizing = false;
    finishing;
    disposal;
    disposalDone = false;
    nudges = 0;
    planningQuestion = false;
    cursor = 0;
    entries = [];
    current;
    calls = new Map();
    pendingTools = new Set();
    trustedCalls = new Map();
    operations = new Map();
    delegatedFailures = new Map();
    disposers = [];
    timer;
    stoppingTimer;
    mediaDeadline;
    task;
    originalTask;
    manualSource;
    draft;
    reviewCall;
    reviewDismissed = false;
    previousPlanMode;
    announcement;
    constructor(owner, agent, task, review = false, input) {
        this.owner = owner;
        this.review = review;
        this.input = input;
        this.agent = agent;
        this.task = task;
        this.originalTask = task;
        this.input = input ? structuredClone(input) : undefined;
        if (owner.config.browser?.resourceLifecycle) {
            this.resourceConfig = structuredClone(owner.config.browser.resourceLifecycle);
            validateToolResource(this.resourceConfig);
        }
        const id = "run-" +
            new Date().toISOString().replace(/[:.]/g, "-") +
            "-" +
            randomUUID().slice(0, 8);
        this.recorder = new Recorder(owner.config.outputRoot, id);
        this.run = {
            schema_version: "1",
            suite_run_id: id,
            name: "测试：" + task.slice(0, 80),
            created_at: new Date().toISOString(),
            lifecycle: "RUNNING",
            plan: {
                schema_version: "1",
                suite_id: "native",
                name: task,
                source_refs: [],
                cases: [],
            },
            instances: [],
            evidence: [],
            incomplete: false,
            resource_quarantined: false,
            manifest: {
                plugin_version: "0.19.0-alpha.1",
                plan_review: review,
                execution: "native-conversation",
                origin_session_id: agent.id,
                tools_mode: "native",
                actual_operations_schema: operationSchemaVersion,
            },
        };
        this.manualSource = new ManualSource(this.recorder.directory, id);
        this.media = new ToolPreview({
            catalog: () => this.toolCatalog,
            frame: (context, frame, mode) => {
                this.owner.preview.setToolFrame(this.run.suite_run_id, context.caseId, frame, mode);
                if (this.media.state().frames === 1) {
                    const refs = archiveToolImages(this.recorder, this.run, {
                        isError: false,
                        content: [
                            {
                                type: "image",
                                mimeType: frame.mime,
                                data: frame.bytes.toString("base64"),
                            },
                        ],
                    });
                    this.run.manifest.media_evidence_refs = refs;
                }
            },
            clear: () => this.owner.preview.clearTool(this.run.suite_run_id),
            viewing: () => this.owner.preview.viewing(this.run.suite_run_id),
            poll: () => this.pollPreview(),
            cdp: (context, metadata) => this.owner.preview.attachCdp(this.run, context.caseId, metadata),
            event: (kind, value) => {
                this.recorder.event(kind, value, this.current?.binding);
                this.run.manifest.media = JSON.parse(JSON.stringify(this.media.state()));
                this.owner.preview.toolNotice(this.run.suite_run_id, this.media.state().reason);
            },
        });
        if (runbridgeEnabled(owner.config.browser)) {
            try {
                this.browser = new RunBridge(owner.config.browser, owner.config.workspace, () => {
                    if (this.browser?.lease.record)
                        this.run.node_lease = structuredClone(this.browser.lease.record);
                    if (this.current && this.browser?.resource) {
                        this.current.instance.resources.browser_context = structuredClone(this.browser.resource);
                    }
                    this.save();
                }, {
                    credentialFile: join(owner.config.outputRoot, ".runbridge-access", id + ".json"),
                    cleanupTimeoutMs: owner.config.cleanupTimeoutMs,
                    invalid: (reason) => {
                        if (!this.closed && !this.finishing && !this.reportReady)
                            this.stop(reason);
                    },
                    retainAccessFile: () => this.run.resource_quarantined ||
                        this.run.incomplete ||
                        this.run.instances.some((instance) => {
                            const resource = instance.resources.browser_context;
                            return (!!resource?.remote &&
                                ["exists", "unknown"].includes(resource.state));
                        }),
                });
            }
            catch (error) {
                this.run.manifest.connection_notice = String(this.recorder.sanitize(String(error)));
            }
        }
    }
    async preparePlanning() {
        if (this.browser &&
            this.agent.ctx.tools
                .schemas(this.agent)
                .some((tool) => tool.name.startsWith(this.browser.prefix))) {
            this.run.manifest.connection_notice =
                "已有同名工具来源，由 DSH 管理连接；未重复登记 RunBridge 帮助器。";
            return;
        }
        try {
            await this.browser?.preparePlanning();
            this.connectionReady = !!this.browser;
        }
        catch (error) {
            this.run.manifest.connection_notice = String(this.recorder.sanitize(String(error)));
        }
    }
    assertTool(name) {
        this.toolCatalog.assert(name);
        const connection = this.toolCatalog
            .snapshot()
            .find((entry) => entry.name === name)?.connection;
        if (connection &&
            connection.id !== "registered-runbridge" &&
            toolConnections(this.owner.ctx).find((entry) => entry.id === connection.id)?.digest !== connection.digest)
            throw new Error("工具连接配置已改变，不能把本轮调用转到另一连接: " + name);
        if (this.current?.phase === "cleanup" &&
            this.current.instance.steps.some((s) => s.calls.some((c) => c.external_outcome === "UNKNOWN") ||
                s.actual_operations?.some((o) => o.state === "UNKNOWN")))
            throw new Error("外部工具结果未知，不能自动继续清理；请先确认原操作已停止");
        const config = this.resourceConfig;
        if (!config)
            return;
        const phase = this.resourcePhase ??
            (this.current?.step.step_id === "__resource_open"
                ? "start"
                : this.current?.step.step_id === "__resource_close"
                    ? "close"
                    : undefined);
        if ([config.start.tool_name, config.close.tool_name].includes(name) &&
            (!phase || config[phase].tool_name !== name))
            throw new Error("本轮资源生命周期只允许由已配置的初始化或收尾执行");
    }
    get closeTool() {
        if (this.current?.step.step_id === "__resource_close")
            return this.resourceConfig.close.tool_name;
        return this.captureBrowser
            ? this.captureBrowser.prefix + "browser_stop"
            : this.legacyTools.close;
    }
    get captureBrowser() {
        if (!this.browser || !this.connectionReady)
            return;
        const bound = this.selectedTool?.startsWith(this.browser.prefix);
        return bound ||
            (this.releaseStep() &&
                this.current?.step.step_id === "__connection_close") ||
            (!this.selectedTool &&
                this.legacyTools.capture === this.browser.prefix + "browser_capture")
            ? this.browser
            : undefined;
    }
    get legacyTools() {
        if (!this.toolCatalog)
            return {};
        return legacyBrowserTools(this.toolCatalog.snapshot(), this.selectedTool);
    }
    captureHost() {
        if (this.connectionReady &&
            this.browser &&
            Object.values(this.current?.step.action?.capture ?? {}).some((capture) => capture.kind === "browser_open"))
            this.selectedTool = this.browser.prefix + "browser_capture";
        return {
            id: this.id,
            browser: this.captureBrowser,
            legacyTools: this.legacyTools,
            domBindings: Object.fromEntries(Object.keys(this.current?.step.action?.capture ?? {}).flatMap((name) => {
                const binding = this.domBindings.get(this.domBindingKey(name));
                return binding ? [[name, binding]] : [];
            })),
            assertTool: (name) => this.assertTool(name),
            call: this.call.bind(this),
        };
    }
    domBindingKey(name) {
        return `${this.current?.instance.case_run_id}/${this.current?.step.step_id}/${name}`;
    }
    get mediaEnabled() {
        return ((!!this.owner.preview.config &&
            this.owner.preview.config.previewEnabled !== false) ||
            (!!this.connectionReady && !!this.browser?.config.previewEnabled));
    }
    mediaState() {
        const known = this.owner.preview.summary(this.run.suite_run_id);
        return {
            enabled: this.mediaEnabled,
            ...this.media.state(),
            known_adapter: !!this.playwrightMediaTool(),
            ...(known.ready
                ? {
                    mode: known.mode ?? "continuous",
                    reason: known.reason ?? "持续画面已连接",
                }
                : {}),
        };
    }
    playwrightMediaTool() {
        if (!this.selectedTool ||
            !this.toolCatalog ||
            this.selectedTool.endsWith("__browser_close"))
            return;
        const entries = this.toolCatalog.snapshot(), active = entries.find((entry) => entry.name === this.selectedTool);
        if (!active?.connection)
            return;
        const registration = this.owner.ctx
            .get?.("configEditor")
            ?.entries()
            .find((entry) => entry.options.id === active.connection.id);
        if (!registration ||
            !isPlaywrightMcp(registration.options.config))
            return;
        return entries.find((entry) => toolSource(entry) === toolSource(active) &&
            entry.name.endsWith("__browser_run_code") &&
            entry.parameters
                .properties?.code)?.name;
    }
    requestPreview() {
        if (!this.current || !this.selectedTool || this.closed || this.reportReady)
            return "等待当前对话的测试打开实际页面后再尝试接入。";
        this.media.retry();
        this.agent.followup(notice("用户请求尝试当前实际来源的画面连接。查看test_current.media，读取真实工具Schema，使用test_connect_preview验证原页面身份与首帧；不要新建浏览器或改变业务预期。"));
        return "已交给当前对话 Agent 尝试，结果将在画面状态中显示。";
    }
    stopPreview() {
        this.media.unavailable("画面尝试与截图轮询已停止，可在当前页面重新尝试。");
        return "已停止画面尝试与截图轮询。";
    }
    async pollPreview() {
        if (this.closed ||
            this.cancelled ||
            this.reportReady ||
            this.pendingTools.size ||
            !this.current ||
            this.current.phase === "cleanup")
            return;
        const callId = ToolCallId(randomUUID());
        this.previewPolls.add(callId);
        this.mediaCalls.add(callId);
        try {
            await this.agent.ctx.tools.execute({
                callId,
                rootCallId: callId,
                name: "test_preview_poll",
                arguments: {},
                agent: this.agent,
                signal: AbortSignal.timeout(5000),
            });
        }
        finally {
            this.previewPolls.delete(callId);
        }
    }
    scheduleToolCleanup(instance) {
        if (!this.resourceConfig ||
            this.entries.some((e) => e.instance === instance && e.step.step_id === "__resource_close"))
            return;
        const last = this.entries.findLastIndex((e) => e.instance === instance);
        this.entries.splice(last + 1, 0, {
            instance,
            phase: "cleanup",
            step: toolResourceStep(this.resourceConfig, true),
        });
    }
    scheduleConnectionCleanup() {
        if (!this.current)
            return;
        const instance = this.current.instance;
        if (this.entries.some((entry) => entry.instance === instance &&
            entry.step.step_id === "__connection_close"))
            return;
        const after = this.entries.findIndex((entry, index) => index >= this.cursor && entry.instance !== instance);
        this.entries.splice(after < 0 ? this.entries.length : after, 0, {
            instance,
            phase: "cleanup",
            step: closeStep("__connection_close", "归还本轮连接创建的浏览器资源"),
        });
    }
    genericGuidance() {
        return (guide +
            "\n旧计划的DOM要求没有兼容读取工具时，使用test_bind_capture绑定真实同源读取工具；selector_argument、attribute_argument、index_argument只声明工具参数名，值由原冻结要求注入；extract和url来自真实返回。不能修改原选择器、输出和业务预期。" +
            (this.resourceConfig
                ? "\n本轮已配置工具资源生命周期：初始化与关闭只按test_current的固定步骤调用test_capture，不能另起会话或跳过本轮清理。"
                : "") +
            (this.mediaEnabled
                ? "\n画面连接：首次实际操作后查看test_current.media。known_adapter=true可先调用test_connect_preview(auto:true)，它只读当前页面且不重启连接。先复用已验证的画面，否则根据当前来源的真实工具尝试test_connect_preview。context从最近实际操作返回提取原页面或会话身份；frame_context从截图返回提取相同身份，或identity_argument把原身份注入截图参数。跨来源需同时声明source_context与frame_source_context核对真实浏览器身份，且frame_context核对原页面。不能只用URL或模型描述认定同一页面。image只在图片URL或CDP元数据需要提取时填写；默认读取规范image块。截图可重复读取时优先mode:poll，首帧先标为单次，第二次原页面图片核对后才标为定时截图；只读一次的工具使用mode:once。没有候选能力时用unavailable_reason如实记录，画面失败不改业务预期。无需为每帧调用模型。"
                : ""));
    }
    lockToolCaptures(captures, commit = true) {
        for (const [name, cap] of Object.entries(captures)) {
            if (cap.kind !== "tool")
                continue;
            const key = `${this.current.binding.case_run_id}/${this.current.binding.step_id}/${name}`;
            const signature = JSON.stringify({
                tool_name: cap.tool_name,
                extract: cap.extract,
            });
            const previous = this.captureLocks.get(key);
            if (previous && previous !== signature)
                throw new Error("工具已经执行，不能改写该输出的采集工具或提取规则: " + name);
            if (commit)
                this.captureLocks.set(key, signature);
        }
    }
    prepareOperationObservations(input, args) {
        if (!input.observations || !Object.keys(input.observations).length)
            return;
        const c = this.current;
        const capture = Object.fromEntries(Object.entries(input.observations).map(([name, extract]) => [
            name,
            {
                kind: "tool",
                tool_name: input.tool_name,
                arguments: args,
                extract,
            },
        ]));
        this.lockToolCaptures(capture, false);
        for (const name of Object.keys(capture))
            if (c.result.observations.some((o) => o.output_name === name))
                throw new Error("已有观察不能覆盖: " + name);
        if (c.step.action.capture_mode === "runtime" &&
            c.step.checks !== undefined) {
            const outputs = { ...c.step.action.outputs };
            for (const [name, extract] of Object.entries(input.observations))
                outputs[name] = extract.type ? { type: extract.type } : {};
            const action = {
                ...c.step.action,
                outputs,
                completion_requirements: Object.keys(outputs),
            };
            validateCaptures(action, capture);
            const step = { ...c.step, action };
            const effective = c.instance.effective_steps.map((s) => s.step_id === step.step_id ? step : s);
            this.validateEffective(c.instance, effective);
            c.step = step;
            c.instance.effective_steps = effective;
            this.recorder.event("step_defined", { step, reason: "派发前登记动作返回提取" }, c.binding);
        }
        else {
            validateCaptures(c.step.action, capture);
            for (const [name, cap] of Object.entries(capture))
                if (JSON.stringify(cap) !== JSON.stringify(c.step.action.capture?.[name]))
                    throw new Error("动作返回提取必须与冻结定义一致");
        }
        this.lockToolCaptures(capture);
        this.recorder.event("capture_configured", {
            capture,
            reason: "派发前登记动作返回提取",
            started_at: new Date().toISOString(),
        }, c.binding);
        this.save();
        return capture;
    }
    get id() {
        return this.agent.id;
    }
    async enterPlanMode() {
        // Web预设将planMode放在隔离组中；通过官方命令解析当前Agent的有效服务。
        const state = this.agent.ctx.sessionProjections.stateOf(this.agent.session, "plan");
        this.previousPlanMode =
            state?.running?.wanted ?? state?.wanted ?? state?.active ?? false;
        await this.setPlanMode(true);
    }
    async setPlanMode(active) {
        const executed = await this.owner.ctx.commands.execute(this.agent, active ? "/plan" : "/plan off", [], new AbortController().signal);
        if (executed?.result.kind !== "success")
            throw new Error(executed?.result.text ?? "宿主未提供原生/plan命令");
    }
    attach() {
        const scope = this.agent.ctx;
        const own = (dispose) => {
            this.disposers.push(dispose);
        };
        if (this.connectionReady)
            own(this.browser.register(scope));
        const connections = toolConnections(this.owner.ctx);
        if (this.connectionReady)
            connections.push({
                id: "registered-runbridge",
                prefix: this.browser.prefix,
                digest: createHash("sha256")
                    .update(JSON.stringify(this.owner.config.browser))
                    .digest("hex"),
            });
        this.toolCatalog = new TestToolCatalog(scope.tools, this.connectionReady
            ? [
                this.browser.prefix + "browser_start",
                this.browser.prefix + "browser_stop",
            ]
            : [], connections, this.agent);
        this.recorder.json("tool-catalog.json", this.toolCatalog.snapshot());
        this.run.manifest.tool_runtime_schema = "1";
        this.run.manifest.execution_source = "agent-tools";
        this.run.manifest.tool_connections = connections.map((c) => ({
            id: c.id,
            digest: c.digest,
        }));
        own(scope.systemPrompt.section({
            name: "plugin:test-guidance",
            order: 10500,
            interpolate: false,
            text: () => languageGuide(this.outputLanguage()) +
                "\n" +
                (this.reportReady
                    ? "测试报告已生成。请在本轮回复中只总结test_finish返回的权威统计、逐步状态和断言。BLOCKED或缺少断言记录绝不能写成PASS；页面口头观察不能替代程序断言。给出报告链接。"
                    : this.genericGuidance() +
                        (this.review && !this.planned
                            ? "\n本次为审核入口（/test-plan或/test-data）：原生plan模式中只规划。test_submit_plan仅保存可修改草案，不会执行。提交成功后，将返回的review_markdown原样作为exit_plan_mode的plan参数展示审核。不要自行缩写或替换审核内容。用户要求修改时重新test_submit_plan再审核；同意后插件自动冻结已审草案并开始执行。关闭plan模式不代表批准。"
                            : "") +
                        "\n当前测试状态：" +
                        JSON.stringify(this.state())),
        }));
        const tool = (name, description, parameters, execute) => own(scope.tools.register({
            name,
            description,
            parameters,
            output,
            execute: async (args, exec) => {
                // 可选TypeScript字段不得以undefined进入宿主的无损JSON工具边界。
                return JSON.parse(JSON.stringify(await execute(args, exec)));
            },
        }));
        tool("test_bind_capture", "为当前冻结 DOM 要求绑定同一实际来源的读取工具；保留原选择器、输出和业务预期，派发后不能改规则。", {
            type: "object",
            required: ["output", "tool_name", "extract", "url", "reason"],
            additionalProperties: false,
            properties: {
                output: { type: "string" },
                tool_name: { type: "string" },
                arguments: { type: "object" },
                arguments_json: { type: "string" },
                selector_argument: { type: "string", minLength: 1 },
                attribute_argument: { type: "string", minLength: 1 },
                index_argument: { type: "string", minLength: 1 },
                extract: toolExtractSchema,
                url: toolExtractSchema,
                reason: { type: "string", minLength: 1 },
            },
        }, (args, exec) => {
            this.requireSettled(exec);
            const capture = this.current?.step.action?.capture?.[args.output];
            if (!capture || capture.kind !== "dom")
                throw new Error("仅当前步骤的冻结 DOM 要求可绑定工具");
            if (this.current.result.observations.some((observation) => observation.output_name === args.output))
                throw new Error("已有观察不能重新绑定");
            this.assertTool(args.tool_name);
            const entries = this.toolCatalog.snapshot();
            if (this.selectedTool &&
                toolSource(entries.find((entry) => entry.name === this.selectedTool)) !==
                    toolSource(entries.find((entry) => entry.name === args.tool_name)))
                throw new Error("不能把当前页面的 DOM 要求切换到另一来源");
            if (capture.selector && !args.selector_argument)
                throw new Error("需要指定原工具的选择器参数名，值由冻结 DOM 要求注入");
            if (capture.attribute && !args.attribute_argument)
                throw new Error("需要指定原工具的属性参数名，不能更换冻结属性");
            if (capture.index !== undefined && !args.index_argument)
                throw new Error("需要指定原工具的序号参数名，不能更换冻结序号");
            const { output, reason, ...binding } = args;
            toolArguments(binding.arguments === undefined &&
                binding.arguments_json === undefined
                ? { arguments: {} }
                : binding);
            const key = this.domBindingKey(output), previous = this.domBindings.get(key);
            if (previous && JSON.stringify(previous) !== JSON.stringify(binding))
                throw new Error("DOM 工具绑定已冻结，不能根据返回结果改写提取规则");
            this.domBindings.set(key, structuredClone(binding));
            this.recorder.event("capture_tool_bound", { output, binding, reason, original: capture }, this.current.binding);
            return this.state();
        });
        tool("test_connect_preview", "使用当前实际来源的真实工具验证画面；不创建新页面，不改变业务断言。", {
            type: "object",
            additionalProperties: false,
            properties: {
                tool_name: {
                    type: "string",
                    ...(this.toolCatalog.names().length
                        ? { enum: this.toolCatalog.names() }
                        : {}),
                },
                arguments: { type: "object" },
                arguments_json: { type: "string" },
                mode: { enum: ["once", "poll"] },
                auto: {
                    type: "boolean",
                    description: "仅test_current.media.known_adapter=true时使用true。未知来源省略auto，填写真实tool_name、context和frame_context；不能猜测自动增强。",
                },
                transport: { enum: ["image", "cdp"] },
                context: toolExtractSchema,
                frame_context: toolExtractSchema,
                source_context: toolExtractSchema,
                frame_source_context: toolExtractSchema,
                identity_argument: { type: "string", minLength: 1 },
                image: toolExtractSchema,
                unavailable_reason: { type: "string", minLength: 1 },
            },
        }, async (args, exec) => {
            if (!this.mediaEnabled)
                throw new Error("实时画面偏好尚未启用，下次测试开启后再尝试");
            this.requireSettled(exec);
            if (args.unavailable_reason) {
                this.media.unavailable(args.unavailable_reason);
                return this.mediaState();
            }
            const known = await this.owner.preview.state(this.run.suite_run_id);
            if (known.ready && (known.mode !== "once" || known.paused))
                return { connected: true, ...known };
            try {
                if (args.auto) {
                    if (!this.current || this.current.phase === "cleanup")
                        throw new Error("当前不是可尝试画面的业务阶段");
                    const name = this.playwrightMediaTool();
                    if (!name)
                        throw new Error("当前来源没有已知画面增强，请根据真实工具提交采集方法");
                    this.media.reserveAttempt();
                    const context = await this.call(name, { code: playwrightPreviewContext }, exec, undefined, true);
                    if (context.result.isError)
                        throw new Error("已知画面增强未取得原页面身份");
                    this.media.bind({
                        callId: context.callId,
                        tool: name,
                        caseId: this.current.instance.case_run_id,
                        result: context.result,
                    });
                    if (this.owner.preview.config?.connectionId ===
                        this.run.manifest.active_tool_source)
                        await this.owner.preview.adoptCdp(this.run, this.current.instance.case_run_id, extractToolResult(context.result, {
                            from: "playwright-result",
                            pointer: "/page_id",
                        }), context.callId);
                    const continuous = await this.owner.preview.state(this.run.suite_run_id);
                    if (continuous.ready && continuous.mode === "continuous")
                        return { connected: true, ...continuous };
                    return await this.media.connect({
                        tool_name: name,
                        arguments: { code: playwrightPreviewFrame },
                        mode: args.mode ?? "poll",
                        context: { from: "playwright-result", pointer: "/page_id" },
                        frame_context: {
                            from: "playwright-result",
                            pointer: "/page_id",
                        },
                        image: { from: "playwright-result", pointer: "/image" },
                    }, async (tool, input) => (await this.call(tool, input, exec, undefined, true)).result, true);
                }
                if (!args.tool_name || !args.context)
                    throw new Error("需要实际工具和原页面身份提取规则");
                return await this.media.connect(args, async (name, input) => (await this.call(name, input, exec, undefined, true)).result);
            }
            catch (error) {
                this.media.unavailable(error instanceof Error ? error.message : "画面接入失败");
                throw error;
            }
        });
        tool("test_preview_poll", "宿主内部复用已验证的图片采集方法。", empty, async (_, exec) => {
            if (!this.previewPolls.has(exec.callId))
                throw new Error("该入口仅由当前测试的画面采集调度");
            await this.media.capture(async (name, input) => (await this.call(name, input, exec, undefined, true)).result);
            return this.mediaState();
        });
        tool("test_submit_plan", "提交本对话文字测试计划；审核入口只保存草案。从原文提取预期，不能提交实际结果。批量模式每个instance_id恰好规划一次。", this.input ? batchTextPlanSchema : textPlanSchema, (args) => this.submit(args));
        tool("test_current", "读取当前步骤、冻结目标、输入及已计算断言。", empty, () => this.state());
        const operationParameters = {
            type: "object",
            required: ["description", "tool_name"],
            additionalProperties: false,
            properties: {
                description: { type: "string", minLength: 1, maxLength: 2000 },
                tool_name: {
                    type: "string",
                    ...(this.toolCatalog.names().length
                        ? { enum: this.toolCatalog.names() }
                        : {}),
                    description: "从本轮目录选择完整工具名，保持该工具原有参数。",
                },
                purpose: { enum: ["action", "observe", "cleanup"] },
                observations: {
                    type: "object",
                    additionalProperties: toolExtractSchema,
                },
                arguments: { type: "object" },
                arguments_json: {
                    type: "string",
                    description: "原工具参数的完整 JSON 字符串；含数组或多层对象时使用，不能同时传 arguments。",
                },
            },
        };
        const validateOperation = ajv.compile(operationParameters);
        own(scope.tools.register({
            name: "test_execute_operation",
            description: "保存当前一个业务工具调用的说明，再经同一Agent原生管线执行；purpose区分action、observe、cleanup。常规点击、输入、提交必须分别选对应动作工具，不得用脚本合并；脚本只用于原子工具无法表达的复合操作并需复核。不接受成功声明或断言实际值。",
            parameters: operationParameters,
            output: {
                schema: {
                    type: "object",
                    required: ["content"],
                    properties: { content: { type: "array" } },
                },
                render: (_, value) => value
                    .content,
            },
            execute: async (args, exec) => {
                if (!validateOperation(args))
                    throw new Error("操作参数无效：" +
                        ajv.errorsText(validateOperation.errors) +
                        `。请提供description、目录中的完整tool_name（例如${this.toolCatalog.names()[0] ?? "已注册工具名"}），并选择arguments对象或arguments_json字符串。`);
                const input = args;
                const toolArguments = nativeOperationArguments(input);
                this.requireSettled(exec);
                if (this.releaseStep())
                    throw new Error("当前只允许释放浏览器，请调用test_capture({})");
                if (!this.current?.step.action ||
                    !["browser", "tool"].includes(this.current.step.action.capability))
                    throw new Error("当前步骤未开放业务工具操作范围");
                if (!input.description.trim())
                    throw new Error("请说明当前操作的对象与动作");
                this.assertTool(input.tool_name);
                if (input.purpose === "cleanup" && this.current.phase !== "cleanup")
                    throw new Error("收尾工具仅在当前清理阶段执行");
                if (this.current.phase === "cleanup" && input.purpose === "observe")
                    throw new Error("清理阶段请明确使用cleanup用途");
                const capture = this.prepareOperationObservations(input, toolArguments);
                const response = await this.call(input.tool_name, toolArguments, exec, {
                    description: input.description.trim(),
                    description_source: "model",
                    purpose: this.current.phase === "cleanup"
                        ? "cleanup"
                        : (input.purpose ?? "action"),
                });
                if (capture && !toolResultError(response.result)) {
                    const c = this.current;
                    await captureStep({
                        id: this.id,
                        browser: this.browser,
                        assertTool: (name) => this.assertTool(name),
                        call: async () => response,
                    }, this.recorder, this.run, { ...c.step, action: { ...c.step.action, capture } }, c.result, c.binding, exec);
                    this.save();
                }
                if (toolResultError(response.result))
                    this.delegatedFailures.set(exec.callId, response.result);
                else {
                    for (const context of response.result.additionalContexts ?? [])
                        exec.deferContext(context);
                    if (response.result.concludesTurn)
                        exec.concludeTurn();
                }
                return {
                    tool_call_id: response.callId,
                    content: response.result.content,
                    ...(!response.result.isError
                        ? { result: response.result.value }
                        : {}),
                };
            },
        }));
        tool("test_define_step", "仅在执行当前文字步骤时确定能力与目标；观察页面后直接test_capture，输出由采集方式自动登记。", {
            type: "object",
            required: ["capability", "allowed_targets", "reason"],
            additionalProperties: false,
            properties: {
                capability: actionSchema.properties.capability,
                allowed_targets: actionSchema.properties.allowed_targets,
                reason: { type: "string", minLength: 1 },
            },
        }, async (args, exec) => {
            this.requireSettled(exec);
            const c = this.current;
            if (!c || c.phase !== "test" || c.step.checks === undefined)
                throw new Error("仅当前文字步骤可以在运行时定义，不能修改JSON计划或未来步骤");
            if (c.result.observations.length ||
                c.instance.effective_steps.some((s) => s.step_id.startsWith(c.step.step_id + "_check_") && s.assertion))
                throw new Error("本步已有观察或断言，不能重写定义");
            const step = {
                ...c.step,
                kind: "action",
                action: {
                    goal: c.step.description,
                    capability: args.capability,
                    allowed_targets: args.allowed_targets,
                    inputs: {},
                    outputs: {},
                    completion_requirements: [],
                    capture_mode: "runtime",
                },
            };
            const effective = c.instance.effective_steps.map((s) => s.step_id === step.step_id ? step : s);
            this.validateEffective(c.instance, effective);
            c.step = step;
            c.instance.effective_steps = effective;
            this.recorder.event("step_defined", { step, reason: args.reason }, c.binding);
            if (["tool", "browser"].includes(args.capability) &&
                this.resourceConfig &&
                !c.instance.resources.tool_context) {
                this.scheduleToolCleanup(c.instance);
                this.resourcePhase = "start";
                try {
                    const response = await this.call(this.resourceConfig.start.tool_name, toolArguments(this.resourceConfig.start), exec);
                    if (response.result.isError)
                        throw new Error("工具资源初始化未获确认");
                }
                catch (error) {
                    this.finishStep("ERROR", String(error));
                    this.advance();
                    throw error;
                }
                finally {
                    this.resourcePhase = undefined;
                }
            }
            this.save();
            return this.state();
        });
        tool("test_bind_check", "把当前步骤的一个文字检查点绑定为程序断言；预期来自已批准文字，实际值只能引用可信观察，绑定后不能改判。", {
            type: "object",
            required: ["check_index", "assertion"],
            additionalProperties: false,
            properties: {
                check_index: { type: "integer", minimum: 0 },
                assertion: {
                    type: "object",
                    required: ["observation_ref", "operator"],
                    additionalProperties: false,
                    properties: {
                        observation_ref: {
                            ...assertionSchema.properties.observation_ref,
                            description: "点分隔的可信观察路径，例如step_1.response.status、step_1.response.body.0.iid；数组长度用step_1.response.body.length，标签数量用step_1.response.body.0.labels.length。数组索引用数字路径段，不使用[0]语法。",
                        },
                        operator: assertionSchema.properties.operator,
                        expected_value: {
                            type: "string",
                            description: '用户预期原文。例如agent、dsh、0或200；不加JSON引号、不包数组或value对象。正文/文本不为空用neq及expected_value:""（空字符串）。数字/布尔按检查和观察类型解析；仅对象、数组或range预期写JSON。与expected_observation_ref二选一',
                        },
                        expected_observation_ref: assertionSchema.properties.expected_observation_ref,
                        unit: {
                            ...assertionSchema.properties.unit,
                            description: "仅表示展示单位，不执行取长度、计数或其他转换；数组长度必须在 observation_ref 引用 .length。",
                        },
                        tolerance: assertionSchema.properties.tolerance,
                    },
                },
            },
        }, (args, exec) => {
            this.requireSettled(exec);
            const c = this.current;
            const text = c?.step.checks?.[args.check_index];
            if (!c || c.phase !== "test" || !text)
                throw new Error("当前步骤没有此文字检查点");
            const id = `${c.step.step_id}_check_${args.check_index + 1}`;
            if (c.instance.effective_steps.some((s) => s.step_id === id))
                throw new Error("检查点已经绑定，不能改写预期");
            const { expected_value, ...definition } = args.assertion;
            if ([
                definition.observation_ref,
                definition.expected_observation_ref,
            ].some((ref) => typeof ref === "string" && /\[\d+\]/.test(ref)))
                throw new Error("观察引用使用点分隔路径，数组索引用数字路径段，例如step_1.response.body.0.iid；不能使用body[0]。修正字段引用，不修改用户预期。");
            const [producer, outputName, ...path] = String(definition.observation_ref).split(".");
            const observation = c.instance.steps
                .find((s) => s.step_id === producer)
                ?.observations.find((o) => o.output_name === outputName);
            if (!observation)
                throw new Error("请先采集可信观察，再绑定文字检查");
            const actual = field(observation.value, path.join("."));
            const step = {
                step_id: id,
                kind: "assertion",
                description: text,
                required: true,
                depends_on: [c.step.step_id],
                assertion: {
                    ...definition,
                    ...(expected_value === undefined
                        ? {}
                        : {
                            literal: parseTextExpected(text, expected_value, actual, definition.operator),
                        }),
                    rule_ref: id,
                },
            };
            validateTextExpectation(text, step.assertion);
            const effective = [...c.instance.effective_steps];
            const position = effective.findIndex((s) => s.step_id === c.step.step_id);
            const earlierIds = c.step
                .checks.slice(0, args.check_index)
                .map((_, n) => `${c.step.step_id}_check_${n + 1}`);
            const preceding = effective.filter((s) => earlierIds.includes(s.step_id)).length;
            effective.splice(position + 1 + preceding, 0, step);
            this.validateEffective(c.instance, effective);
            c.instance.effective_steps = effective;
            this.entries.splice(this.cursor + preceding, 0, {
                instance: c.instance,
                phase: "test",
                step,
            });
            this.recorder.event("check_bound", { step, check_index: args.check_index }, c.binding);
            this.save();
            return this.state();
        });
        tool("test_capture", "执行可信采集。capture必须是{输出名:{kind,tool_name,arguments,extract}}字典，不能把kind/tool_name放在capture顶层。运行时还需reason；固定计划和清理调用test_capture({})，沿用既有定义。", {
            type: "object",
            properties: {
                capture: captureSchema,
                reason: { type: "string", minLength: 1 },
            },
            additionalProperties: false,
        }, async (args, exec) => {
            const c = this.current;
            if (!c?.step.action)
                throw new Error("没有当前采集步骤");
            this.requireSettled(exec);
            let action = c.step.action;
            let captures = action.capture ?? {};
            if (action.capture_mode === "runtime") {
                if (typeof args.capture?.kind === "string")
                    throw new Error('capture需要按输出名组织，例如{counter:{kind:"tool",tool_name:"实际读取工具名",arguments:{},extract:{from:"structured",pointer:"/text",type:"number"}}}，并提供reason；不能把kind/tool_name直接放在capture顶层。');
                if (!args.capture ||
                    !Object.keys(args.capture).length ||
                    !args.reason?.trim())
                    throw new Error("请根据当前页面提供capture及reason；不要提交实际值");
                this.lockToolCaptures(args.capture, false);
                if (c.step.checks !== undefined) {
                    const outputs = { ...action.outputs };
                    for (const [name, value] of Object.entries(args.capture)) {
                        if (c.result.observations.some((o) => o.output_name === name))
                            continue;
                        outputs[name] =
                            value.kind === "dom"
                                ? {
                                    type: ["number", "count"].includes(value.mode ?? "")
                                        ? "number"
                                        : value.mode === "visible"
                                            ? "boolean"
                                            : "string",
                                }
                                : value.kind === "tool" && value.extract?.type
                                    ? { type: value.extract.type }
                                    : value.kind === "http" && !value.field
                                        ? { type: "object" }
                                        : {};
                    }
                    const nextAction = {
                        ...action,
                        outputs,
                        completion_requirements: Object.keys(outputs),
                    };
                    validateCaptures(nextAction, args.capture);
                    const step = { ...c.step, action: nextAction };
                    const effective = c.instance.effective_steps.map((s) => s.step_id === c.step.step_id ? step : s);
                    this.validateEffective(c.instance, effective);
                    c.step = step;
                    c.instance.effective_steps = effective;
                    action = nextAction;
                    this.recorder.event("step_defined", { step, reason: "依据当前采集方式登记输出：" + args.reason }, c.binding);
                }
                validateCaptures(action, args.capture);
                for (const name of Object.keys(args.capture))
                    if (c.result.observations.some((o) => o.output_name === name))
                        throw new Error("已有可信观察不能覆盖: " + name + "；只补采缺少的输出");
                captures = structuredClone(args.capture);
            }
            else if (args.capture && Object.keys(args.capture).length) {
                throw new Error("该步骤使用固定采集定义，调用test_capture({})，不要提供非空capture覆盖定义");
            }
            if (!Object.keys(captures).some((name) => !c.result.observations.some((o) => o.output_name === name)))
                throw new Error("本步骤已有观察，不能覆盖");
            this.lockToolCaptures(captures);
            const attempt = {
                capture: captures,
                reason: args.reason ?? "使用计划中的固定采集定义",
                started_at: new Date().toISOString(),
            };
            (c.result.capture_attempts ??= []).push(attempt);
            this.recorder.event("capture_configured", attempt, c.binding);
            this.save();
            try {
                await captureStep(this.captureHost(), this.recorder, this.run, { ...c.step, action: { ...action, capture: captures } }, c.result, c.binding, exec);
            }
            catch (error) {
                attempt.error = String(error);
                this.recorder.event("capture_failed", { error: attempt.error }, c.binding);
                throw error;
            }
            finally {
                this.save();
            }
            return {
                observations: c.result.observations.map((o) => ({
                    name: o.output_name,
                    value: o.value,
                })),
                missing: action.completion_requirements.filter((name) => !c.result.observations.some((o) => o.output_name === name)),
                next: "如有缺少输出，按实际页面修正后只补采缺少输出；完整后test_finish_step",
            };
        });
        tool("test_finish_step", "必要观察完整后结算本步骤并计算后续断言，返回下一动作。", empty, async (_, exec) => {
            const c = this.current;
            if (!c)
                throw new Error("没有当前步骤");
            this.requireSettled(exec);
            const media = this.media.state();
            const mediaKey = c.instance.case_run_id + "/" + media.source + "/" + media.generation;
            if (this.mediaEnabled &&
                media.context_call_id &&
                media.mode === "waiting" &&
                !this.owner.preview.summary(this.run.suite_run_id).ready &&
                !this.mediaPrompted.has(mediaKey) &&
                c.phase !== "cleanup") {
                this.mediaPrompted.add(mediaKey);
                throw new Error("请先根据当前真实工具尝试test_connect_preview；缺少可核对的画面能力时用unavailable_reason如实记录，再继续结算业务步骤。");
            }
            const pending = (c.step.checks ?? []).filter((_, n) => !c.instance.effective_steps.some((s) => s.step_id === `${c.step.step_id}_check_${n + 1}` && s.assertion));
            if (pending.length)
                throw new Error("尚未绑定文字检查点: " + pending.join("；"));
            if (!c.step.action && !c.step.checks?.length)
                throw new Error("请先根据当前情况配置并完成本步骤");
            if (!(c.step.action?.completion_requirements ?? []).every((n) => c.result.observations.some((o) => o.output_name === n)))
                throw new Error("缺少必要观察；先完成动作并调用test_capture");
            if (c.step.action &&
                !c.step.action.completion_requirements.length &&
                !c.step.checks?.length &&
                !c.result.calls.some((call) => businessTool(call.name) &&
                    call.finished_at &&
                    !call.isError &&
                    !call.name.endsWith("browser_close")))
                throw new Error("尚无本步骤实际动作或可信观察，不能只配置后宣布完成");
            this.finishStep("SUCCEEDED");
            this.save();
            await this.owner.preview.drain(this.run.suite_run_id);
            if (this.closed)
                throw new Error("测试已封存，录像结算不再推进步骤");
            this.advance();
            return this.state();
        });
        tool("test_fail_step", "当前动作无法完成时记录真实错误并进入后续可用步骤或清理，不伪造观察。", {
            type: "object",
            required: ["reason"],
            properties: { reason: { type: "string" } },
            additionalProperties: false,
        }, (args, exec) => {
            this.requireSettled(exec);
            if (!this.current)
                throw new Error("没有当前步骤");
            this.finishStep("ERROR", args.reason);
            this.advance();
            return this.state();
        });
        tool("test_finish", "全部步骤及清理完成后生成静态报告，返回最终回复应使用的链接与保存位置。", empty, async (_, exec) => {
            this.requireSettled(exec);
            if (this.current || this.cursor < this.entries.length || !this.planned)
                throw new Error("测试尚未完成，请按test_current继续");
            await this.owner.preview.finishRun(this.run);
            if (this.closed)
                throw new Error("测试已封存，不能更改结果");
            return this.finish();
        });
        tool("test_api_get", "内部HTTP GET采集工具，仅供test_capture子调用；模型直接使用test_capture发送请求并保存可信响应。", {
            type: "object",
            required: ["url"],
            properties: { url: { type: "string" } },
            additionalProperties: false,
        }, async (args, exec) => {
            const response = await fetch(args.url, {
                signal: exec.signal,
                redirect: "error",
            });
            return { status: response.status, body: await response.json() };
        });
        tool("test_propose_checkpoint", "追加具有现有冻结规则来源的必需断言，不能修改已有预期。", {
            type: "object",
            required: [
                "reason",
                "source_refs",
                "added_steps",
                "target_instance_ids",
                "insertion_boundary",
                "post_hoc",
            ],
            properties: {
                reason: { type: "string" },
                source_refs: { type: "array", items: { type: "object" } },
                added_steps: { type: "array", items: { type: "object" } },
                target_instance_ids: { type: "array", items: { type: "string" } },
                insertion_boundary: { type: "string" },
                post_hoc: { type: "boolean" },
            },
        }, (args) => {
            // 先验证运行边界，再提交不可回滚的修订事件。
            const positions = new Map();
            for (const id of args.target_instance_ids ?? []) {
                const position = this.entries.findIndex((e, index) => index >= this.cursor &&
                    e.instance.case_run_id === id &&
                    (args.insertion_boundary === "end"
                        ? e.phase === "cleanup"
                        : e.step.step_id === args.insertion_boundary));
                if (position < 0)
                    throw new Error("插入边界已执行或不存在");
                positions.set(id, position);
            }
            const revision = applyRevision(this.run, this.recorder, args, this.owner.config.maxRevisions);
            for (const [id, position] of [...positions].sort((a, b) => b[1] - a[1])) {
                const instance = this.run.instances.find((i) => i.case_run_id === id);
                this.entries.splice(position, 0, ...revision.added_steps.map((step) => ({
                    instance,
                    step,
                    phase: "test",
                })));
            }
            this.save();
            return { accepted: true, revision: revision.revision };
        });
        own(scope.on("session/event", (session, event) => {
            if (session.id !== this.id || this.closed)
                return;
            // 仅观察官方事件；不写入或重写宿主会话日志。
            this.recorder.event("native_session_event", {
                session_id: this.id,
                type: event.type,
            });
            if (event.type === "assistant/message" && this.announcement) {
                this.announcement.text += event.data.message.content
                    .filter((block) => block.type === "text")
                    .map((block) => block.text)
                    .join("\n");
                if (!this.missingAnnouncement().length) {
                    this.announcement = undefined;
                    this.recorder.event("plan_announced", { session_id: this.id });
                }
            }
            if (event.type === "tool/call") {
                try {
                    this.bind(event.data.callId, event.data.name, JSON.parse(event.data.arguments || "{}"));
                }
                catch {
                    /* 原生工具管线处理无效参数。 */
                }
            }
            if (event.type === "user/message" &&
                event.data.source.kind === "user" &&
                !this.planned) {
                const text = event.data.content
                    .filter((b) => b.type === "text")
                    .map((b) => b.text)
                    .join("\n");
                if (!this.review && this.planningQuestion)
                    this.timer = setTimeout(() => this.stop("规划执行超时"), this.owner.config.stepTimeoutMs);
                if (text !== this.task)
                    this.task += "\n" + text;
                this.planningQuestion = false;
            }
            if (event.type === "turn/end")
                void this.turnEnded(event.data.reason.kind === "aborted").catch((error) => this.emergency(error));
        }));
        own(scope.on("tools/pre-execute", async (exec, next) => {
            if (exec.agent?.id !== this.id)
                return next();
            this.pendingTools.add(exec.callId);
            this.bind(exec.callId, exec.name, exec.arguments);
            const decision = await next();
            if (decision.kind === "allow" &&
                this.current?.step.action?.approval &&
                !exec.name.startsWith("test_"))
                return { kind: "ask", reason: "当前冻结步骤需要审批" };
            return decision;
        }));
        own(scope.on("tools/execute", async (exec, next) => {
            if (exec.agent?.id === this.id) {
                this.dispatchedCalls.add(exec.callId);
                if (!this.planned && exec.name === "ask_user_question")
                    this.planningQuestion = true;
                if (this.review && !this.planned && exec.name === "exit_plan_mode")
                    this.reviewCall = exec.callId;
                const call = this.calls.get(exec.callId);
                if (call)
                    this.recorder.event("tool_dispatched", { call_id: exec.callId, name: exec.name }, call.binding);
                const operation = this.operations.get(exec.callId);
                if (operation &&
                    !operation.dispatch_observed &&
                    operation.state === "REGISTERED") {
                    operation.dispatch_observed = true;
                    operation.dispatched_at = new Date().toISOString();
                    operation.state = "DISPATCHED";
                    this.recorder.event("operation_dispatched", operation, operation.binding, "operation-dispatched:" + exec.callId);
                    this.save();
                }
            }
            const result = await next();
            if (exec.agent?.id === this.id &&
                !this.planned &&
                exec.name === "ask_user_question" &&
                result.isError)
                this.planningQuestion = false;
            // 公开SDK允许around-dispatch返回规范失败；保留子调用的错误、内容和上下文。
            // 不能将子调用失败仅放进成功JSON，也不能覆盖外层管线自身的失败。
            return exec.name === "test_execute_operation" && !result.isError
                ? (this.delegatedFailures.get(exec.callId) ?? result)
                : result;
        }));
        own(scope.on("tools/result", (exec, result) => {
            if (exec.agent?.id !== this.id)
                return;
            this.pendingTools.delete(exec.callId);
            this.settle(exec.callId, result, exec.signal.aborted);
            this.delegatedFailures.delete(exec.callId);
            if (exec.callId === this.reviewCall) {
                this.reviewCall = undefined;
                const approved = !result.isError &&
                    result.value?.approved === true;
                this.reviewDismissed = !approved;
                if (approved && !this.cancelled && !this.closed && this.draft) {
                    this.recorder.event("plan_approved", { call_id: exec.callId });
                    this.freeze(this.draft);
                }
            }
        }));
        own(scope.tools.guard((exec) => {
            if (exec.agent?.id === this.id &&
                exec.name === "test_preview_poll" &&
                !this.previewPolls.has(exec.callId))
                return "画面轮询仅允许宿主调度";
            if (this.closed || this.reportReady)
                return;
            if (this.finishing && exec.agent?.id === this.id)
                return "正在等待本批 Node 使用权收尾，暂不派发新工具";
            if (this.recorder.failed)
                return "测试账本写入失败，停止工具派发";
            if (this.cancelled && !this.cleanupTurn)
                return "停止后禁止新业务动作，等待在途结算";
            if (exec.agent?.id !== this.id)
                return;
            if (this.current?.step.step_id === "__resource_open" &&
                ![
                    "test_capture",
                    "test_current",
                    "test_finish_step",
                    "test_fail_step",
                    "test_finish",
                ].includes(exec.name) &&
                !(this.isTrusted(exec) &&
                    exec.name === this.resourceConfig?.start.tool_name))
                return "初始化只允许执行本轮已配置的资源创建工具";
            if (this.connectionReady &&
                this.browser &&
                exec.name.startsWith(this.browser.prefix) &&
                !["browser", "tool"].includes(this.current?.step.action?.capability ?? ""))
                return "当前步骤不是浏览器步骤，不允许远程工具或领取 Node";
            if (this.connectionReady &&
                this.browser &&
                this.current?.step.action?.capture &&
                Object.values(this.current.step.action.capture).every((item) => item.kind === "browser_open") &&
                ![
                    "test_capture",
                    "test_current",
                    "test_finish_step",
                    "test_fail_step",
                    "test_finish",
                ].includes(exec.name) &&
                !(exec.name === this.browser.prefix + "browser_start" &&
                    this.isTrusted(exec)))
                return "初始化阶段只允许test_capture申请并核对本次远程浏览器";
            if (this.connectionReady &&
                this.browser &&
                ["browser_start", "browser_stop", "browser_capture"].some((name) => exec.name === this.browser.prefix + name) &&
                !this.isTrusted(exec))
                return "远程生命周期和可信采集由test_capture控制";
            if (this.releaseStep() && !this.releaseAllowed(exec))
                return "当前只允许释放浏览器，请调用test_capture({})，取得释放证据后test_finish_step";
            if ((this.cleanupTurn || this.current?.phase === "cleanup") &&
                !this.cleanupAllowed(exec))
                return "收尾轮次仅允许当前冻结清理步骤的预授权工具";
            if (!exec.parent &&
                this.pendingTools.size &&
                !this.pendingTools.has(exec.callId))
                return "测试增强按步骤串行；请等待在途工具结算后重试";
            if (!this.planned &&
                ![
                    "test_submit_plan",
                    "test_current",
                    "todo_write",
                    "ask_user_question",
                    ...(this.review ? ["exit_plan_mode"] : []),
                ].includes(exec.name))
                return "规划阶段禁止执行：请仅根据用户描述提交业务计划，运行后再识别页面并调整操作";
            if (this.announcement &&
                !this.cancelled &&
                !["test_current", "ask_user_question", "todo_write"].includes(exec.name))
                return ("执行前请先补齐正常对话中的通报内容（无需用户确认）。缺少：" +
                    JSON.stringify(this.missingAnnouncement()) +
                    "\n完整计划如下：\n" +
                    this.announcement.summary);
            if (this.review && !this.planned && exec.name === "exit_plan_mode") {
                if (!this.draft)
                    return "请先test_submit_plan保存待审核草案";
                if (exec.arguments.plan !== this.reviewMarkdown())
                    return "审核内容必须与草案一致；请将test_current返回的review_markdown原样传给exit_plan_mode";
            }
            if (this.current?.step.kind === "intent" &&
                ![
                    "test_define_step",
                    "test_bind_check",
                    "test_current",
                    "test_finish_step",
                    "test_fail_step",
                    "ask_user_question",
                    "todo_write",
                ].includes(exec.name))
                return "请在当前步骤调用test_define_step确定操作目标；不需要提前定义未来步骤";
            if (this.planned && exec.name === "test_api_get" && !exec.parent)
                return "HTTP请求由test_capture发送并记录，请勿预先直接请求；用一个response对象观察供多个断言引用";
            if (this.planned &&
                exec.name === "test_api_get" &&
                !this.isTrusted(exec))
                return "HTTP请求仅由test_capture的受信子调用发送";
            if (this.planned && businessTool(exec.name) && !this.isTrusted(exec))
                return "请通过test_execute_operation附说明，或通过test_capture读取真实结果";
            if (this.planned &&
                !this.resourcePhase &&
                !this.current?.step.step_id.startsWith("__resource_") &&
                typeof exec.arguments?.url === "string") {
                const url = exec.arguments.url;
                if (url !== "about:blank" &&
                    !this.current?.step.action?.allowed_targets.some((t) => new URL(t).origin === new URL(url).origin))
                    return "目标不在当前冻结步骤范围内";
            }
        }));
        own(scope.on("agent/turn-stopping", ({ agent }) => {
            if (agent.id !== this.id ||
                this.closed ||
                this.reportReady ||
                (this.cancelled && !this.cleanupTurn))
                return;
            if (!this.planned) {
                if (this.review && !this.reviewDismissed && this.nudges++ < 2)
                    agent.steer(notice("本次/test-plan必须通过原生审核卡片确认。请先test_submit_plan保存草案，再将review_markdown原样交给exit_plan_mode；不要只输出文字计划或等待口头同意。这些工具只记录计划和审核，不执行业务。缺少必要信息时正常追问。"));
                return;
            }
            if (this.nudges++ < 2)
                agent.steer(notice("测试尚未结算。请按test_current继续；无法完成调用test_fail_step，完成后调用test_finish并给出报告链接。"));
        }));
        own(this.owner.ctx.effect(() => () => {
            if (!this.closed)
                return this.shutdown();
        }));
    }
    missingAnnouncement() {
        if (!this.announcement)
            return [];
        const compact = (text) => text.replace(/[\s#*>`_]/g, "");
        return this.announcement.required.filter((part) => !compact(this.announcement.text).includes(compact(part)));
    }
    outputLanguage() {
        return testLanguage(this.owner.ctx, this.task + "\n" + (this.input?.instances[0]?.task ?? ""));
    }
    async start(task) {
        if (this.input)
            this.recorder.json("input.json", this.input);
        this.save();
        if (!this.planned)
            this.timer = setTimeout(() => this.stop("规划执行超时"), this.owner.config.stepTimeoutMs);
        this.agent.followup(createUserMessage({
            source: { kind: "user" },
            content: [{ type: "text", text: task }],
        }));
        return this.review
            ? "已在当前对话进入plan模式；先规划并展示审核，用户同意后才执行测试。"
            : "测试已在当前对话启动；执行步骤、工具结果和最终报告将在本对话中显示。";
    }
    submit(input, trustedFile = false) {
        if (this.planned)
            throw new Error("计划已冻结；不能替换预期");
        const plan = trustedFile
            ? parsePlan(input)
            : this.input
                ? parseBatchPlan(input, this.input, this.task, this.id, this.outputLanguage(), this.originalTask)
                : parseTextPlan(input, this.task, this.id, this.originalTask, this.outputLanguage());
        if (this.timer)
            clearTimeout(this.timer);
        if (this.review) {
            this.draft = plan;
            this.reviewDismissed = false;
            this.recorder.event("plan_drafted", { plan });
            this.recorder.json("plan-draft.json", plan);
            this.save();
            return this.state();
        }
        this.freeze(plan);
        const summary = textReview(plan, false, this.outputLanguage());
        if (!trustedFile) {
            this.announcement = {
                summary,
                text: "",
                required: announcementParts(plan, this.outputLanguage()),
            };
        }
        return {
            ...this.state(),
            plan_summary: summary,
        };
    }
    validateEffective(instance, steps) {
        const original = this.run.plan.cases.find((c) => c.case_id === instance.case_id);
        parsePlan({ ...this.run.plan, cases: [{ ...original, steps }] }, true);
    }
    reviewMarkdown() {
        if (!this.draft)
            return "";
        return textReview(this.draft, true, this.outputLanguage());
    }
    freeze(plan) {
        if (this.timer)
            clearTimeout(this.timer);
        this.planned = true;
        this.nudges = 0;
        this.run.name = plan.name;
        this.run.plan = plan;
        this.run.instances = expand(plan);
        this.recorder.protect(plan);
        this.recorder.json("plan.json", plan);
        for (const instance of this.run.instances) {
            instance.session_id = this.id;
            instance.cleanup_session_id = this.id;
            const c = plan.cases.find((c) => c.case_id === instance.case_id);
            const toolResource = this.resourceConfig &&
                [...c.preconditions, ...c.steps, ...c.cleanup].some((s) => ["browser", "tool"].includes(s.action?.capability ?? ""));
            if (toolResource)
                this.entries.push({
                    instance,
                    phase: "setup",
                    step: toolResourceStep(this.resourceConfig),
                });
            this.entries.push(...c.preconditions.map((step) => ({
                instance,
                step,
                phase: "setup",
            })), ...instance.effective_steps.map((step) => ({
                instance,
                step,
                phase: "test",
            })), ...c.cleanup.map((step) => ({
                instance,
                step,
                phase: "cleanup",
            })));
            if (toolResource)
                this.scheduleToolCleanup(instance);
        }
        this.owner.reports.select(this.run, "report.html", false);
        this.advance();
        return this.state();
    }
    advance() {
        this.current = undefined;
        while (this.cursor < this.entries.length) {
            const e = this.entries[this.cursor++];
            if (this.selectedInstance !== e.instance.case_run_id) {
                this.media.nextCase();
                this.selectedInstance = e.instance.case_run_id;
                this.selectedTool = undefined;
            }
            if (e.phase === "cleanup")
                this.media.stop();
            e.instance.lifecycle = "RUNNING";
            e.instance.status = "RUNNING";
            const result = {
                step_id: e.step.step_id,
                phase: e.phase,
                description: e.step.description,
                required: e.step.required,
                status: "RUNNING",
                started_at: new Date().toISOString(),
                duration_ms: 0,
                calls: [],
                observations: [],
                ...(e.phase === "cleanup" ? { cleanup_applicable: true } : {}),
            };
            const binding = {
                suite_run_id: this.run.suite_run_id,
                case_run_id: e.instance.case_run_id,
                phase: e.phase,
                step_id: e.step.step_id,
                attempt_id: "1",
            };
            e.instance.steps.push(result);
            this.current = { ...e, result, binding };
            this.recorder.event("step_started", { step: e.step }, binding);
            if (e.phase === "cleanup" &&
                e.step.run_if === "resource_exists" &&
                !["exists", "unknown"].includes(e.instance.resources[e.step.resource_ref]?.state ?? "absent")) {
                result.cleanup_applicable = false;
                this.finishStep("SKIPPED", "资源不存在，无需清理");
                continue;
            }
            if (this.cancelled && e.phase !== "cleanup") {
                e.instance.cancelled = true;
                this.finishStep("SKIPPED", "用户停止");
                continue;
            }
            if (e.phase !== "cleanup" &&
                (e.instance.steps.some((s) => s.required &&
                    s.phase !== "cleanup" &&
                    ["FAIL", "ERROR", "INCONCLUSIVE", "BLOCKED"].includes(s.status)) ||
                    e.step.depends_on.some((id) => !e.instance.steps.some((s) => s.step_id === id && ["SUCCEEDED", "PASS"].includes(s.status))))) {
                e.instance.blocked = true;
                this.finishStep("BLOCKED", "依赖未满足");
                continue;
            }
            if (e.step.assertion) {
                result.assertion = evaluate(e.step, e.instance);
                this.recorder.event("assertion_evaluated", result.assertion, binding);
                this.finishStep(result.assertion.status);
                continue;
            }
            this.mediaDeadline =
                e.phase === "cleanup"
                    ? Date.now() + this.owner.config.cleanupTimeoutMs
                    : undefined;
            this.timer = setTimeout(() => {
                this.recorder.event("step_timeout", {}, binding);
                e.instance.incomplete = true;
                e.instance.issues.push("步骤执行超时");
                this.stop("步骤执行超时");
            }, e.phase === "cleanup"
                ? this.owner.config.cleanupTimeoutMs
                : this.owner.config.stepTimeoutMs);
            break;
        }
        this.save();
    }
    finishStep(status, reason) {
        if (!this.current)
            return;
        if (this.timer)
            clearTimeout(this.timer);
        const c = this.current;
        c.result.status = status;
        if (c.phase === "cleanup" &&
            status === "SUCCEEDED" &&
            Object.values(c.step.action?.capture ?? {}).some((x) => x.kind === "browser_close")) {
            if (c.instance.resources.browser_context)
                c.instance.resources.browser_context.state = "absent";
        }
        if (reason)
            c.result.reason = reason;
        c.result.finished_at = new Date().toISOString();
        c.result.duration_ms = Date.now() - Date.parse(c.result.started_at);
        this.recorder.event("step_finished", c.result, c.binding);
        this.current = undefined;
        if (c.phase === "cleanup" &&
            this.releaseStep(c.step) &&
            !["SUCCEEDED", "SKIPPED"].includes(status) &&
            !this.cancelled) {
            this.owner.quarantine(this.run, "浏览器释放失败，禁止后续业务");
            c.instance.incomplete = true;
            this.stop("浏览器释放失败，禁止后续业务");
        }
    }
    publicLease() {
        if (!this.run.node_lease)
            return undefined;
        const { access_file: _privateFile, ...lease } = this.run.node_lease;
        return lease;
    }
    state() {
        const c = this.current;
        return {
            run_id: this.run.suite_run_id,
            session_id: this.id,
            ...(this.run.node_lease ? { node_lease: this.publicLease() } : {}),
            ...(this.captureBrowser
                ? {
                    browser_backend: "runbridge",
                    ...(this.captureBrowser.resource?.remote
                        ? {
                            remote_browser: Object.fromEntries(Object.entries(this.captureBrowser.resource.remote).filter(([key]) => key !== "access_file")),
                        }
                        : {}),
                }
                : {}),
            ...(!this.planned && this.input ? { planning_input: this.input } : {}),
            media: this.mediaState(),
            phase: this.reportReady
                ? "finished"
                : this.finishing
                    ? "cleanup"
                    : this.planned
                        ? this.cleanupTurn || c?.phase === "cleanup"
                            ? "cleanup"
                            : "executing"
                        : this.draft
                            ? "reviewing"
                            : "planning",
            ...(this.review && !this.planned && this.draft
                ? { review_markdown: this.reviewMarkdown() }
                : {}),
            ...(this.announcement
                ? {
                    plan_summary: this.announcement.summary,
                    announcement_required: "先在正常对话完整输出plan_summary，再调用执行工具；无需用户确认",
                }
                : {}),
            current: c
                ? {
                    instance: c.instance.case_run_id,
                    step: c.step,
                    checks: (c.step.checks ?? []).map((text, n) => ({
                        check_index: n,
                        text,
                        bound: c.instance.effective_steps.some((s) => s.step_id === `${c.step.step_id}_check_${n + 1}` &&
                            s.assertion),
                    })),
                    observations: c.instance.steps.flatMap((s) => s.observations.map((o) => ({
                        ref: `${s.step_id}.${o.output_name}`,
                        value: o.value,
                    }))),
                    inputs: Object.fromEntries(Object.entries(c.step.action?.inputs ?? {}).map(([key, value]) => [
                        key,
                        value &&
                            typeof value === "object" &&
                            !Array.isArray(value) &&
                            typeof value.input_ref === "string"
                            ? field({ data: c.instance.data }, value.input_ref)
                            : value,
                    ])),
                    phase: c.phase,
                }
                : null,
            assertions: this.run.instances.flatMap((i) => i.steps.filter((s) => s.assertion).map((s) => s.assertion)),
            next: !this.planned
                ? this.draft
                    ? "将review_markdown原样传入exit_plan_mode的plan参数，由原生审核等待用户批准；修改时重新test_submit_plan"
                    : "理解任务并提交test_submit_plan；信息不足时正常追问"
                : c
                    ? c.step.step_id === "__resource_open"
                        ? "当前执行已配置的资源初始化：test_capture({})，确认原资源后test_finish_step"
                        : this.releaseStep()
                            ? "当前进入浏览器释放阶段：test_capture({})取得释放证据后test_finish_step；已完成检查保持冻结，随后按test_current进入下一实例或生成报告"
                            : c.phase === "cleanup"
                                ? "只完成当前冻结清理步骤及可信采集，再test_finish_step；已完成业务及检查保持冻结"
                                : c.step.checks !== undefined
                                    ? "只执行当前文字步骤：test_define_step确定本步目标，观察操作后test_capture；逐项test_bind_check，最后test_finish_step"
                                    : "完成当前动作、test_capture、test_finish_step"
                    : "调用test_finish生成报告并在回复中给出链接",
        };
    }
    presentation() {
        const phase = this.finishing || this.cleanupTurn || this.current?.phase === "cleanup"
            ? "cleanup"
            : this.cancelled
                ? "stopping"
                : this.planned
                    ? "executing"
                    : this.draft
                        ? "reviewing"
                        : "planning";
        return this.recorder.sanitize(projectProgress({
            run: this.run,
            plan: this.draft ?? this.run.plan,
            phase,
            ...(this.current
                ? {
                    current: {
                        case_run_id: this.current.instance.case_run_id,
                        step_id: this.current.step.step_id,
                    },
                }
                : {}),
            reportUrl: this.owner.reports.url(this.run.suite_run_id),
        }));
    }
    bind(id, name, args) {
        if (!this.current || this.calls.has(id) || this.reportReady)
            return;
        const call = {
            call_id: id,
            binding: { ...this.current.binding },
            name,
            args_redacted: this.recorder.sanitize(args),
            started_at: new Date().toISOString(),
            body_started: "unknown",
        };
        this.calls.set(id, call);
        if (!this.mediaCalls.has(id))
            this.current.result.calls.push(call);
        this.recorder.event(this.mediaCalls.has(id) ? "media_tool_bound" : "tool_bound", call, call.binding, "bound:" + id);
    }
    isTrusted(exec) {
        return !!exec.parent && this.trustedCalls.get(exec.callId) === exec.parent;
    }
    settle(id, result, aborted = false) {
        const call = this.calls.get(id);
        if (!call || call.finished_at)
            return;
        if (this.closed || (this.reportReady && this.operations.has(id))) {
            this.recorder.event("late_tool_result", { call_id: id, result }, call.binding);
            return;
        }
        call.finished_at = new Date().toISOString();
        call.isError = toolResultError(result);
        if (businessTool(call.name) &&
            this.dispatchedCalls.has(id) &&
            (aborted ||
                (result.isError &&
                    ["ABORTED", "TOOL_TIMEOUT"].includes(String(result.error?.info?.code)))))
            call.external_outcome = "UNKNOWN";
        call.result = this.mediaCalls.has(id)
            ? {
                isError: call.isError,
                response_sha256: createHash("sha256")
                    .update(JSON.stringify(result.value ?? result.content))
                    .digest("hex"),
            }
            : this.recorder.sanitize(result);
        this.recorder.event(this.mediaCalls.has(id) ? "media_tool_finished" : "tool_finished", call, call.binding, "finished:" + id);
        if (this.mediaCalls.has(id) && call.external_outcome === "UNKNOWN") {
            this.owner.quarantine(this.run, "画面工具外部结果未知，需核对原调用");
            this.stop("画面工具外部结果未知");
        }
        const operation = this.operations.get(id);
        if (operation && ["REGISTERED", "DISPATCHED"].includes(operation.state)) {
            operation.finished_at = call.finished_at;
            const code = result.isError ? result.error?.info?.code : undefined;
            operation.state =
                !operation.dispatch_observed || code === "ABORTED_BEFORE_DISPATCH"
                    ? "NOT_DISPATCHED"
                    : ((code === "ABORTED" || aborted) && call.name !== "test_api_get") ||
                        this.browser?.outcome(id) === "OUTCOME_UNKNOWN"
                        ? "UNKNOWN"
                        : toolResultError(result)
                            ? "ERROR"
                            : "SUCCEEDED";
            if (toolResultError(result))
                operation.reason = String(this.recorder.sanitize(result.error?.message ??
                    result.content
                        .filter((b) => b.type === "text")
                        .map((b) => b.text)
                        .join("\n")));
            this.recorder.event("operation_finished", operation, operation.binding, "operation-finished:" + id);
        }
        this.save();
        if (this.reportReady)
            writeReport(this.recorder.directory, this.recorder.sanitize(this.run));
    }
    async call(name, args, parent, explanation, media = false) {
        if (this.toolCatalog.has(name))
            this.assertTool(name);
        if (this.connectionReady &&
            this.browser &&
            name === this.browser.prefix + "browser_start")
            this.scheduleConnectionCleanup();
        if (!media &&
            this.toolCatalog.has(name) &&
            this.current &&
            !this.resourcePhase &&
            this.current.phase !== "cleanup") {
            const nextSource = toolSource(this.toolCatalog.snapshot().find((entry) => entry.name === name));
            if (this.run.manifest.active_tool_source !== nextSource)
                this.media.stop();
            this.owner.preview.invalidateCdpSelection(this.run.suite_run_id);
            this.selectedTool = name;
            this.run.manifest.active_tool_source = toolSource(this.toolCatalog.snapshot().find((entry) => entry.name === name));
            this.save();
        }
        if (this.connectionReady &&
            this.browser &&
            name.startsWith(this.browser.prefix) &&
            !["browser_start", "browser_stop"].some((suffix) => name === this.browser.prefix + suffix) &&
            this.browser.resource?.state !== "exists" &&
            this.current) {
            if (this.browser.resource?.state === "unknown")
                throw new Error("原连接资源结果未知，不能新建会话续跑");
            const started = await this.call(this.browser.prefix + "browser_start", {}, parent);
            if (toolResultError(started.result))
                return started;
        }
        if (!media && !this.resourceConfig && businessTool(name)) {
            const owned = this.connectionReady &&
                this.browser &&
                name.startsWith(this.browser.prefix);
            const next = owned ? "run" : "external";
            this.run.manifest.resource_management =
                this.run.manifest.resource_management &&
                    this.run.manifest.resource_management !== next
                    ? "mixed"
                    : next;
        }
        const resourcePhase = this.resourcePhase ??
            (this.current?.step.step_id === "__resource_open"
                ? "start"
                : this.current?.step.step_id === "__resource_close"
                    ? "close"
                    : undefined);
        const resourceConfig = this.resourceConfig;
        let toolResource = this.current?.instance.resources.tool_context;
        if (resourcePhase && resourceConfig && this.current) {
            this.assertTool(name);
            if (resourcePhase === "start") {
                if (toolResource)
                    throw new Error("资源创建已发出，不能重放；请核对原结果或收尾");
                this.toolCatalog.assert(resourceConfig.close.tool_name);
                const close = this.toolCatalog
                    .snapshot()
                    .find((e) => e.name === resourceConfig.close.tool_name);
                toolResource = this.current.instance.resources.tool_context = {
                    id: `${this.id}/${this.current.instance.case_run_id}`,
                    ownership: "run",
                    state: "unknown",
                    tool: {
                        config: structuredClone(resourceConfig),
                        close_digest: close.digest,
                        ...(close.connection ? { connection: close.connection } : {}),
                    },
                };
            }
            else {
                if (!toolResource?.tool)
                    throw new Error("没有本轮工具资源的归属证据");
                if (toolResource.tool.close_call_id && toolResource.state === "unknown")
                    throw new Error("原关闭调用结果未知，不能自动重放；请查询原结果或提交处置证据");
                if (resourceConfig.scope === "resource") {
                    if (toolResource.tool.identity === undefined)
                        throw new Error("原资源身份未知，禁止关闭另一资源；请核对原创建结果");
                    args = {
                        ...args,
                        [resourceConfig.identity_argument]: toolResource.tool.identity,
                    };
                }
            }
            this.run.manifest.resource_management = "run";
            this.save();
        }
        const id = ToolCallId(randomUUID());
        if (media)
            this.mediaCalls.add(id);
        if (resourcePhase && toolResource?.tool) {
            if (resourcePhase === "close") {
                toolResource.tool.close_call_id = id;
                toolResource.state = "unknown";
            }
            else
                toolResource.tool.start_call_id = id;
            this.save();
        }
        this.bind(id, name, args);
        if (explanation && this.current) {
            const records = (this.current.result.actual_operations ??= []);
            const operation = {
                operation_id: randomUUID(),
                order_in_step: records.length + 1,
                binding: { ...this.current.binding },
                description: String(this.recorder.sanitize(explanation.description)),
                description_source: explanation.description_source,
                parent_call_id: parent.callId,
                tool_call_id: id,
                purpose: explanation.purpose ?? "action",
                granularity: !operationTool(name, args) && name !== "test_api_get"
                    ? "unknown"
                    : compositeOperation(name, args)
                        ? "composite"
                        : "atomic",
                dispatch_observed: false,
                state: "REGISTERED",
                created_at: new Date().toISOString(),
            };
            records.push(operation);
            this.operations.set(id, operation);
            this.manualSource.record(operation, name, args, explanation.description);
            this.recorder.event("operation_registered", operation, operation.binding);
            this.recorder.event("operation_linked", {
                operation_id: operation.operation_id,
                tool_call_id: id,
                parent_call_id: parent.callId,
            }, operation.binding);
            // 必需记录落盘后才进入原生派发；写入失败不能执行未记录动作。
            this.save();
        }
        this.trustedCalls.set(id, parent.token);
        try {
            const received = await this.agent.ctx.tools.execute({
                callId: id,
                rootCallId: parent.rootCallId,
                parent: parent.token,
                name,
                arguments: args,
                agent: this.agent,
                signal: parent.signal,
            });
            const result = !received.isError && toolResultError(received)
                ? {
                    isError: true,
                    error: { message: "MCP服务返回执行失败" },
                    content: received.content,
                }
                : received;
            let outcome = result;
            if (toolResource?.tool &&
                resourcePhase &&
                resourceConfig &&
                !this.closed &&
                !this.reportReady) {
                if (resourcePhase === "start")
                    toolResource.tool.start_call_id = id;
                try {
                    if (result.isError)
                        throw new Error("资源工具执行未获确认");
                    if (resourcePhase === "start") {
                        if (resourceConfig.identity) {
                            const identity = extractToolResult(result, resourceConfig.identity);
                            if ((typeof identity !== "string" || !identity.trim()) &&
                                typeof identity !== "number")
                                throw new Error("没有取得明确资源身份");
                            toolResource.tool.identity = identity;
                        }
                        toolResource.state = "exists";
                    }
                    else {
                        if (extractToolResult(result, resourceConfig.released) !== true)
                            throw new Error("原资源释放尚未确认");
                        toolResource.state = "absent";
                    }
                }
                catch (error) {
                    toolResource.state = "unknown";
                    outcome = {
                        isError: true,
                        error: { message: String(error) },
                        content: result.content,
                    };
                }
            }
            if (!media &&
                !this.closed &&
                !this.reportReady &&
                !outcome.isError &&
                this.current)
                archiveToolImages(this.recorder, this.run, result);
            if (!media &&
                !outcome.isError &&
                this.current &&
                this.toolCatalog.has(name) &&
                this.current.phase !== "cleanup" &&
                this.mediaEnabled)
                this.media.bind({
                    callId: id,
                    tool: name,
                    caseId: this.current.instance.case_run_id,
                    result,
                });
            this.settle(id, outcome, parent.signal.aborted);
            if (this.closed)
                throw new Error("测试已封存，迟到结果不改变最终事实");
            return { callId: id, result: outcome };
        }
        finally {
            this.trustedCalls.delete(id);
        }
    }
    stop(reason = "用户停止") {
        if (this.closed || this.reportReady || this.finishing)
            return;
        this.cancelled = true;
        this.run.lifecycle = "CANCELLING";
        this.run.manifest.stop_reason = reason;
        if (reason !== "用户停止")
            this.run.incomplete = true;
        this.recorder.event("stop_requested", { session_id: this.id, reason });
        this.agent.cancel({ kind: "user" });
        this.armStopDeadline();
        if (this.agent.status === "idle")
            void this.turnEnded(true).catch((error) => this.emergency(error));
    }
    async turnEnded(aborted) {
        if (this.closed || this.finalizing)
            return;
        this.finalizing = true;
        try {
            if (aborted) {
                this.cancelled = true;
                this.run.lifecycle = "CANCELLING";
            }
            // 事件表示原生轮次结束；whenIdle只用于确认同一Agent的在途操作已经排空。
            if (aborted)
                this.armStopDeadline();
            await this.agent.whenIdle();
            if (this.closed)
                return;
            if (this.stoppingTimer)
                clearTimeout(this.stoppingTimer);
            if (this.reportReady) {
                await this.dispose();
                return;
            }
            if (!aborted && !this.planned) {
                if (this.review || this.planningQuestion) {
                    if (this.timer)
                        clearTimeout(this.timer);
                    return;
                }
                if (this.nudges++ === 0) {
                    this.recorder.event("planning_retry_requested", {
                        reason: "轮次结束但未提交计划",
                    });
                    this.agent.followup(notice("本次测试尚未提交执行计划，业务没有开始。请按当前test_submit_plan工具Schema保存文字规划；文件用例按planning_input的每个instance_id提交，不要只回复文字分析。保留原文中的动作、输入和预期；提交后按test_current继续。缺少必要信息时使用ask_user_question。"));
                    // 保留最初的规划计时，不因提醒重新获得完整预算。
                    return;
                }
                if (this.timer)
                    clearTimeout(this.timer);
                this.run.incomplete = true;
                this.run.manifest.stop_reason =
                    "模型结束规划轮次但未提交有效计划，测试未执行";
            }
            if (aborted) {
                this.cancelled = true;
                this.run.lifecycle = "CANCELLING";
            }
            if (this.pendingTools.size ||
                [...this.calls.values()].some((c) => !c.finished_at)) {
                this.owner.quarantine(this.run, "在途工具未结算");
                this.run.incomplete = true;
                await this.emergency("原生轮次结束后仍有未结算工具，不能启动清理");
                return;
            }
            if (this.cleanupTurn) {
                await this.emergency("清理轮次未正常完成");
                return;
            }
            if (this.current)
                this.finishStep(aborted ? "CANCELLED" : "ERROR", aborted ? "用户停止" : "模型结束轮次但未结算步骤");
            this.cancelled = true;
            for (const i of this.run.instances)
                i.cancelled = aborted;
            if (!this.planned) {
                if (this.input) {
                    // 未批准的批量计划也保留全部输入实例，不能缩成一个规划占位实例。
                    this.run.manifest.plan_approved = false;
                    this.run.plan = this.draft ?? {
                        ...this.run.plan,
                        planning: {
                            original_task: this.originalTask,
                            rationale: "规划未完成，未执行",
                            input: structuredClone(this.input),
                        },
                        cases: this.input.instances.map((i) => ({
                            case_id: i.id,
                            name: `用例${i.case_number} · 数据行${i.data_row ?? "—"}（未执行）`,
                            preconditions: [],
                            steps: [],
                            cleanup: [],
                            datasets: [
                                {
                                    data_id: i.data_row ? `row_${i.data_row}` : "default",
                                    inputs: { ...i.parameters },
                                    expected: {},
                                },
                            ],
                        })),
                    };
                    this.run.instances = expand(this.run.plan);
                    for (const instance of this.run.instances) {
                        instance.session_id = this.id;
                        instance.cancelled = aborted;
                    }
                    this.recorder.json("plan.json", this.run.plan);
                }
                else {
                    // 规划没有触碰外部环境，只记录未完成的规划实例，不派发清理工具。
                    const instance = expand({
                        ...this.run.plan,
                        cases: [
                            {
                                case_id: "planning",
                                name: "规划未完成",
                                preconditions: [],
                                steps: [],
                                cleanup: [],
                                datasets: [{ data_id: "default", inputs: {}, expected: {} }],
                            },
                        ],
                    })[0];
                    instance.session_id = this.id;
                    instance.cancelled = aborted;
                    this.run.instances.push(instance);
                }
            }
            this.cleanupTurn = true;
            this.nudges = 0;
            this.advance();
            if (!this.current) {
                await this.finish();
                await this.dispose();
                return;
            }
            this.agent.followup(notice("测试已停止业务动作；在途工具已结算。现在仅执行test_current指定的冻结清理步骤（禁止业务步骤和新增目标）。按当前步骤完成清理、test_capture、test_finish_step，最后test_finish，并在正常回复中说明取消结果和报告链接。"));
        }
        finally {
            this.finalizing = false;
        }
    }
    finish() {
        return (this.finishing ??= this.finalize());
    }
    async finalize() {
        this.media.stop();
        if (!this.reportReady) {
            if (this.timer)
                clearTimeout(this.timer);
            if (this.stoppingTimer)
                clearTimeout(this.stoppingTimer);
            try {
                await this.browser?.close();
            }
            catch {
                this.run.incomplete = true;
                this.run.manifest.node_lease_cleanup_error =
                    "Node 使用权归还未获确认，请按原租约处理";
                this.owner.quarantine(this.run, "Node 使用权归还未获确认");
            }
            sealOperations(this.run, "测试已封存，在途操作未获得最终结果");
            for (const i of this.run.instances) {
                if (i.steps.some((s) => s.calls.some((c) => c.external_outcome === "UNKNOWN") ||
                    s.actual_operations?.some((o) => o.state === "UNKNOWN"))) {
                    i.resource_quarantined = true;
                    this.owner.quarantine(this.run, "通用工具外部结果未知，请先确认原操作已停止");
                }
                if (this.run.incomplete) {
                    i.incomplete = true;
                    i.issues.push(String(this.run.manifest.stop_reason ?? "运行未完整结算"));
                }
                if (i.resources.browser_context?.state === "exists" ||
                    (i.resources.browser_context?.remote &&
                        i.resources.browser_context.state === "unknown") ||
                    Object.values(i.resources).some((resource) => resource.tool && ["exists", "unknown"].includes(resource.state))) {
                    i.resource_quarantined = true;
                    this.owner.quarantine(this.run, "浏览器释放未获确认");
                }
                i.status = aggregate(i);
                i.lifecycle = "FINISHED";
            }
            this.run.lifecycle = "FINISHED";
            this.run.finished_at = new Date().toISOString();
            this.save();
            this.exportManualCases();
            writeReport(this.recorder.directory, this.recorder.sanitize(this.run));
            this.owner.reports.select(this.run);
            this.reportReady = true;
        }
        return {
            statistics: statistics(this.run),
            stop_reason: this.run.manifest.stop_reason,
            assertions: this.state().assertions,
            steps: this.run.instances.map((i) => ({
                instance: i.case_run_id,
                status: i.status,
                steps: i.steps.map((s) => ({
                    step: s.step_id,
                    description: s.description,
                    status: s.status,
                    reason: s.reason,
                    assertion: s.assertion,
                })),
            })),
            report: {
                path: join(this.recorder.directory, "report.html"),
                url: this.owner.reports.url(this.run.suite_run_id),
                markdown: `[查看测试报告](${this.owner.reports.url(this.run.suite_run_id)})`,
            },
            actual_steps: join(this.recorder.directory, "actual-steps.json"),
            manual_cases: join(this.recorder.directory, "manual-cases.md"),
            actual_steps_export_error: this.run.manifest.actual_steps_export_error,
            ...(this.run.node_lease ? { node_lease: this.publicLease() } : {}),
            message: "请在正常最终回复中提供以上统计、断言实际/预期、保存位置和Markdown报告链接。报告为静态HTML，可离线打开。",
        };
    }
    requireSettled(exec) {
        if ([...this.pendingTools].some((id) => id !== exec.callId))
            throw new Error("其他工具尚未结算");
    }
    cleanupAllowed(exec) {
        if (this.releaseStep())
            return this.releaseAllowed(exec);
        if ([
            "test_capture",
            "test_current",
            "test_finish_step",
            "test_fail_step",
            "test_finish",
        ].includes(exec.name))
            return true;
        const action = this.current?.phase === "cleanup" ? this.current.step.action : undefined;
        if (!action)
            return false;
        if (exec.name === "test_execute_operation") {
            const input = exec.arguments;
            try {
                nativeOperationArguments(input);
            }
            catch {
                return false;
            }
            return (!!input.tool_name &&
                this.toolCatalog.has(input.tool_name) &&
                ["browser", "tool"].includes(action.capability));
        }
        if (["tool", "browser"].includes(action.capability))
            return (this.isTrusted(exec) &&
                (this.toolCatalog.has(exec.name) || exec.name === this.closeTool));
        return action.capability === "api" && exec.name === "test_api_get";
    }
    releaseStep(step = this.current?.step) {
        if (step?.step_id === "__resource_close")
            return true;
        const action = step?.action;
        const capture = Object.values(action?.capture ?? {});
        return (action?.capability === "browser" &&
            capture.length > 0 &&
            capture.every((item) => item.kind === "browser_close"));
    }
    releaseAllowed(exec) {
        return ([
            "test_capture",
            "test_current",
            "test_finish_step",
            "test_fail_step",
            "test_finish",
        ].includes(exec.name) ||
            (exec.name === this.closeTool && this.isTrusted(exec)));
    }
    armStopDeadline() {
        if (this.stoppingTimer)
            return;
        this.stoppingTimer = setTimeout(() => {
            if (this.closed || this.finishing)
                return;
            this.owner.quarantine(this.run, "停止等待在途操作超时，禁止启动清理");
            void this.emergency("在途操作未在取消宽限期内结算，请人工确认外部停止并重置环境");
        }, this.owner.config.cancelGraceMs);
    }
    exportManualCases() {
        try {
            writeManualCases(this.recorder.directory, this.recorder.sanitize(this.run));
        }
        catch (error) {
            const message = "实际步骤文件导出失败；已保存的运行数据可通过报告重建重新生成：" +
                String(this.recorder.sanitize(String(error)));
            this.run.manifest.actual_steps_export_error = message;
            this.owner.ctx.logger?.warn(message);
            this.save();
        }
    }
    save() {
        this.recorder.snapshot(this.run);
        this.manualSource.save(this.run);
        try {
            if (this.captureBrowser?.resource) {
                this.owner.preview.syncRemote(this.run, this.captureBrowser);
                return;
            }
            this.owner.preview.sync(this.run, {
                directory: this.recorder.directory,
                deadline: () => Math.min(this.mediaDeadline ??
                    (this.current
                        ? Date.parse(this.current.result.started_at) +
                            this.owner.config.stepTimeoutMs
                        : Infinity), Date.now() + this.owner.config.cleanupTimeoutMs),
                emit: (event, recording, evidence) => {
                    try {
                        if (this.closed || this.reportReady)
                            return;
                        const records = (this.run.recordings ??= []);
                        const index = records.findIndex((r) => r.recording_id === recording.recording_id);
                        if (index < 0)
                            records.push(recording);
                        else
                            records[index] = recording;
                        if (evidence)
                            this.run.evidence.push(evidence);
                        this.recorder.event(event, {
                            recording,
                            ...(evidence ? { evidence } : {}),
                        });
                        this.recorder.snapshot(this.run);
                    }
                    catch (error) {
                        this.owner.ctx.logger.warn("保存录像记录失败：%s", String(error));
                    }
                },
            }, this.current &&
                this.selectedTool &&
                this.owner.preview.config?.connectionId &&
                this.owner.preview.config?.connectionId ===
                    this.run.manifest.active_tool_source
                ? {
                    run_id: this.run.suite_run_id,
                    case_run_id: this.current.instance.case_run_id,
                    connection_id: this.owner.preview.config.connectionId,
                    connection_digest: this.owner.preview.config.connectionDigest,
                }
                : false);
        }
        catch (error) {
            this.owner.ctx.logger.warn("更新浏览器预览归属失败：%s", String(error));
        }
    }
    async emergency(error) {
        this.mediaDeadline = Date.now();
        this.owner.preview.sealRecordings(this.run.suite_run_id, "测试紧急截止，视频收尾未获确认");
        this.run.incomplete = true;
        if (this.current)
            this.finishStep("ERROR", String(error));
        for (const i of this.run.instances) {
            i.incomplete = true;
            i.issues.push(String(error));
        }
        try {
            await this.finish();
        }
        catch {
            this.owner.ctx.logger?.warn("测试报告封存失败，保留原记录与隔离供核查");
        }
        finally {
            await this.dispose();
        }
    }
    get disposing() {
        return !!this.disposal && !this.disposalDone;
    }
    dispose() {
        if (this.disposal)
            return this.disposal;
        this.closed = true;
        this.media.stop();
        if (this.timer)
            clearTimeout(this.timer);
        if (this.stoppingTimer)
            clearTimeout(this.stoppingTimer);
        for (const dispose of this.disposers.splice(0).reverse())
            dispose();
        this.disposal = (async () => {
            try {
                await this.browser?.close();
            }
            catch {
                if (!this.reportReady) {
                    this.run.incomplete = true;
                    this.owner.quarantine(this.run, "Node 使用权归还未获确认");
                    this.save();
                }
            }
            if (this.previousPlanMode !== undefined && !this.planned)
                await this.setPlanMode(this.previousPlanMode).catch((error) => this.owner.ctx.logger?.warn("恢复计划模式失败: %s", String(error)));
        })().finally(() => {
            this.disposalDone = true;
        });
        return this.disposal;
    }
    async shutdown() {
        if (this.closed)
            return this.dispose();
        this.finalizing = true;
        this.agent.cancel({ kind: "user" });
        this.owner.quarantine(this.run, "插件卸载，需确认外部操作停止和环境重置");
        await this.emergency("插件卸载，测试中断；不再派发工具");
    }
}
