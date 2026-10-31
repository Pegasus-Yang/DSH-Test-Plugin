/** 当前 Agent 业务工具的运行快照；不按厂商或方法名前缀判定能力。 */
import { createHash } from "node:crypto";
/** 连接配置只保存摘要；地址、启动环境及凭据均不复制到目录。 */
export function toolConnections(ctx) {
    return (ctx.get?.("configEditor")?.entries() ?? [])
        .filter((entry) => entry.options.name === "@deepseek-ai/dsh-mcp-client")
        .map((entry) => {
        const config = entry.options.config;
        return {
            id: entry.options.id,
            prefix: `mcp__${config.serverName}__`,
            digest: createHash("sha256")
                .update(JSON.stringify(config))
                .digest("hex"),
        };
    });
}
const controls = new Set([
    "ask_user_question",
    "todo_write",
    "enter_plan_mode",
    "exit_plan_mode",
    "test_api_get",
    "test_bind_check",
    "test_capture",
    "test_current",
    "test_define_step",
    "test_execute_operation",
    "test_fail_step",
    "test_finish",
    "test_finish_step",
    "test_propose_checkpoint",
    "test_submit_plan",
]);
export function businessTool(name) {
    return !controls.has(name);
}
function digest(tool) {
    return createHash("sha256")
        .update(JSON.stringify([tool.name, tool.description, tool.parameters]))
        .digest("hex");
}
export class TestToolCatalog {
    tools;
    connections;
    preferred;
    scope;
    entries = new Map();
    constructor(tools, reserved = [], connections = [], preferred, scope) {
        this.tools = tools;
        this.connections = connections;
        this.preferred = preferred;
        this.scope = scope;
        for (const schema of tools.schemas(scope)) {
            if (!businessTool(schema.name) || reserved.includes(schema.name))
                continue;
            const definition = tools.get(schema.name, scope);
            if (definition)
                this.entries.set(schema.name, {
                    definition,
                    digest: digest(definition),
                });
        }
    }
    names() {
        return this.snapshot()
            .sort((a, b) => Number(b.connection?.id === this.preferred) -
            Number(a.connection?.id === this.preferred))
            .map((e) => e.name);
    }
    snapshot() {
        return [...this.entries].map(([name, entry]) => ({
            name,
            description: entry.definition.description,
            parameters: entry.definition.parameters,
            digest: entry.digest,
            ...(this.connections.find((connection) => name.startsWith(connection.prefix))
                ? {
                    connection: this.connections.find((connection) => name.startsWith(connection.prefix)),
                }
                : {}),
        }));
    }
    has(name) {
        return this.entries.has(name);
    }
    assert(name) {
        const entry = this.entries.get(name), current = this.tools.get(name, this.scope);
        if (!entry || !current)
            throw new Error("工具不在本轮业务工具目录中: " + name);
        if (entry.definition !== current || entry.digest !== digest(current))
            throw new Error("工具定义或连接已改变，不能继续沿用旧调用: " + name);
    }
}
/** 参数只按 JSON 解释；复杂数组可通过字符串绕开旧宿主的对象转换。 */
export function toolArguments(input) {
    if ((input.arguments !== undefined) === (input.arguments_json !== undefined))
        throw new Error("请仅提供 arguments 参数对象或 arguments_json 完整 JSON 字符串中的一种");
    let value = input.arguments;
    if (input.arguments_json !== undefined) {
        try {
            value = JSON.parse(input.arguments_json);
        }
        catch {
            throw new Error("arguments_json 必须是有效 JSON，不执行表达式");
        }
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("原工具参数必须是 JSON 对象");
    return value;
}
