/** 可选的本轮资源合同；未配置时工具服务自行管理上下文。 */
import { Ajv } from "ajv";
import { toolExtractSchema } from "./tool-results.js";
import { businessTool, toolArguments } from "./tool-runtime.js";
const requestSchema = {
    type: "object",
    required: ["tool_name"],
    additionalProperties: false,
    properties: {
        tool_name: { type: "string", minLength: 1 },
        arguments: { type: "object" },
        arguments_json: { type: "string" },
    },
};
const validate = new Ajv({ allErrors: true, strict: false }).compile({
    type: "object",
    required: ["scope", "start", "close", "released"],
    additionalProperties: false,
    properties: {
        scope: { enum: ["connection", "resource"] },
        start: requestSchema,
        close: requestSchema,
        identity: toolExtractSchema,
        identity_argument: { type: "string", minLength: 1 },
        released: toolExtractSchema,
    },
});
export function validateToolResource(input) {
    if (!validate(input))
        throw new Error("资源生命周期配置无效: " + JSON.stringify(validate.errors));
    for (const request of [input.start, input.close]) {
        if (!businessTool(request.tool_name))
            throw new Error("资源工具不能使用测试控制入口");
        toolArguments(request);
    }
    if (input.scope === "resource" &&
        (!input.identity || !input.identity_argument))
        throw new Error("资源作用域需要真实身份提取及关闭参数名");
    if (input.identity_argument &&
        Object.hasOwn(toolArguments(input.close), input.identity_argument))
        throw new Error("关闭身份由原创建结果注入，不能预填另一资源");
}
export function toolResourceStep(config, close = false) {
    const request = close ? config.close : config.start;
    return {
        step_id: close ? "__resource_close" : "__resource_open",
        kind: "action",
        description: close
            ? "关闭并确认本轮工具资源释放"
            : "创建并确认本轮工具资源",
        required: true,
        depends_on: [],
        ...(close
            ? { run_if: "resource_exists", resource_ref: "tool_context" }
            : {}),
        action: {
            goal: "调用test_capture({})执行已配置的资源工具，再test_finish_step。",
            capability: "tool",
            allowed_targets: [],
            inputs: {},
            outputs: {
                resource_result: close ? { type: "boolean", const: true } : {},
            },
            completion_requirements: ["resource_result"],
            capture: {
                resource_result: {
                    kind: "tool",
                    tool_name: request.tool_name,
                    ...(request.arguments
                        ? { arguments: request.arguments }
                        : {}),
                    ...(request.arguments_json
                        ? { arguments_json: request.arguments_json }
                        : {}),
                    extract: close ? config.released : { from: "value" },
                },
            },
        },
    };
}
