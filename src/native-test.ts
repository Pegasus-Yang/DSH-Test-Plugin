/** 当前Agent的测试增强：宿主驱动对话，插件提供约束、可信采集和确定性结果。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { ToolCallId } from "@deepseek-ai/dsh-llm/brand";
import type {
  ToolExecutionResult,
  ToolRunContext,
} from "@deepseek-ai/dsh-tools";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
  aggregate,
  expand,
  field,
  parsePlan,
  planSchema,
  statistics,
  type Binding,
  type CallRecord,
  type CaseRun,
  type Phase,
  type Step,
  type StepResult,
  type SuiteRun,
} from "./contracts.js";
import { Recorder, atomicJson } from "./recorder.js";
import { captureStep } from "./adapters.js";
import { evaluate } from "./assertions.js";
import { writeReport } from "./report.js";
import { ReportAccess } from "./report-access.js";
import { defaults, type TestConfig } from "./config.js";
import { applyRevision } from "./revisions.js";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "plugin:test": { kind: "plugin:test"; form: "notice"; summary: string };
  }
}
const empty = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};
const output = {
  schema: { type: "object" as const },
  render: (_: unknown, value: unknown) => [
    { type: "text" as const, text: JSON.stringify(value, null, 2) },
  ],
};
// 自然语言入口由插件补齐版本、规则来源和缺省阶段，模型只描述业务计划。
const naturalCase = planSchema.properties.cases.items;
const naturalPlanSchema = {
  ...planSchema,
  required: ["suite_id", "name", "cases"],
  properties: {
    suite_id: planSchema.properties.suite_id,
    name: planSchema.properties.name,
    cases: {
      ...planSchema.properties.cases,
      items: {
        ...naturalCase,
        required: ["case_id", "name", "steps"],
        properties: {
          ...naturalCase.properties,
          preconditions: {
            ...naturalCase.properties.preconditions,
            description: "可省略；只有用户明确要求额外前置条件时填写。",
          },
          cleanup: {
            ...naturalCase.properties.cleanup,
            description:
              "默认省略；插件自动关闭浏览器。仅用户额外授权的业务清理才填写。",
          },
        },
      },
    },
  },
};
const guide = `当前对话已启用测试增强。使用本会话正常的推理、文字回复、浏览器工具及原生审批完成用户任务，不创建其他会话或后台任务。执行前用中文简要告知步骤，执行中说明关键发现。
先理解任务；用户已给出目标网址、搜索词和预期时直接工作，不追问实现细节。真正缺少网址、输入或预期时正常向用户提问，等待同一对话回复。网页测试先用原生Playwright工具只读探索元素与选择器，然后调用test_submit_plan冻结计划，再重新按冻结步骤执行。不能猜测选择器或接口地址。预期只来自用户/已授权规则，绝不把本次采集值写成预期。浏览器自动初始化/释放步骤由插件加入，preconditions和cleanup可为空数组。
test_submit_plan只提交suite_id、name、cases；schema_version和source_refs由插件补齐，不提交。case.preconditions、cleanup默认省略。action.outputs是“输出名→JSON Schema”的对象，例如{"url":{"type":"string"},"likes":{"type":"number"}}，不是单一Schema或字符串。completion_requirements只写输出名，例如["url"]，不是步骤ID。网页URL采集使用{"kind":"dom","mode":"url"}，不能用http采集HTML网页。http仅用于确定返回JSON的接口。action.outputs是JSON Schema；action.capture单独定义可信采集：dom的mode可为text/number/count/visible/url/attribute/value，CSS selector必须真实且唯一（集合用index）；数值mode=number，网址mode=url、field=pathname可提取当前页面路径（不能带selector）；链接href用mode=attribute、attribute=href、selector和index=0，可用field=pathname提取链接路径；http使用url和field；browser_close采集释放结果。completion_requirements列出必要输出。action.allowed_targets为完整URL。断言observation_ref格式step_id.output_name，operator支持eq/neq/contains/range/exists/text/visible，literal、expected_ref、expected_observation_ref恰选一种；规则rule_ref=user_task。
必须为用户要求的动作身份建立断言，例如搜索词是否正确、打开的链接是否等于第一条结果的href，不能仅核对最后数值而遗漏路径身份。数值断言必须使用mode=number、outputs类型number或integer，预期在datasets.expected中声明JSON数字并用expected_ref引用，不能将类型降为string来通过校验。对于第一条结果，必须在搜索步骤采集first_href，在打开步骤采集pathname，用expected_observation_ref比较二者；禁止把探索时看到的帖子URL硬编码为预期。approval默认省略，宿主原有审批策略保持有效；只有用户规则明确要求额外审批才设置true。提交后按test_current返回的当前步骤执行。完成动作后调用test_capture采集真实观察，再调用test_finish_step；断言由程序比较，你不能提交实际值或自行宣布通过。工具失败可按真实页面修正操作，不能改冻结预期。采集失败最多修正操作重试一次；仍失败调用test_fail_step，不重复空转或继续执行尚未激活的业务步骤。所有步骤完成后调用test_finish生成报告，并在本轮正常最终回复中列出结果、关键断言实际/预期、保存位置和工具返回的Markdown报告链接。不使用其他Agent，不用脚本绕过浏览器工具执行测试。
非零数值断言格式示例（这里只演示结构，目标、选择器、规则必须按本次用户任务和真实页面填写）：{"suite_id":"check_count","name":"验证数量","cases":[{"case_id":"one","name":"读取并比较","datasets":[{"data_id":"main","inputs":{},"expected":{"zero":0}}],"steps":[{"step_id":"read","kind":"action","description":"读取计数","required":true,"depends_on":[],"action":{"goal":"打开目标并采集计数","capability":"browser","allowed_targets":["https://example.com"],"inputs":{},"outputs":{"count":{"type":"number"}},"completion_requirements":["count"],"capture":{"count":{"kind":"dom","mode":"number","selector":"#count"}}}},{"step_id":"nonzero","kind":"assertion","description":"计数不为零","required":true,"depends_on":["read"],"assertion":{"observation_ref":"read.count","operator":"neq","expected_ref":"data.expected.zero","rule_ref":"user_task"}}]}]}。对于“不为0”严格使用neq 0，不能改成有上界的range。`;
function notice(text: string) {
  return createUserMessage({
    source: { kind: "plugin:test", form: "notice", summary: "测试增强上下文" },
    content: [{ type: "text", text }],
  });
}
function closeStep(id: string, description: string): Step {
  return {
    step_id: id,
    kind: "action",
    description,
    required: true,
    depends_on: [],
    ...(id === "__close"
      ? { run_if: "resource_exists" as const, resource_ref: "browser_context" }
      : {}),
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
interface Entry {
  instance: CaseRun;
  step: Step;
  phase: Phase;
}

export class NativeTests {
  readonly config: TestConfig;
  readonly reports: ReportAccess;
  readonly sessions = new Map<string, NativeTest>();
  constructor(
    readonly ctx: Context,
    config: Partial<TestConfig>,
  ) {
    this.config = { ...defaults, ...config };
    for (const key of [
      "stepTimeoutMs",
      "cleanupTimeoutMs",
      "cancelGraceMs",
      "maxRevisions",
    ] as const)
      if (!Number.isFinite(this.config[key]) || this.config[key] <= 0)
        throw new Error("配置必须为有限正数: " + key);
    mkdirSync(this.config.outputRoot, { recursive: true });
    const released = new Set<string>();
    for (const file of readdirSync(this.config.outputRoot).filter((n) =>
      /^release-.*\.json$/.test(n),
    )) {
      try {
        released.add(
          JSON.parse(readFileSync(join(this.config.outputRoot, file), "utf8"))
            .quarantine.details.run_id,
        );
      } catch {
        /* 不是有效处置证据。 */
      }
    }
    for (const id of readdirSync(this.config.outputRoot).filter((n) =>
      /^run-[\w-]+$/.test(n),
    )) {
      try {
        const run = JSON.parse(
          readFileSync(
            join(this.config.outputRoot, id, "results.json"),
            "utf8",
          ),
        ) as SuiteRun;
        if (
          run.manifest.execution === "native-conversation" &&
          run.lifecycle !== "FINISHED" &&
          !released.has(id)
        )
          this.quarantine(
            run,
            "宿主重启发现未结算测试；请检查外部操作和资源，不能自动重放",
          );
      } catch {
        /* 不读取或修改宿主会话数据。 */
      }
    }
    this.reports = new ReportAccess(this.config.outputRoot);
  }
  async start(agent: Agent, task: string, plan?: unknown): Promise<string> {
    if (!task.trim()) throw new Error("请提供动作、输入和可验证预期");
    if (agent.status !== "idle")
      throw new Error("请等待当前对话轮次结束后再启动测试");
    if (existsSync(join(this.config.outputRoot, "quarantine.json")))
      throw new Error(
        "共享环境处于隔离状态；确认外部操作已停止并重置后使用/test-release提交处置证据",
      );
    if ([...this.sessions.values()].some((s) => !s.closed))
      throw new Error("已有测试使用共享浏览器，请先结束或停止该测试");
    const test = new NativeTest(this, agent, task);
    this.sessions.set(agent.id, test);
    try {
      test.attach();
      if (plan !== undefined) test.submit(plan, true);
      return await test.start(task);
    } catch (error) {
      test.dispose();
      throw error;
    }
  }
  reportId(sessionId: string): string | undefined {
    const current = this.sessions.get(sessionId);
    if (current) return current.run.suite_run_id;
    for (const id of readdirSync(this.config.outputRoot)
      .filter((id) => /^run-[\w-]+$/.test(id))
      .sort()
      .reverse()) {
      try {
        const run = JSON.parse(
          readFileSync(
            join(this.config.outputRoot, id, "results.json"),
            "utf8",
          ),
        ) as SuiteRun;
        if (
          run.manifest.origin_session_id === sessionId &&
          run.lifecycle === "FINISHED" &&
          existsSync(join(this.config.outputRoot, id, "report.html"))
        )
          return id;
      } catch {
        /* 不把损坏记录作为当前会话报告。 */
      }
    }
  }
  quarantine(run: SuiteRun, reason: string): void {
    run.resource_quarantined = true;
    atomicJson(join(this.config.outputRoot, "quarantine.json"), {
      created_at: new Date().toISOString(),
      details: { run_id: run.suite_run_id, reason },
    });
  }
  release(evidenceFile: string): void {
    if ([...this.sessions.values()].some((s) => !s.closed))
      throw new Error("活动测试不能解除隔离");
    const proof = JSON.parse(readFileSync(evidenceFile, "utf8"));
    if (
      proof.external_stopped !== true ||
      proof.environment_reset !== true ||
      !proof.operator ||
      !proof.details ||
      !proof.evidence
    )
      throw new Error("需提供外部停止、环境重置、操作者与处置证据");
    const path = join(this.config.outputRoot, "quarantine.json");
    const quarantine = JSON.parse(readFileSync(path, "utf8"));
    atomicJson(
      join(this.config.outputRoot, "release-" + randomUUID() + ".json"),
      { quarantine, proof, released_at: new Date().toISOString() },
    );
    unlinkSync(path);
  }
  async shutdown(): Promise<void> {
    for (const test of this.sessions.values())
      if (!test.closed) await test.shutdown();
  }
}

