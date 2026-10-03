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
import type {} from "@deepseek-ai/dsh-plan-mode/types";
import type {} from "@deepseek-ai/dsh-session-projection";
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
  actionSchema,
  assertionSchema,
  statistics,
  captureSchema,
  validateCaptures,
  type Capture,
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
import {
  parseTextPlan,
  textPlanSchema,
  textReview,
  validateTextExpectation,
} from "./text-plan.js";
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
const guide = `当前对话已启用测试增强，仍由本会话正常推理、工具调用、审批、追问和回复完成任务，不创建其他会话或后台任务。
规划阶段只根据用户描述分析目标、业务步骤、输入和预期。禁止访问网站、运行命令、调用API或提前验证用例；不能通过预跑寻找选择器。只可使用test_submit_plan、test_current、todo_write和ask_user_question。已给目标、输入和预期时直接形成计划；缺少必要信息时在本会话追问。
test_submit_plan只提交{name,steps:[{description,checks?:string[]}]}。把用户的一段话按常规理解拆成几个业务动作短句，checks只写用户预期的自然语言。不要提供suite_id、cases、工具、选择器、能力类型、URL白名单、输出Schema、字段路径或比较器；不要为了未知页面结构追问用户。例如steps:[{description:"访问ceshiren.com"},{description:"搜索agent"},{description:"打开第一条搜索结果"},{description:"查看帖子的点赞数",checks:["点赞数不为0"]}]。用户没有提供的操作细节无需在规划期补齐。
文字计划执行：每次只处理test_current的当前步骤。需要操作目标时先test_define_step({capability:"browser"或"api",allowed_targets:[本步目标网址],reason:"当前步骤依据"})设定操作范围，无需填写outputs。随后使用原生工具观察、操作、调整；了解实际页面后直接test_capture采集。采集时插件按采集方式自动登记输出类型，无需先写输出Schema；已有成功观察不可覆盖，但可补采其他输出。API通常以response保存完整响应。不是在执行开始时编译整份计划，不能配置未来步骤。
文字检查点：获得可信观察后，对当前步骤的每个checks，调用test_bind_check({check_index:从0开始,assertion:{observation_ref:"step_编号.输出名.可选嵌套路径",operator:"eq/neq/...",expected_json:"用户预期的JSON文本，如0或\\\"agent\\\""}})。也可用expected_observation_ref比较前一步观察（例如第一条搜索结果链接）。rule_ref由插件绑定文字检查点；不用提交actual。预期来自原文和文字检查，不能按实际值改写；数字不为0用neq和expected_json字符串"0"（按JSON解析后为数字0，不是数组或对象）。每个文字检查都必须绑定程序断言，不能靠口头宣布通过；纯检查步骤可以直接引用前一步的可信观察。绑定后test_finish_step结算当前步骤并计算断言。无法完成用test_fail_step说明原因。
执行阶段：文字计划提交（/test-plan还需批准）后按test_current执行当前业务目标。此时才使用正常Playwright工具查看页面、点击、输入、等待和检查DOM，可根据实际状态调整定位、操作组合和重试，无需重跑整条用例；只完成当前步骤，不提前执行后续步骤。browser_evaluate可用于实际页面结构检查，断言实际值仍只接受test_capture可信采集。JSON文件计划已提交时直接按test_current继续，不能重复提交计划或预跑。
运行时采集：完成当前动作后，按页面/接口实际情况调用test_capture({capture:{输出名:采集定义},reason:"依据当前页面选择或修正定位的原因"})。它不接受actual或任意执行代码。dom mode支持text/number/count/visible/url/attribute/value；selector为真实CSS，可用index定位集合。页面路径用{kind:"dom",mode:"url",field:"pathname"}；元素href用{kind:"dom",mode:"attribute",attribute:"href",selector:"实际选择器",index:0,field:"pathname"}；数字用mode:number；文本框用mode:value；http仅用于返回JSON的GET接口。HTTP采集本身会发送请求，直接调用test_capture，无需先用test_api_get预发一次。完整响应为{status:number,body:JSON}，不含headers；可声明单一object输出，用{kind:"http",url:"授权URL",field:""}一次采集，再通过step_id.output_name.status及step_id.output_name.body的嵌套路径断言。必要输出都要采集。采集定义可根据实际页面修正，保留每次原因和调用记录；已有成功观察不可覆盖，只补采尚缺的输出。不能改变输出含义、输出类型、目标范围或断言预期。静态JSON的capture和自动清理已有采集定义，直接test_capture({})即可。
采集成功后调用test_finish_step；程序计算断言，模型不能填写实际值或口头改判。定位失败可修正重试；确实无法完成时test_fail_step说明原因。用户停止后不再执行业务，只按同会话收尾指导执行预授权清理。全部完成调用test_finish，并在原生最终回复写明逐步结果、断言实际/预期、保存位置和工具返回的报告链接。BLOCKED、SKIPPED或缺证据不能写成通过。`;

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
  async start(
    agent: Agent,
    task: string,
    plan?: unknown,
    review = false,
  ): Promise<string> {
    if (!task.trim()) throw new Error("请提供动作、输入和可验证预期");
    if (agent.status !== "idle")
      throw new Error("请等待当前对话轮次结束后再启动测试");
    if (existsSync(join(this.config.outputRoot, "quarantine.json")))
      throw new Error(
        "共享环境处于隔离状态；确认外部操作已停止并重置后使用/test-release提交处置证据",
      );
    if ([...this.sessions.values()].some((s) => !s.closed))
      throw new Error("已有测试使用共享浏览器，请先结束或停止该测试");
    if (review && !this.ctx.commands.find(agent, "plan"))
      throw new Error(
        "/test-plan 需要宿主启用原生 dsh-plan-mode 和用户审核通道",
      );
    const test = new NativeTest(this, agent, task, review);
    this.sessions.set(agent.id, test);
    try {
      if (review) await test.enterPlanMode();
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
  private stoppingTimer?: ReturnType<typeof setTimeout>;
  private task: string;
  private draft?: SuiteRun["plan"];
  private reviewCall?: string;
  private reviewDismissed = false;
  private previousPlanMode?: boolean;
  constructor(
    private owner: NativeTests,
    agent: Agent,
    task: string,
    private review = false,
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
        plugin_version: "0.5.0",
        plan_review: review,
        execution: "native-conversation",
        origin_session_id: agent.id,
        tools_mode: "native",
      },
    };
  }
  get id(): string {
    return this.agent.id;
  }
  async enterPlanMode(): Promise<void> {
    // Web预设将planMode放在隔离组中；通过官方命令解析当前Agent的有效服务。
    const state = this.agent.ctx.sessionProjections.stateOf(
      this.agent.session,
      "plan",
    );
    this.previousPlanMode =
      state?.running?.wanted ?? state?.wanted ?? state?.active ?? false;
    await this.setPlanMode(true);
  }
  private async setPlanMode(active: boolean): Promise<void> {
    const executed = await this.owner.ctx.commands.execute(
      this.agent,
      active ? "/plan" : "/plan off",
      [],
      new AbortController().signal,
    );
    if (executed?.result.kind !== "success")
      throw new Error(executed?.result.text ?? "宿主未提供原生/plan命令");
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
            : guide +
              (this.review && !this.planned
                ? "\n本次为/test-plan：原生plan模式中只规划。test_submit_plan仅保存可修改草案，不会执行。提交成功后，将返回的review_markdown原样作为exit_plan_mode的plan参数展示审核。不要自行缩写或替换审核内容。用户要求修改时重新test_submit_plan再审核；同意后插件自动冻结已审草案并开始执行。关闭plan模式不代表批准。"
                : "") +
              "\n当前测试状态：" +
              JSON.stringify(this.state()),
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
      "提交本对话测试计划；/test-plan只保存待审核草案，其余入口直接冻结。从用户原文提取预期，不能提交实际结果。",
      textPlanSchema,
      (args) => this.submit(args),
    );
    tool(
      "test_current",
      "读取当前步骤、冻结目标、输入及已计算断言。",
      empty,
      () => this.state(),
    );
    tool(
      "test_define_step",
      "仅在执行当前文字步骤时确定能力与目标；观察页面后直接test_capture，输出由采集方式自动登记。",
      {
        type: "object",
        required: ["capability", "allowed_targets", "reason"],
        additionalProperties: false,
        properties: {
          capability: actionSchema.properties.capability,
          allowed_targets: actionSchema.properties.allowed_targets,
          reason: { type: "string", minLength: 1 },
        },
      },
      async (args, exec) => {
        this.requireSettled(exec);
        const c = this.current;
        if (!c || c.phase !== "test" || c.step.checks === undefined)
          throw new Error(
            "仅当前文字步骤可以在运行时定义，不能修改JSON计划或未来步骤",
          );
        if (
          c.result.observations.length ||
          c.instance.effective_steps.some(
            (s) =>
              s.step_id.startsWith(c.step.step_id + "_check_") && s.assertion,
          )
        )
          throw new Error("本步已有观察或断言，不能重写定义");
        const step: Step = {
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
        const effective = c.instance.effective_steps.map((s) =>
          s.step_id === step.step_id ? step : s,
        );
        this.validateEffective(c.instance, effective);
        c.step = step;
        c.instance.effective_steps = effective;
        this.recorder.event(
          "step_defined",
          { step, reason: args.reason },
          c.binding,
        );
        if (
          args.capability === "browser" &&
          !c.instance.resources.browser_context
        ) {
          // 直到实际遇到浏览器步骤才初始化；接口步骤不触碰浏览器。
          c.instance.resources.browser_context = {
            id: this.id,
            state: "exists",
          };
          const after = this.entries.findIndex(
            (e, n) => n >= this.cursor && e.instance !== c.instance,
          );
          this.entries.splice(after < 0 ? this.entries.length : after, 0, {
            instance: c.instance,
            phase: "cleanup",
            step: closeStep("__close", "关闭并确认浏览器上下文释放"),
          });
          this.save();
          const reset = await this.call(
            "mcp__playwright__browser_close",
            {},
            exec,
          );
          if (reset.result.isError) {
            this.finishStep("ERROR", "初始化浏览器上下文失败");
            this.advance();
            throw new Error("浏览器初始化失败，已进入收尾");
          }
        }
        this.save();
        return this.state();
      },
    );
    tool(
      "test_bind_check",
      "把当前步骤的一个文字检查点绑定为程序断言；预期来自已批准文字，实际值只能引用可信观察，绑定后不能改判。",
      {
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
              observation_ref: assertionSchema.properties.observation_ref,
              operator: assertionSchema.properties.operator,
              expected_json: {
                type: "string",
                description:
                  '用户给出的预期，按JSON文本传递：数字用"0"，字符串用"\\\"agent\\\""，布尔用"true"；不是Schema，不包value对象。与expected_observation_ref二选一',
              },
              expected_observation_ref:
                assertionSchema.properties.expected_observation_ref,
              unit: assertionSchema.properties.unit,
              tolerance: assertionSchema.properties.tolerance,
            },
          },
        },
      },
      (args, exec) => {
        this.requireSettled(exec);
        const c = this.current;
        const text = c?.step.checks?.[args.check_index];
        if (!c || c.phase !== "test" || !text)
          throw new Error("当前步骤没有此文字检查点");
        const id = `${c.step.step_id}_check_${args.check_index + 1}`;
        if (c.instance.effective_steps.some((s) => s.step_id === id))
          throw new Error("检查点已经绑定，不能改写预期");
        const { expected_json, ...definition } = args.assertion;
        const step: Step = {
          step_id: id,
          kind: "assertion",
          description: text,
          required: true,
          depends_on: [c.step.step_id],
          assertion: {
            ...definition,
            ...(expected_json === undefined
              ? {}
              : { literal: JSON.parse(expected_json) }),
            rule_ref: id,
          },
        };
        validateTextExpectation(text, step.assertion!);
        const effective = [...c.instance.effective_steps];
        const position = effective.findIndex(
          (s) => s.step_id === c.step.step_id,
        );
        effective.splice(position + 1, 0, step);
        this.validateEffective(c.instance, effective);
        c.instance.effective_steps = effective;
        this.entries.splice(this.cursor, 0, {
          instance: c.instance,
          phase: "test",
          step,
        });
        this.recorder.event(
          "check_bound",
          { step, check_index: args.check_index },
          c.binding,
        );
        this.save();
        return this.state();
      },
    );
    tool(
      "test_capture",
      "执行可信采集。运行时绑定传capture与reason，只能补采尚缺输出；固定计划和清理传空对象。",
      {
        type: "object",
        properties: {
          capture: captureSchema,
          reason: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      async (args, exec) => {
        const c = this.current;
        if (!c?.step.action) throw new Error("没有当前采集步骤");
        this.requireSettled(exec);
        let action = c.step.action;
        let captures = action.capture ?? {};
        if (action.capture_mode === "runtime") {
          if (
            !args.capture ||
            !Object.keys(args.capture).length ||
            !args.reason?.trim()
          )
            throw new Error(
              "请根据当前页面提供capture及reason；不要提交实际值",
            );
          if (c.step.checks !== undefined) {
            const outputs = { ...action.outputs };
            for (const [name, value] of Object.entries(args.capture) as [
              string,
              Capture,
            ][]) {
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
                  : {};
            }
            const nextAction = {
              ...action,
              outputs,
              completion_requirements: Object.keys(outputs),
            };
            validateCaptures(nextAction, args.capture);
            const step = { ...c.step, action: nextAction };
            const effective = c.instance.effective_steps.map((s) =>
              s.step_id === c.step.step_id ? step : s,
            );
            this.validateEffective(c.instance, effective);
            c.step = step;
            c.instance.effective_steps = effective;
            action = nextAction;
            this.recorder.event(
              "step_defined",
              { step, reason: "依据当前采集方式登记输出：" + args.reason },
              c.binding,
            );
          }
          validateCaptures(action, args.capture);
          for (const name of Object.keys(args.capture))
            if (c.result.observations.some((o) => o.output_name === name))
              throw new Error(
                "已有可信观察不能覆盖: " + name + "；只补采缺少的输出",
              );
          captures = structuredClone(args.capture);
        } else if (args.capture) {
          throw new Error("该步骤使用固定采集定义，请传空对象");
        }
        if (
          !Object.keys(captures).some(
            (name) =>
              !c.result.observations.some((o) => o.output_name === name),
          )
        )
          throw new Error("本步骤已有观察，不能覆盖");
        const attempt: NonNullable<StepResult["capture_attempts"]>[number] = {
          capture: captures as Record<string, Capture>,
          reason: args.reason ?? "使用计划中的固定采集定义",
          started_at: new Date().toISOString(),
        };
        (c.result.capture_attempts ??= []).push(attempt);
        this.recorder.event("capture_configured", attempt, c.binding);
        this.save();
        try {
          await captureStep(
            this,
            this.recorder,
            this.run,
            { ...c.step, action: { ...action, capture: captures } },
            c.result,
            c.binding,
            exec,
          );
        } catch (error) {
          attempt.error = String(error);
          this.recorder.event(
            "capture_failed",
            { error: attempt.error },
            c.binding,
          );
          throw error;
        } finally {
          this.save();
        }
        return {
          observations: c.result.observations.map((o) => ({
            name: o.output_name,
            value: o.value,
          })),
          missing: action.completion_requirements.filter(
            (name) =>
              !c.result.observations.some((o) => o.output_name === name),
          ),
          next: "如有缺少输出，按实际页面修正后只补采缺少输出；完整后test_finish_step",
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
        const pending = (c.step.checks ?? []).filter(
          (_, n) =>
            !c.instance.effective_steps.some(
              (s) =>
                s.step_id === `${c.step.step_id}_check_${n + 1}` && s.assertion,
            ),
        );
        if (pending.length)
          throw new Error("尚未绑定文字检查点: " + pending.join("；"));
        if (!c.step.action && !c.step.checks?.length)
          throw new Error("请先根据当前情况配置并完成本步骤");
        if (
          !(c.step.action?.completion_requirements ?? []).every((n) =>
            c.result.observations.some((o) => o.output_name === n),
          )
        )
          throw new Error("缺少必要观察；先完成动作并调用test_capture");
        if (
          c.step.action &&
          !c.step.action.completion_requirements.length &&
          !c.step.checks?.length &&
          !c.result.calls.some(
            (call) =>
              !call.name.startsWith("test_") &&
              call.finished_at &&
              !call.isError &&
              !call.name.endsWith("browser_close"),
          )
        )
          throw new Error("尚无本步骤实际动作或可信观察，不能只配置后宣布完成");
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
      "内部HTTP GET采集工具，仅供test_capture子调用；模型直接使用test_capture发送请求并保存可信响应。",
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
          if (this.review && !this.planned && exec.name === "exit_plan_mode")
            this.reviewCall = exec.callId;
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
        if (exec.callId === this.reviewCall) {
          this.reviewCall = undefined;
          this.reviewDismissed = result.isError;
          if (
            !result.isError &&
            (result.value as { approved?: boolean })?.approved === true &&
            !this.cancelled &&
            !this.closed &&
            this.draft
          ) {
            this.recorder.event("plan_approved", { call_id: exec.callId });
            this.freeze(this.draft);
          }
        }
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
          !this.planned &&
          ![
            "test_submit_plan",
            "test_current",
            "todo_write",
            "ask_user_question",
            ...(this.review ? ["exit_plan_mode"] : []),
          ].includes(exec.name)
        )
          return "规划阶段禁止执行：请仅根据用户描述提交业务计划，运行后再识别页面并调整操作";
        if (this.review && !this.planned && exec.name === "exit_plan_mode") {
          if (!this.draft) return "请先test_submit_plan保存待审核草案";
          if (
            (exec.arguments as { plan?: string }).plan !== this.reviewMarkdown()
          )
            return "审核内容必须与草案一致；请将test_current返回的review_markdown原样传给exit_plan_mode";
        }
        if (
          this.current?.step.kind === "intent" &&
          ![
            "test_define_step",
            "test_bind_check",
            "test_current",
            "test_finish_step",
            "test_fail_step",
            "ask_user_question",
            "todo_write",
          ].includes(exec.name)
        )
          return "请在当前步骤调用test_define_step确定操作目标；不需要提前定义未来步骤";
        if (this.planned && exec.name === "test_api_get" && !exec.parent)
          return "HTTP请求由test_capture发送并记录，请勿预先直接请求；用一个response对象观察供多个断言引用";
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
          this.reportReady ||
          (this.cancelled && !this.cleanupTurn)
        )
          return;
        if (!this.planned) {
          if (this.review && !this.reviewDismissed && this.nudges++ < 2)
            agent.steer(
              notice(
                "本次/test-plan必须通过原生审核卡片确认。请先test_submit_plan保存草案，再将review_markdown原样交给exit_plan_mode；不要只输出文字计划或等待口头同意。这些工具只记录计划和审核，不执行业务。缺少必要信息时正常追问。",
              ),
            );
          return;
        }
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
    return this.review
      ? "已在当前对话进入plan模式；先规划并展示审核，用户同意后才执行测试。"
      : "测试已在当前对话启动；执行步骤、工具结果和最终报告将在本对话中显示。";
  }
  submit(input: unknown, trustedFile = false): unknown {
    if (this.planned) throw new Error("计划已冻结；不能替换预期");
    const plan = trustedFile
      ? parsePlan(input)
      : parseTextPlan(input, this.task, this.id);
    if (this.timer) clearTimeout(this.timer);
    if (this.review) {
      this.draft = plan;
      this.reviewDismissed = false;
      this.recorder.event("plan_drafted", { plan });
      this.recorder.json("plan-draft.json", plan);
      this.save();
      return this.state();
    }
    return this.freeze(plan);
  }
  private validateEffective(instance: CaseRun, steps: Step[]): void {
    const original = this.run.plan.cases.find(
      (c) => c.case_id === instance.case_id,
    )!;
    parsePlan({ ...this.run.plan, cases: [{ ...original, steps }] }, true);
  }
  private reviewMarkdown(): string {
    if (!this.draft) return "";
    return textReview(this.draft);
  }
  private freeze(plan: SuiteRun["plan"]): unknown {
    if (this.timer) clearTimeout(this.timer);
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
          : this.draft
            ? "reviewing"
            : "planning",
      ...(this.review && !this.planned && this.draft
        ? { review_markdown: this.reviewMarkdown() }
        : {}),
      current: c
        ? {
            instance: c.instance.case_run_id,
            step: c.step,
            checks: (c.step.checks ?? []).map((text, n) => ({
              check_index: n,
              text,
              bound: c.instance.effective_steps.some(
                (s) =>
                  s.step_id === `${c.step.step_id}_check_${n + 1}` &&
                  s.assertion,
              ),
            })),
            observations: c.instance.steps.flatMap((s) =>
              s.observations.map((o) => ({
                ref: `${s.step_id}.${o.output_name}`,
                value: o.value,
              })),
            ),
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
        ? this.draft
          ? "将review_markdown原样传入exit_plan_mode的plan参数，由原生审核等待用户批准；修改时重新test_submit_plan"
          : "理解任务并提交test_submit_plan；信息不足时正常追问"
        : c
          ? c.step.checks !== undefined
            ? "只执行当前文字步骤：test_define_step确定本步目标，观察操作后test_capture；逐项test_bind_check，最后test_finish_step"
            : "完成当前动作、test_capture、test_finish_step"
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
      if (!this.planned) {
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
        })[0]!;
        instance.session_id = this.id;
        instance.cancelled = aborted;
        this.run.instances.push(instance);
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
    if (this.previousPlanMode !== undefined && !this.planned)
      void this.setPlanMode(this.previousPlanMode).catch((error) =>
        this.owner.ctx.logger.warn("恢复计划模式失败: %s", String(error)),
      );
  }
  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.finalizing = true;
    this.agent.cancel({ kind: "user" });
    this.owner.quarantine(this.run, "插件卸载，需确认外部操作停止和环境重置");
    this.emergency("插件卸载，测试中断；不再派发工具");
  }
}
