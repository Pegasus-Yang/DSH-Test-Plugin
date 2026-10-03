import { writeFile } from "node:fs/promises";
const origin = "http://127.0.0.1:18081";
const source = {
  id: "fixture",
  kind: "fixture",
  uri: origin,
  version: "1",
  locator: "scripts/fixture-server.mjs",
  excerpt:
    "只有tester/fixture-only登录成功；UI金额100，API返回101，独立预期金额100。",
};
const action = (id, goal, capture, outputs, capability = "browser") => ({
  step_id: id,
  kind: "action",
  description: goal,
  required: true,
  depends_on: [],
  action: {
    goal,
    capability,
    allowed_targets: [origin],
    inputs: {},
    capture,
    outputs,
    completion_requirements: Object.keys(outputs),
  },
});
const login = action(
  "login",
  "访问http://127.0.0.1:18081，按绑定输入填写账号和密码，点击登录，等待显示登录成功或登录失败后test_capture，再test_finish_step。",
  {
    authenticated: {
      kind: "dom",
      selector: "#auth-result",
      mode: "attribute",
      attribute: "data-auth",
    },
  },
  { authenticated: { type: "string", enum: ["true", "false"] } },
);
login.action.inputs = {
  username: { input_ref: "data.inputs.username" },
  password: { input_ref: "data.inputs.password" },
};
const p = {
  schema_version: "1",
  suite_id: "fixture_login",
  name: "本地夹具 · 登录三行数据",
  source_refs: [source],
  cases: [
    {
      case_id: "login",
      name: "有效、错误及空凭据",
      datasets: [
        {
          data_id: "valid",
          inputs: { username: "tester", password: "fixture-only" },
          expected: { authenticated: "true" },
        },
        {
          data_id: "wrong",
          inputs: { username: "tester", password: "wrong-fixture" },
          expected: { authenticated: "false" },
        },
        {
          data_id: "empty",
          inputs: { username: "", password: "" },
          expected: { authenticated: "false" },
        },
      ],
      preconditions: [],
      cleanup: [],
      steps: [
        login,
        {
          step_id: "check",
          kind: "assertion",
          description: "登录结果符合本行预期",
          required: true,
          depends_on: ["login"],
          assertion: {
            observation_ref: "login.authenticated",
            operator: "eq",
            expected_ref: "data.expected.authenticated",
            rule_ref: "fixture",
          },
        },
      ],
    },
  ],
};
await writeFile(
  "examples/fixture-login.json",
  JSON.stringify(p, null, 2) + "\n",
);
const api = action(
  "read_api",
  "调用test_capture读取冻结API，不自行填写实际值，然后test_finish_step。",
  {
    amount: { kind: "http", url: origin + "/api/amount", field: "body.amount" },
  },
  { amount: { type: "number" } },
  "api",
);
const p2 = {
  ...p,
  suite_id: "fixture_api",
  name: "本地夹具 · API金额负向断言",
  cases: [
    {
      case_id: "api",
      name: "API金额与独立预期不符",
      datasets: [
        { data_id: "expected_100", inputs: {}, expected: { amount: 100 } },
      ],
      preconditions: [],
      cleanup: [],
      steps: [
        api,
        {
          step_id: "check",
          kind: "assertion",
          description: "断言API金额等于100（夹具实际101，应FAIL）",
          required: true,
          depends_on: ["read_api"],
          assertion: {
            observation_ref: "read_api.amount",
            operator: "eq",
            expected_ref: "data.expected.amount",
            rule_ref: "fixture",
          },
        },
      ],
    },
  ],
};
await writeFile(
  "examples/fixture-api.json",
  JSON.stringify(p2, null, 2) + "\n",
);