export class NativeTest {
  readonly recorder: Recorder;
  readonly run: SuiteRun;
  readonly agent: Agent;
  closed = false;
  private planned = false;
  private reportReady = false;
  private cancelled = false;
  private cleanupTurn = false;
  private finalizing = false;
  private nudges = 0;
  private cursor = 0;
  private entries: Entry[] = [];
  private current?: Entry & { result: StepResult; binding: Binding };
  private calls = new Map<string, CallRecord>();
  private pendingTools = new Set<string>();
  private disposers: (() => void)[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private planningBrowser = false;
  private stoppingTimer?: ReturnType<typeof setTimeout>;
  private task: string;
  constructor(
    private owner: NativeTests,
    agent: Agent,
    task: string,
  ) {
    this.agent = agent;
    this.task = task;
    const id =
      "run-" +
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
        plugin_version: "0.2.0",
        execution: "native-conversation",
        origin_session_id: agent.id,
        tools_mode: "native",
      },
    };
  }
  get id(): string {
    return this.agent.id;
  }
  attach(): void {
    const scope = this.agent.ctx;
    const own = (dispose: () => void) => {
      this.disposers.push(dispose);
    };
    own(
      scope.systemPrompt.section({
        name: "plugin:test-guidance",
        order: 10500,
        interpolate: false,
        text: () =>
          this.reportReady
            ? "测试报告已生成。请在本轮回复中只总结test_finish返回的权威统计、逐步状态和断言。BLOCKED或缺少断言记录绝不能写成PASS；页面口头观察不能替代程序断言。给出报告链接。"
            : guide + "\n当前测试状态：" + JSON.stringify(this.state()),
      }),
    );
    const tool = (
      name: string,
      description: string,
      parameters: any,
      execute: (args: any, exec: ToolRunContext) => unknown,
    ) =>
      own(
        scope.tools.register({
          name,
          description,
          parameters,
          output,
          execute: async (args, exec) => {
            // 可选TypeScript字段不得以undefined进入宿主的无损JSON工具边界。
            return JSON.parse(JSON.stringify(await execute(args, exec)));
          },
        }),
      );
    tool(
      "test_submit_plan",
      "冻结本对话测试计划；从用户原文提取预期，不能提交实际结果。",
      naturalPlanSchema,
      (args) => this.submit(args),
    );
    tool(
      "test_current",
      "读取当前步骤、冻结目标、输入及已计算断言。",
      empty,
      () => this.state(),
    );
    tool(
      "test_capture",
      "执行当前步骤的可信采集器，不接受模型提供实际值。",
      empty,
      async (_, exec) => {
        const c = this.current;
        if (!c?.step.action) throw new Error("没有当前采集步骤");
        if (c.result.observations.length)
          throw new Error("本步骤已有观察，不能覆盖");
        await captureStep(
          this,
          this.recorder,
          this.run,
          c.step,
          c.result,
          c.binding,
          exec,
        );
        this.save();
        return {
          observations: c.result.observations.map((o) => ({
            name: o.output_name,
            value: o.value,
          })),
          next: "调用test_finish_step结算当前步骤",
        };
      },
    );
    tool(
      "test_finish_step",
      "必要观察完整后结算本步骤并计算后续断言，返回下一动作。",
      empty,
      (_, exec) => {
        const c = this.current;
        if (!c) throw new Error("没有当前步骤");
        this.requireSettled(exec);
        if (
          !c.step.action!.completion_requirements.every((n) =>
            c.result.observations.some((o) => o.output_name === n),
          )
        )
          throw new Error("缺少必要观察；先完成动作并调用test_capture");
        this.finishStep("SUCCEEDED");
        this.advance();
        return this.state();
      },
    );
    tool(
      "test_fail_step",
      "当前动作无法完成时记录真实错误并进入后续可用步骤或清理，不伪造观察。",
      {
        type: "object",
        required: ["reason"],
        properties: { reason: { type: "string" } },
        additionalProperties: false,
      },
      (args, exec) => {
        this.requireSettled(exec);
        if (!this.current) throw new Error("没有当前步骤");
        this.finishStep("ERROR", args.reason);
        this.advance();
        return this.state();
      },
    );
    tool(
      "test_finish",
      "全部步骤及清理完成后生成静态报告，返回最终回复应使用的链接与保存位置。",
      empty,
      (_, exec) => {
        this.requireSettled(exec);
        if (this.current || this.cursor < this.entries.length || !this.planned)
          throw new Error("测试尚未完成，请按test_current继续");
        return this.finish();
      },
    );
    tool(
      "test_api_get",
      "通过原生工具管线读取当前冻结计划允许的HTTP JSON接口。",
      {
        type: "object",
        required: ["url"],
        properties: { url: { type: "string" } },
        additionalProperties: false,
      },
      async (args, exec) => {
        const response = await fetch(args.url, {
          signal: exec.signal,
          redirect: "error",
        });
        return { status: response.status, body: await response.json() };
      },
    );
    tool(
      "test_propose_checkpoint",
      "追加具有现有冻结规则来源的必需断言，不能修改已有预期。",
      {
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
      },
      (args) => {
        // 先验证运行边界，再提交不可回滚的修订事件。
        const positions = new Map<string, number>();
        for (const id of args.target_instance_ids ?? []) {
          const position = this.entries.findIndex(
            (e, index) =>
              index >= this.cursor &&
              e.instance.case_run_id === id &&
              (args.insertion_boundary === "end"
                ? e.phase === "cleanup"
                : e.step.step_id === args.insertion_boundary),
          );
          if (position < 0) throw new Error("插入边界已执行或不存在");
          positions.set(id, position);
        }
        const revision = applyRevision(
          this.run,
          this.recorder,
          args,
          this.owner.config.maxRevisions,
        );
        for (const [id, position] of [...positions].sort(
          (a, b) => b[1] - a[1],
        )) {
          const instance = this.run.instances.find(
            (i) => i.case_run_id === id,
          )!;
          this.entries.splice(
            position,
            0,
            ...revision.added_steps.map((step) => ({
              instance,
              step,
              phase: "test" as const,
            })),
          );
        }
        this.save();
        return { accepted: true, revision: revision.revision };
      },
    );
    own(
      scope.on("session/event", (session, event) => {
        if (session.id !== this.id || this.closed) return;
        // 仅观察官方事件；不写入或重写宿主会话日志。
        this.recorder.event("native_session_event", {
          session_id: this.id,
          type: event.type,
        });
        if (event.type === "tool/call") {
          try {
            this.bind(
              event.data.callId,
              event.data.name,
              JSON.parse(event.data.arguments || "{}"),
            );
          } catch {
            /* 原生工具管线处理无效参数。 */
          }
        }
        if (
          event.type === "user/message" &&
          event.data.source.kind === "user" &&
          !this.planned
        ) {
          const text = event.data.content
            .filter((b) => b.type === "text")
            .map((b) => (b as { text: string }).text)
            .join("\n");
          if (text !== this.task) this.task += "\n" + text;
        }
        if (event.type === "turn/end")
          void this.turnEnded(event.data.reason.kind === "aborted").catch(
            (error) => this.emergency(error),
          );
      }),
    );
    own(
      scope.on("tools/pre-execute", async (exec, next) => {
        if (exec.agent?.id !== this.id) return next();
        if (!this.planned && exec.name.startsWith("mcp__playwright__"))
          this.planningBrowser = true;
        this.pendingTools.add(exec.callId);
        this.bind(exec.callId, exec.name, exec.arguments);
        const decision = await next();
        if (
          decision.kind === "allow" &&
          this.current?.step.action?.approval &&
          !exec.name.startsWith("test_")
        )
          return { kind: "ask", reason: "当前冻结步骤需要审批" };
        return decision;
      }),
    );
    own(
      scope.on("tools/execute", async (exec, next) => {
        if (exec.agent?.id === this.id) {
          const call = this.calls.get(exec.callId);
          if (call)
            this.recorder.event(
              "tool_dispatched",
              { call_id: exec.callId, name: exec.name },
              call.binding,
            );
        }
        return next();
      }),
    );
    own(
      scope.on("tools/result", (exec, result) => {
        if (exec.agent?.id !== this.id) return;
        this.pendingTools.delete(exec.callId);
        this.settle(exec.callId, result);
      }),
    );
    own(
      scope.tools.guard((exec) => {
        if (this.closed || this.reportReady) return;
        if (this.recorder.failed) return "测试账本写入失败，停止工具派发";
        if (this.cancelled && !this.cleanupTurn)
          return "停止后禁止新业务动作，等待在途结算";
        if (exec.agent?.id !== this.id) return;
        if (this.cleanupTurn && !this.cleanupAllowed(exec))
          return "收尾轮次仅允许当前冻结清理步骤的预授权工具";
        if (
          !exec.parent &&
          this.pendingTools.size &&
          !this.pendingTools.has(exec.callId)
        )
          return "测试增强按步骤串行；请等待在途工具结算后重试";
        if (
          this.planned &&
          exec.name === "mcp__playwright__browser_evaluate" &&
          !exec.parent
        )
          return "冻结后的DOM求值通过test_capture执行";
        if (this.planned && typeof (exec.arguments as any)?.url === "string") {
          const url = (exec.arguments as any).url;
          if (
            url !== "about:blank" &&
            !this.current?.step.action?.allowed_targets.some(
              (t) => new URL(t).origin === new URL(url).origin,
            )
          )
            return "目标不在当前冻结步骤范围内";
        }
      }),
    );
    own(
      scope.on("agent/turn-stopping", ({ agent }) => {
        if (
          agent.id !== this.id ||
          this.closed ||
          !this.planned ||
          this.reportReady ||
          (this.cancelled && !this.cleanupTurn)
        )
          return;
        if (this.nudges++ < 2)
          agent.steer(
            notice(
              "测试尚未结算。请按test_current继续；无法完成调用test_fail_step，完成后调用test_finish并给出报告链接。",
            ),
          );
      }),
    );
    own(
      this.owner.ctx.effect(() => () => {
        if (!this.closed) void this.shutdown();
      }),
    );
  }
  async start(task: string): Promise<string> {
    this.save();
    if (!this.planned)
      this.timer = setTimeout(
        () => this.stop("规划执行超时"),
        this.owner.config.stepTimeoutMs,
      );
    this.agent.followup(
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: task }],
      }),
    );
    return "测试已在当前对话启动；执行步骤、工具结果和最终报告将在本对话中显示。";
  }
  submit(input: unknown, trustedFile = false): unknown {
    if (this.planned) throw new Error("计划已冻结；不能替换预期");
    const value = structuredClone(input) as any;
    if (!trustedFile) {
      value.schema_version = "1";
      for (const c of value.cases ?? []) {
        c.preconditions ??= [];
        c.cleanup ??= [];
        c.datasets ??= [{ data_id: "default", inputs: {}, expected: {} }];
      }
      value.source_refs = [
        {
          id: "user_task",
          kind: "user",
          uri: "session:" + this.id,
          version: "1",
          locator: "本次测试用户输入",
          excerpt: this.task,
        },
      ];
    }
    const plan = parsePlan(value);
    if (this.timer) clearTimeout(this.timer);
    this.planned = true;
    this.run.name = plan.name;
    this.run.plan = plan;
    this.run.instances = expand(plan);
    this.recorder.protect(plan);
    this.recorder.json("plan.json", plan);
    for (const instance of this.run.instances) {
      instance.session_id = this.id;
      instance.cleanup_session_id = this.id;
      const c = plan.cases.find((c) => c.case_id === instance.case_id)!;
      const browser = [...c.preconditions, ...c.steps, ...c.cleanup].some(
        (s) => s.action?.capability === "browser",
      );
      if (browser) {
        this.entries.push({
          instance,
          phase: "setup",
          step: closeStep("__reset", "初始化本次测试浏览器上下文"),
        });
      }
      this.entries.push(
        ...c.preconditions.map((step) => ({
          instance,
          step,
          phase: "setup" as const,
        })),
        ...instance.effective_steps.map((step) => ({
          instance,
          step,
          phase: "test" as const,
        })),
        ...c.cleanup.map((step) => ({
          instance,
          step,
          phase: "cleanup" as const,
        })),
      );
      if (
        browser &&
        !c.cleanup.some((s) =>
          Object.values(s.action?.capture ?? {}).some(
            (x) => x.kind === "browser_close",
          ),
        )
      )
        this.entries.push({
          instance,
          phase: "cleanup",
          step: closeStep("__close", "关闭并确认浏览器上下文释放"),
        });
    }
    this.owner.reports.select(this.run, "report.html", false);
    this.advance();
    return this.state();
  }
  private advance(): void {
    this.current = undefined;
    while (this.cursor < this.entries.length) {
      const e = this.entries[this.cursor++];
      e.instance.lifecycle = "RUNNING";
      e.instance.status = "RUNNING";
      const result: StepResult = {
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
      const binding: Binding = {
        suite_run_id: this.run.suite_run_id,
        case_run_id: e.instance.case_run_id,
        phase: e.phase,
        step_id: e.step.step_id,
        attempt_id: "1",
      };
      e.instance.steps.push(result);
      this.current = { ...e, result, binding };
      this.recorder.event("step_started", { step: e.step }, binding);
      if (
        !this.cancelled &&
        e.phase === "setup" &&
        e.step.step_id === "__reset"
      )
        e.instance.resources.browser_context = { id: this.id, state: "exists" };
      if (
        e.phase === "cleanup" &&
        e.step.run_if === "resource_exists" &&
        e.instance.resources[e.step.resource_ref!]?.state !== "exists"
      ) {
        result.cleanup_applicable = false;
        this.finishStep("SKIPPED", "资源不存在，无需清理");
        continue;
      }
      if (this.cancelled && e.phase !== "cleanup") {
        e.instance.cancelled = true;
        this.finishStep("SKIPPED", "用户停止");
        continue;
      }
      if (
        e.phase !== "cleanup" &&
        (e.instance.steps.some(
          (s) =>
            s.required &&
            s.phase !== "cleanup" &&
            ["FAIL", "ERROR", "INCONCLUSIVE", "BLOCKED"].includes(s.status),
        ) ||
          e.step.depends_on.some(
            (id) =>
              !e.instance.steps.some(
                (s) =>
                  s.step_id === id && ["SUCCEEDED", "PASS"].includes(s.status),
              ),
          ))
      ) {
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
      this.timer = setTimeout(
        () => {
          this.recorder.event("step_timeout", {}, binding);
          e.instance.incomplete = true;
          e.instance.issues.push("步骤执行超时");
          this.stop("步骤执行超时");
        },
        e.phase === "cleanup"
          ? this.owner.config.cleanupTimeoutMs
          : this.owner.config.stepTimeoutMs,
      );
      break;
    }
    this.save();
  }
  private finishStep(status: StepResult["status"], reason?: string): void {
    if (!this.current) return;
    if (this.timer) clearTimeout(this.timer);
    const c = this.current;
    c.result.status = status;
    if (
      c.phase === "cleanup" &&
      status === "SUCCEEDED" &&
      Object.values(c.step.action?.capture ?? {}).some(
        (x) => x.kind === "browser_close",
      )
    ) {
      if (c.instance.resources.browser_context)
        c.instance.resources.browser_context.state = "absent";
    }
    if (reason) c.result.reason = reason;
    c.result.finished_at = new Date().toISOString();
    c.result.duration_ms = Date.now() - Date.parse(c.result.started_at);
    this.recorder.event("step_finished", c.result, c.binding);
    this.current = undefined;
  }
  state() {
    const c = this.current;
    return {
      run_id: this.run.suite_run_id,
      session_id: this.id,
      phase: this.reportReady
        ? "finished"
        : this.planned
          ? this.cleanupTurn
            ? "cleanup"
            : "executing"
          : "planning",
      current: c
        ? {
            instance: c.instance.case_run_id,
            step: c.step,
            inputs: Object.fromEntries(
              Object.entries(c.step.action?.inputs ?? {}).map(
                ([key, value]) => [
                  key,
                  value &&
                  typeof value === "object" &&
                  !Array.isArray(value) &&
                  typeof value.input_ref === "string"
                    ? field({ data: c.instance.data }, value.input_ref)
                    : value,
                ],
              ),
            ),
            phase: c.phase,
          }
        : null,
      assertions: this.run.instances.flatMap((i) =>
        i.steps.filter((s) => s.assertion).map((s) => s.assertion),
      ),
      next: !this.planned
        ? "理解任务并提交test_submit_plan；信息不足时正常追问"
        : c
          ? "完成当前动作、test_capture、test_finish_step"
          : "调用test_finish生成报告并在回复中给出链接",
    };
  }
  private bind(id: string, name: string, args: unknown): void {
    if (!this.current || this.calls.has(id) || this.reportReady) return;
    const call: CallRecord = {
      call_id: id,
      binding: { ...this.current.binding },
      name,
      args_redacted: this.recorder.sanitize(args),
      started_at: new Date().toISOString(),
      body_started: "unknown",
    };
    this.calls.set(id, call);
    this.current.result.calls.push(call);
    this.recorder.event("tool_bound", call, call.binding, "bound:" + id);
  }
  private settle(id: string, result: ToolExecutionResult): void {
    const call = this.calls.get(id);
    if (!call || call.finished_at) return;
    if (this.closed) {
      this.recorder.event(
        "late_tool_result",
        { call_id: id, result },
        call.binding,
      );
      return;
    }
    call.finished_at = new Date().toISOString();
    call.isError = result.isError;
    call.result = this.recorder.sanitize(result);
    this.recorder.event("tool_finished", call, call.binding, "finished:" + id);
    this.save();
    if (this.reportReady)
      writeReport(
        this.recorder.directory,
        this.recorder.sanitize(this.run) as unknown as SuiteRun,
      );
  }
  async call(name: string, args: unknown, parent: ToolRunContext) {
    const id = ToolCallId(randomUUID());
    this.bind(id, name, args);
    const result = await this.agent.ctx.tools.execute({
      callId: id,
      rootCallId: parent.rootCallId,
      parent: parent.token,
      name,
      arguments: args,
      agent: this.agent,
      signal: parent.signal,
    });
    this.settle(id, result);
    if (this.closed) throw new Error("测试已封存，迟到结果不改变最终事实");
    return { callId: id, result };
  }
  stop(reason = "用户停止"): void {
    if (this.closed || this.reportReady) return;
    this.cancelled = true;
    this.run.lifecycle = "CANCELLING";
    this.run.manifest.stop_reason = reason;
    if (reason !== "用户停止") this.run.incomplete = true;
    this.recorder.event("stop_requested", { session_id: this.id, reason });
    this.agent.cancel({ kind: "user" });
    this.armStopDeadline();
    if (this.agent.status === "idle")
      void this.turnEnded(true).catch((error) => this.emergency(error));
  }
  private async turnEnded(aborted: boolean): Promise<void> {
    if (this.closed || this.finalizing) return;
    this.finalizing = true;
    try {
      if (aborted) {
        this.cancelled = true;
        this.run.lifecycle = "CANCELLING";
      }
      // 事件表示原生轮次结束；whenIdle只用于确认同一Agent的在途操作已经排空。
      if (aborted) this.armStopDeadline();
      await this.agent.whenIdle();
      if (this.closed) return;
      if (this.stoppingTimer) clearTimeout(this.stoppingTimer);
      if (this.reportReady) {
        this.dispose();
        return;
      }
      if (!aborted && !this.planned) {
        if (this.timer) clearTimeout(this.timer);
        return;
      }
      if (aborted) {
        this.cancelled = true;
        this.run.lifecycle = "CANCELLING";
      }
      if (
        this.pendingTools.size ||
        [...this.calls.values()].some((c) => !c.finished_at)
      ) {
        this.owner.quarantine(this.run, "在途工具未结算");
        this.run.incomplete = true;
        this.emergency("原生轮次结束后仍有未结算工具，不能启动清理");
        return;
      }
      if (this.cleanupTurn) {
        this.emergency("清理轮次未正常完成");
        return;
      }
      if (this.current)
        this.finishStep(
          aborted ? "CANCELLED" : "ERROR",
          aborted ? "用户停止" : "模型结束轮次但未结算步骤",
        );
      this.cancelled = true;
      for (const i of this.run.instances) i.cancelled = aborted;
      if (!this.planned && this.planningBrowser) {
        const plan = {
          ...this.run.plan,
          cases: [
            {
              case_id: "planning",
              name: "规划阶段停止",
              datasets: [{ data_id: "default", inputs: {}, expected: {} }],
              preconditions: [],
              steps: [],
              cleanup: [],
            },
          ],
        };
        this.run.instances = expand(plan);
        const instance = this.run.instances[0];
        instance.session_id = instance.cleanup_session_id = this.id;
        instance.cancelled = true;
        instance.resources.browser_context = { id: this.id, state: "exists" };
        this.entries.push({
          instance,
          step: closeStep("__close", "释放规划阶段浏览器"),
          phase: "cleanup",
        });
        this.planned = true;
      }
      this.cleanupTurn = true;
      this.nudges = 0;
      this.advance();
      if (!this.current) {
        this.finish();
        this.dispose();
        return;
      }
      this.agent.followup(
        notice(
          "测试已停止业务动作；在途工具已结算。现在仅执行test_current指定的冻结清理步骤（禁止业务步骤和新增目标）。按当前步骤完成清理、test_capture、test_finish_step，最后test_finish，并在正常回复中说明取消结果和报告链接。",
        ),
      );
    } finally {
      this.finalizing = false;
    }
  }
  private finish(): unknown {
    if (!this.reportReady) {
      for (const i of this.run.instances) {
        if (this.run.incomplete) {
          i.incomplete = true;
          i.issues.push(
            String(this.run.manifest.stop_reason ?? "运行未完整结算"),
          );
        }
        if (i.resources.browser_context?.state === "exists") {
          i.resource_quarantined = true;
          this.owner.quarantine(this.run, "浏览器释放未获确认");
        }
        i.status = aggregate(i);
        i.lifecycle = "FINISHED";
      }
      this.run.lifecycle = "FINISHED";
      this.run.finished_at = new Date().toISOString();
      this.save();
      writeReport(
        this.recorder.directory,
        this.recorder.sanitize(this.run) as unknown as SuiteRun,
      );
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
      message:
        "请在正常最终回复中提供以上统计、断言实际/预期、保存位置和Markdown报告链接。报告为静态HTML，可离线打开。",
    };
  }
  private requireSettled(exec: ToolRunContext): void {
    if ([...this.pendingTools].some((id) => id !== exec.callId))
      throw new Error("其他工具尚未结算");
  }
  private cleanupAllowed(
    exec: Pick<ToolRunContext, "name" | "parent">,
  ): boolean {
    if (
      [
        "test_capture",
        "test_current",
        "test_finish_step",
        "test_fail_step",
        "test_finish",
      ].includes(exec.name)
    )
      return true;
    const action =
      this.current?.phase === "cleanup" ? this.current.step.action : undefined;
    if (!action) return false;
    if (action.capability === "browser") {
      if (
        Object.values(action.capture ?? {}).every(
          (c) => c.kind === "browser_close",
        )
      )
        return !!exec.parent && exec.name === "mcp__playwright__browser_close";
      return (
        exec.name.startsWith("mcp__playwright__") &&
        ![
          "mcp__playwright__browser_run_code",
          "mcp__playwright__browser_install",
        ].includes(exec.name)
      );
    }
    return action.capability === "api" && exec.name === "test_api_get";
  }
  private armStopDeadline(): void {
    if (this.stoppingTimer) return;
    this.stoppingTimer = setTimeout(() => {
      if (this.closed) return;
      this.owner.quarantine(this.run, "停止等待在途操作超时，禁止启动清理");
      this.emergency(
        "在途操作未在取消宽限期内结算，请人工确认外部停止并重置环境",
      );
    }, this.owner.config.cancelGraceMs);
  }
  private save(): void {
    this.recorder.snapshot(this.run);
  }
  private emergency(error: unknown): void {
    this.run.incomplete = true;
    if (this.current) this.finishStep("ERROR", String(error));
    for (const i of this.run.instances) {
      i.incomplete = true;
      i.issues.push(String(error));
    }
    try {
      this.finish();
    } finally {
      this.dispose();
    }
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.stoppingTimer) clearTimeout(this.stoppingTimer);
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
  }
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.finalizing = true;
    this.agent.cancel({ kind: "user" });
    this.owner.quarantine(this.run, "插件卸载，需确认外部操作停止和环境重置");
    this.emergency("插件卸载，测试中断；不再派发工具");
  }
}
