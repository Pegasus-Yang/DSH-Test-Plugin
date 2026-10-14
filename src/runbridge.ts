/** RunBridge 工具绑定到当前 Agent，使用公开 DSH MCP 工具投影。 */
import { readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { createMcpToolDefinition } from "@deepseek-ai/dsh-mcp-client";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { BrowserPreferences } from "./browser-preferences.js";
import { ajv, field, type BrowserResource } from "./contracts.js";

export const runbridgePrefix = "mcp__runbridge__";
/** 技术终态与业务结果分别判断；只有 Node 的 COMPLETE 能确认清理。 */
export function remoteCleanupComplete(session: unknown): boolean {
  return (
    ["CLOSED", "FAILED", "INTERRUPTED"].includes(
      String(field(session, "state")),
    ) && field(session, "cleanup") === "COMPLETE"
  );
}
/** 只有原请求的确定未分配终态可以作为不存在资源的证据。 */
function requestNotStarted(
  request: unknown,
  reference: BrowserResource["remote"],
): boolean {
  return (
    !!reference?.request_id &&
    field(request, "request_id") === reference.request_id &&
    field(request, "node_id") === reference.node_id &&
    field(request, "grant_id") === reference.grant_id &&
    field(request, "state") === "FAILED" &&
    field(request, "session_id") === null &&
    field(request, "execution_outcome") === "NOT_STARTED"
  );
}
/** 普通收尾与隔离恢复复用实际清理或确定未分配的同一证据。 */
export function remoteReleaseConfirmed(
  data: unknown,
  resource?: BrowserResource,
): boolean {
  const reference = resource?.remote;
  if (!reference || resource?.state !== "absent") return false;
  const session = field(data, "session");
  if (reference.session_id)
    return (
      remoteCleanupComplete(session) &&
      field(session, "session_id") === reference.session_id &&
      field(session, "node_id") === reference.node_id &&
      field(session, "grant_id") === reference.grant_id
    );
  const sessions = field(data, "sessions");
  return (
    session === undefined &&
    Array.isArray(sessions) &&
    sessions.length === 0 &&
    requestNotStarted(field(data, "request"), reference)
  );
}
const managed = new Set([
  "node_id",
  "session_id",
  "page_id",
  "resource_id",
  "lease_seconds",
  "request_id",
]);
export function runbridgeResult(value: unknown): Record<string, any> {
  const structured = field(value, "structuredContent");
  let data = structured;
  if (data === undefined) {
    const blocks = field(value, "content");
    if (!Array.isArray(blocks)) throw new Error("RunBridge 缺少规范工具内容");
    data = JSON.parse(
      blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n"),
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("RunBridge 结果不是结构化对象");
  return data as Record<string, any>;
}

export interface RunBridgeAccess {
  hub_url: string;
  node_id: string;
  grant_id: string;
  access_token: string;
}
/** 读取配置时不回显原值，业务站点不会收到 Hub 凭据。 */
export function readRunBridgeAccess(path: string): RunBridgeAccess {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("无法读取 RunBridge 私有访问文件，请检查路径和 JSON 格式");
  }
  const result = data as RunBridgeAccess;
  if (
    !result ||
    !["hub_url", "node_id", "grant_id", "access_token"].every(
      (key) => typeof field(result, key) === "string" && !!field(result, key),
    )
  )
    throw new Error(
      "RunBridge 访问文件缺少连接地址、节点、grant 或 access_token",
    );
  let url: URL;
  try {
    url = new URL(result.hub_url);
  } catch {
    throw new Error("RunBridge Hub 地址无效");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result.node_id) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(result.grant_id) ||
    result.access_token.length < 32 ||
    result.access_token.length > 256
  )
    throw new Error("RunBridge 私有连接配置不符合服务合同");
  return { ...result, hub_url: url.href.replace(/\/$/, "") };
}
export function hubPath(base: string, path: string): URL {
  return new URL(base.replace(/\/$/, "") + "/" + path.replace(/^\//, ""));
}

export class RunBridge {
  readonly prefix = runbridgePrefix;
  readonly access: RunBridgeAccess;
  readonly config: BrowserPreferences;
  private readonly accessFile: string;
  resource?: BrowserResource;
  private client = new Client(
    { name: "dsh-test-plugin", version: "0.12.1" },
    { capabilities: {} },
  );
  private definitions: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
  private connected = false;
  private disposing?: Promise<void>;
  private readonly outcomes = new Map<string, string>();
  constructor(
    config: BrowserPreferences,
    private readonly workspace: string,
    private readonly changed: () => void = () => {},
  ) {
    this.config = { ...config };
    if (
      !Number.isInteger(config.leaseSeconds) ||
      config.leaseSeconds < 1 ||
      config.leaseSeconds > 3600
    )
      throw new Error("远程浏览器租期须为 1 到 3600 秒的整数");
    this.accessFile = resolve(workspace, config.accessFile);
    this.access = readRunBridgeAccess(this.accessFile);
  }
  async connect(): Promise<void> {
    const transport = new StreamableHTTPClientTransport(
      hubPath(this.access.hub_url, "/mcp"),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${this.access.access_token}` },
        },
      },
    );
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        this.client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("RunBridge MCP 连接超时")),
            15000,
          );
        }),
      ]);
      this.definitions = (await this.client.listTools()).tools;
      for (const name of [
        "browser_start",
        "browser_stop",
        "browser_status",
        "browser_snapshot",
        "browser_capture",
        "browser_click",
        "browser_fill",
        "browser_screenshot",
      ])
        if (!this.definitions.some((t) => t.name === name))
          throw new Error("RunBridge MCP 缺少所需工具：" + name);
      this.connected = true;
    } catch {
      await this.client.close().catch(() => {});
      throw new Error(
        "RunBridge MCP 接入失败，请核对服务启用状态、许可、版本和网络；未申请浏览器",
      );
    } finally {
      clearTimeout(timer!);
    }
  }
  register(ctx: Context, only?: string[]): () => void {
    const disposers: (() => void)[] = [];
    try {
      for (const tool of this.definitions) {
        if (only && !only.includes(tool.name)) continue;
        const inputSchema = structuredClone(tool.inputSchema) as Record<
          string,
          any
        >;
        for (const name of managed) {
          if (name === "page_id" && tool.name === "browser_tabs") continue;
          delete inputSchema.properties?.[name];
          if (Array.isArray(inputSchema.required))
            inputSchema.required = inputSchema.required.filter(
              (key: string) => key !== name,
            );
        }
        inputSchema.additionalProperties = false;
        if (tool.name === "browser_file_upload")
          inputSchema.properties.files = {
            type: "array",
            items: { type: "string" },
            maxItems: 32,
            description:
              "本机工作区中的文件路径；由插件读取并发送，空列表清空上传。合计最多 4 MiB。",
          };
        const validate = ajv.compile(inputSchema);
        disposers.push(
          ctx.tools.register(
            createMcpToolDefinition(ctx, {
              name: this.prefix + tool.name,
              rawName: tool.name,
              description: tool.description ?? tool.name,
              inputSchema,
              outputSchema: tool.outputSchema,
              call: (args, exec) => {
                for (const key of managed)
                  if (
                    key in args &&
                    !(key === "page_id" && tool.name === "browser_tabs")
                  )
                    throw new Error("远程身份参数由插件绑定，不能覆盖：" + key);
                if (!validate(args)) {
                  this.outcomes.set(exec.callId, "NOT_STARTED");
                  throw new Error(
                    "RunBridge 参数不符合工具 Schema：" +
                      ajv.errorsText(validate.errors) +
                      "；含数组的嵌套参数请用 arguments_json 原样提交 JSON 字符串，未请求远程执行。",
                  );
                }
                return this.invoke(tool.name, args, exec.signal, exec.callId);
              },
            }),
          ),
        );
      }
    } catch (error) {
      disposers.reverse().forEach((dispose) => dispose());
      throw error;
    }
    return () => disposers.reverse().forEach((dispose) => dispose());
  }
  private async invoke(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    callId?: string,
  ): Promise<unknown> {
    if (!this.connected) throw new Error("远程 MCP 连接已结束");
    for (const key of managed)
      if (key in args && !(key === "page_id" && name === "browser_tabs"))
        throw new Error("远程身份参数由插件绑定，不能覆盖：" + key);
    const parameters = { ...args };
    if (name === "browser_file_upload") {
      if (!Array.isArray(args.files) || args.files.length > 32)
        throw new Error("上传文件必须是最多 32 个本机路径");
      let total = 0;
      parameters.files = args.files.map((path: unknown) => {
        if (typeof path !== "string") throw new Error("上传文件须使用本机路径");
        const absolute = resolve(this.workspace, path);
        const stat = statSync(absolute);
        total += stat.size;
        if (!stat.isFile() || total > 4 * 1024 * 1024)
          throw new Error("上传文件合计不得超过 4 MiB");
        const types: Record<string, string> = {
          ".txt": "text/plain",
          ".csv": "text/csv",
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".pdf": "application/pdf",
        };
        const bytes = readFileSync(absolute);
        if (bytes.length !== stat.size)
          throw new Error("读取期间文件发生变化，请重新确认后上传");
        return {
          name: basename(absolute),
          mime_type:
            types[extname(absolute).toLowerCase()] ??
            "application/octet-stream",
          data: bytes.toString("base64"),
        };
      });
    }
    const resource = this.resource;
    if (name === "browser_start") {
      if (resource && resource.state !== "absent")
        throw new Error("当前远程浏览器尚未确认释放");
      this.resource = {
        id: randomUUID(),
        state: "unknown",
        remote: {
          hub_url: this.access.hub_url,
          access_file: this.accessFile,
          node_id: this.access.node_id,
          grant_id: this.access.grant_id,
          resource_id: this.config.resourceId,
        },
      };
      this.resource.remote!.request_id = this.resource.id;
      Object.assign(parameters, {
        node_id: this.access.node_id,
        lease_seconds: this.config.leaseSeconds,
        request_id: this.resource.id,
      });
      if (this.config.resourceId)
        parameters.resource_id = this.config.resourceId;
      this.changed();
    } else if (["node_inspect", "browser_sessions"].includes(name)) {
      parameters.node_id = this.access.node_id;
    } else {
      if (!resource?.remote) throw new Error("尚未启动本次远程浏览器");
      if (!resource.remote.session_id && name === "browser_stop") {
        const unallocated = await this.reconcile(signal);
        if (unallocated) return unallocated;
      }
      if (!resource.remote.session_id)
        throw new Error("本次启动结果未知，不能猜测会话身份");
      parameters.session_id = resource.remote.session_id;
      if (name === "browser_tabs" && parameters.action === "close")
        parameters.page_id ??= resource.remote.page_id;
      if (!["browser_stop", "browser_status", "browser_tabs"].includes(name)) {
        if (!resource.remote.page_id)
          throw new Error("请先通过 browser_tabs 明确选择本次页面");
        parameters.page_id = resource.remote.page_id;
      }
    }
    let result: Awaited<ReturnType<Client["callTool"]>>;
    try {
      result = await this.client.callTool(
        { name, arguments: parameters },
        { signal, timeout: name === "browser_start" ? 45000 : 35000 },
      );
    } catch {
      if (callId) this.outcomes.set(callId, "OUTCOME_UNKNOWN");
      throw new Error("远程工具响应未获确认，不能盲目重放写操作");
    }
    if (result.isError) {
      let data: Record<string, any> = {};
      try {
        data = runbridgeResult(result);
      } catch {
        /* 保留 SDK 的原始错误投影。 */
      }
      if (callId)
        this.outcomes.set(callId, data.execution_outcome ?? "OUTCOME_UNKNOWN");
      if (
        name === "browser_start" &&
        data.execution_outcome === "NOT_STARTED" &&
        [
          "NODE_OFFLINE",
          "NODE_OUTSIDE_GRANT",
          "RESOURCE_OUTSIDE_GRANT",
          "MANAGED_RESOURCE_REQUIRED",
          "RESOURCE_BUSY",
          "RESOURCE_NOT_READY",
          "PLAYWRIGHT_VERSION_MISMATCH",
          "REQUEST_RECORD_LIMIT",
          "REQUEST_CONCURRENCY_LIMIT",
        ].includes(data.code)
      ) {
        this.resource!.state = "absent";
        this.changed();
      }
    }
    if (!result.isError) {
      const data = runbridgeResult(result);
      if (name === "browser_start") {
        this.acceptSession(data.session);
        if (data.session.state !== "ACTIVE" || typeof data.page_id !== "string")
          throw new Error("远程浏览器没有返回有效活动页面");
        this.resource!.remote!.page_id = data.page_id;
        this.resource!.state = "exists";
        this.changed();
      } else if (name === "browser_tabs") {
        this.acceptSession(data.session);
        if (
          ["new", "select"].includes(String(parameters.action)) &&
          typeof data.page_id === "string"
        )
          this.resource!.remote!.page_id = data.page_id;
        else if (
          parameters.action === "close" &&
          parameters.page_id === this.resource!.remote!.page_id
        )
          delete this.resource!.remote!.page_id;
        this.changed();
      } else if (name === "browser_stop") {
        this.acceptSession(data.session);
        if (remoteCleanupComplete(data.session))
          this.resource!.state = "absent";
        else this.resource!.state = "unknown";
        this.changed();
      }
    }
    return result;
  }
  outcome(callId: string): string | undefined {
    return this.outcomes.get(callId);
  }
  private acceptSession(session: any): void {
    const reference = this.resource?.remote;
    if (
      !reference ||
      !session ||
      session.node_id !== reference.node_id ||
      session.grant_id !== reference.grant_id ||
      (reference.resource_id &&
        session.resource_id !== reference.resource_id) ||
      (reference.session_id && session.session_id !== reference.session_id) ||
      typeof session.session_id !== "string"
    )
      throw new Error("远程会话归属与本次运行不一致");
    Object.assign(reference, {
      session_id: session.session_id,
      resource_id: session.resource_id,
      connection_generation: session.connection_generation,
      expires_at: session.expires_at,
    });
    this.resource!.id = session.session_id;
  }
  restore(resource: BrowserResource): void {
    if (
      !resource.remote ||
      resource.remote.hub_url !== this.access.hub_url ||
      resource.remote.node_id !== this.access.node_id ||
      resource.remote.grant_id !== this.access.grant_id
    )
      throw new Error(
        "恢复配置与原远程资源不一致，请使用原许可或提交所有者的处置证据",
      );
    this.resource = structuredClone(resource);
  }
  private async reconcile(
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<Client["callTool"]>> | undefined> {
    const reference = this.resource!.remote!;
    if (!reference.request_id)
      throw new Error("本次启动记录缺少请求身份，隔离仍保留");
    const response = await this.client.callTool(
      {
        name: "browser_sessions",
        arguments: {
          node_id: this.access.node_id,
          request_id: reference.request_id,
        },
      },
      { signal, timeout: 10000 },
    );
    if (response.isError) throw new Error("无法核对本次远程启动的结果");
    const data = runbridgeResult(response);
    if (!Array.isArray(data.sessions))
      throw new Error("远程启动核对缺少会话列表，隔离仍保留");
    const matches = data.sessions.filter(
      (item: any) => item?.request_id === reference.request_id,
    );
    if (data.request !== undefined) {
      const request = data.request;
      if (
        field(request, "request_id") !== reference.request_id ||
        field(request, "node_id") !== reference.node_id ||
        field(request, "grant_id") !== reference.grant_id
      )
        throw new Error("远程请求归属与本次启动不一致，隔离仍保留");
      if (
        requestNotStarted(request, reference) &&
        data.sessions.length === 0 &&
        data.session === undefined
      ) {
        this.resource!.state = "absent";
        this.changed();
        return response;
      }
      if (
        !["PENDING", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(
          request.state,
        ) ||
        typeof request.session_id !== "string" ||
        !request.session_id ||
        data.sessions.length !== 1 ||
        matches.length !== 1 ||
        matches[0].session?.session_id !== request.session_id
      )
        throw new Error("远程请求结果未确认或与会话不一致，隔离仍保留");
    }
    if (matches.length !== 1)
      throw new Error("无法唯一确认本次启动的会话，隔离仍保留");
    this.acceptSession(matches[0].session);
    this.changed();
  }
  async close(): Promise<void> {
    if (!this.disposing) {
      this.connected = false;
      this.disposing = this.client.close().catch(() => {});
    }
    await this.disposing;
  }
}
