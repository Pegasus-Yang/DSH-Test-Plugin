import { afterEach, expect, it, vi } from "vitest";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  loadConfig,
  localRoot,
  privatePath,
  readState,
  writePrivate,
  writePrivateText,
} from "../../scripts/gitlab/config.mjs";
import { createPlans, seeds } from "../../scripts/gitlab/plans.mjs";
import { createMarkdownPlans } from "../../scripts/gitlab/markdown.mjs";
import { generate } from "../../scripts/gitlab.mjs";
import { assertOwned } from "../../scripts/gitlab/client.mjs";
import { parsePlan } from "../../src/contracts.js";
import { Recorder } from "../../src/recorder.js";
import { parseCases, loadTextInput } from "../../src/case-input.js";

const directories: string[] = [];
function directory() {
  const dir = join(localRoot, "unit-" + randomUUID());
  mkdirSync(dir, { recursive: true });
  directories.push(dir);
  return dir;
}
afterEach(() => {
  directories
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
const credentials = {
  sign_in_url: "http://localhost:8929/users/sign_in",
  username: "private-test-account",
  password: "test-only-private-password",
};
function config() {
  return { ...credentials, origin: "http://localhost:8929" };
}
function state() {
  const marker = "dsh-gitlab-unit-123";
  return {
    schema_version: "1",
    status: "prepared",
    marker,
    origin: config().origin,
    owner_id: 11,
    namespace_id: 22,
    namespace_path: credentials.username,
    account: { secret: credentials.username },
    projects: Object.fromEntries(
      ["api", "ui"].map((role, index) => [
        role,
        {
          id: 30 + index,
          path: marker + "-" + role,
          path_with_namespace: credentials.username + "/" + marker + "-" + role,
          issues: [1, 2, 3].map((iid) => ({ id: 100 * index + iid, iid })),
        },
      ]),
    ),
  };
}

it("配置只从忽略目录读取，缺失、占位、权限错误不包含凭据", () => {
  const dir = directory(),
    file = join(dir, "config.json");
  expect(() => loadConfig(file)).toThrow("缺少私有配置");
  writePrivate(file, credentials);
  expect(loadConfig(file).origin).toBe(config().origin);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(() => loadConfig("examples/gitlab/config.example.json")).toThrow(
    ".local/gitlab",
  );
  writeFileSync(
    file,
    JSON.stringify({ ...credentials, password: "<填写密码>" }),
    { mode: 0o600 },
  );
  expect(() => loadConfig(file)).toThrow("password");
  const wide = join(dir, "wide.json");
  writeFileSync(wide, JSON.stringify(credentials), { mode: 0o644 });
  expect(() => loadConfig(wide)).toThrow("chmod 600");
  writeFileSync(file, "{invalid");
  expect(() => loadConfig(file)).toThrow("有效 JSON");
});

it.each([
  "file:///users/sign_in",
  "http://localhost:8929/other",
  "http://localhost:8929/users/sign_in?password=hidden",
  "http://name:pass@localhost:8929/users/sign_in",
])("拒绝无效登录地址 %s", (sign_in_url) => {
  const file = join(directory(), "config.json");
  writePrivate(file, { ...credentials, sign_in_url });
  expect(() => loadConfig(file)).toThrow("sign_in_url");
});

it("符号链接不能把私有文件写到公开目录", () => {
  const dir = directory();
  symlinkSync(
    new URL("../../examples/gitlab", import.meta.url).pathname,
    join(dir, "public"),
  );
  expect(() => privatePath(join(dir, "public", "config.json"))).toThrow(
    ".local/gitlab",
  );
});

it("准备失败记录可用于清理，但不能生成可执行计划", () => {
  const file = join(directory(), "state.json");
  writePrivate(file, {
    ...state(),
    status: "preparation_failed",
    projects: { api: state().projects.api },
  });
  expect(() => readState(file)).toThrow("尚未准备完成");
  expect(readState(file, false).projects.api.id).toBe(30);
  writePrivate(file, {
    ...state(),
    projects: { api: { ...state().projects.api, path: "business-project" } },
  });
  expect(() => readState(file, false)).toThrow("独立测试项目");
});

it("17 条场景通过真实计划校验，接口基线独立且没有浏览器步骤", () => {
  const plans = createPlans(config(), state());
  for (const plan of Object.values(plans))
    expect(parsePlan(plan).cases.length).toBe(plan.cases.length);
  expect(plans.ui.cases).toHaveLength(4);
  expect(plans.api.cases).toHaveLength(13);
  const apiSteps = plans.api.cases.flatMap((c) => [
    ...c.preconditions,
    ...c.steps,
    ...c.cleanup,
  ]);
  expect(
    apiSteps
      .filter((s) => s.action)
      .every((s) => s.action.capability === "api"),
  ).toBe(true);
  expect(
    apiSteps
      .flatMap((s) => Object.values(s.action?.capture ?? {}))
      .every((c) => c.url.startsWith(config().origin)),
  ).toBe(true);
  expect(JSON.stringify(plans.api)).not.toContain(credentials.password);
  expect(
    plans.ui.cases.every(
      (c) =>
        c.preconditions[0].action.inputs.password.input_ref ===
        "data.inputs.credentials.password",
    ),
  ).toBe(true);
  expect(() =>
    createPlans({ ...config(), origin: "http://other:8929" }, state()),
  ).toThrow("地址不同");
});

it("业务预期冻结为种子常量，分页覆盖前三页与越界空数组", () => {
  const api = createPlans(config(), state()).api;
  const pagination = api.cases.find((c) => c.case_id === "pagination");
  expect(pagination.steps.filter((s) => s.action)).toHaveLength(4);
  expect(pagination.steps.at(-1).assertion.literal).toEqual([]);
  const detail = api.cases.find((c) => c.case_id === "issue_detail");
  expect(
    detail.steps.some((s) => s.assertion?.literal === seeds[0].description),
  ).toBe(true);
  expect(
    api.cases
      .find((c) => c.case_id === "anonymous_user")
      .steps.some((s) => s.assertion?.literal === 401),
  ).toBe(true);
});

it("用户 Markdown 含两条 UI 和三条接口用例，通过真实文字入口读取", () => {
  const output = createMarkdownPlans(config(), state());
  expect(parseCases(output.ui, ".md").templates).toHaveLength(2);
  expect(parseCases(output.api, ".md").templates).toHaveLength(3);
  expect(parseCases(output.all, ".md").templates).toHaveLength(5);
  expect(output.ui).toContain(credentials.username);
  expect(output.ui).toContain(credentials.password);
  expect(output.api).not.toContain(credentials.password);
  expect(output.api).not.toMatch(/\$\{[^}]+\}/);
  expect(output.all).not.toMatch(
    /test_capture|test_finish_step|test_execute_operation|observation_ref|capture_mode/,
  );
  const dir = directory();
  const file = join(dir, "all.md");
  writePrivateText(file, output.all);
  const input = loadTextInput(localRoot, file);
  expect(input.instances).toHaveLength(5);
  expect(input.instances[0].task).toContain("组合筛选");
  expect(input.instances[2].task).toContain("按专用名称检索");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  for (const filename of [
    "ui_filters",
    "ui_draft_cancel",
    "api_project_search",
    "api_pagination",
    "api_missing_project",
  ])
    expect(parseCases(output[filename], ".md").templates).toHaveLength(1);
});

it("Markdown 预期沿用固定种子，URL 和分页绑定本次资源，配置不能串用", () => {
  const output = createMarkdownPlans(config(), state());
  expect(output.api_pagination).toContain(seeds[0].title);
  expect(output.api_pagination).toContain(seeds[1].title);
  expect(output.api_pagination).toContain(seeds[2].title);
  for (const page of [1, 2, 3, 4])
    expect(output.api_pagination).toContain(
      "/api/v4/projects/30/issues?order_by=created_at&sort=asc&per_page=1&page=" +
        page,
    );
  expect(output.api_pagination).toContain("长度 0 的空数组");
  expect(output.api_missing_project).toContain("HTTP 状态码等于 404");
  expect(output.api_missing_project).toContain(
    encodeURIComponent(
      state().namespace_path + "/" + state().marker + "-missing",
    ),
  );
  expect(output.ui_filters).toContain(
    "/api/v4/projects/31/issues?state=closed&labels=dsh-smoke",
  );
  expect(() =>
    createMarkdownPlans({ ...config(), username: "other" }, state()),
  ).toThrow("账号与准备记录不同");
});

it("生成脚本同时保存内部回归与用户 Markdown，终端只推荐 Markdown", () => {
  const dir = directory();
  const record = join(dir, "state.json");
  writePrivate(record, state());
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    generate(config(), record);
    const commands = output.mock.calls
      .map((args) => args.join(" "))
      .filter((text) => text.startsWith("/test-run "));
    expect(commands).toHaveLength(3);
    expect(commands.every((command) => command.endsWith(".md"))).toBe(true);
  } finally {
    output.mockRestore();
  }
  for (const name of ["api", "ui", "all"]) {
    expect(
      parsePlan(JSON.parse(readFileSync(join(dir, name + ".json"), "utf8")))
        .cases.length,
    ).toBeGreaterThan(0);
    expect(
      parseCases(readFileSync(join(dir, name + ".md"), "utf8"), ".md").templates
        .length,
    ).toBeGreaterThan(0);
    expect(statSync(join(dir, name + ".md")).mode & 0o777).toBe(0o600);
  }
  symlinkSync(
    new URL("../../examples/gitlab", import.meta.url).pathname,
    join(dir, "public-md"),
  );
  expect(() =>
    writePrivateText(join(dir, "public-md", "cases.md"), "text"),
  ).toThrow(".local/gitlab");
});

it("配置绑定在事件、计划及任意工具说明中都保护账号和密码", () => {
  const plan = createPlans(config(), state()).ui;
  const recorder = new Recorder(directory(), "redaction");
  recorder.protect(plan);
  recorder.json("plan.json", plan);
  recorder.event("operation", {
    description: credentials.username,
    args: { text: credentials.password },
  });
  for (const file of ["plan.json", "events.jsonl"]) {
    const text = readFileSync(join(recorder.directory, file), "utf8");
    expect(text).not.toContain(credentials.username);
    expect(text).not.toContain(credentials.password);
    expect(text).toContain("[已脱敏]");
  }
});

it("清理必须匹配本次标记、个人命名空间和账号，不能碰已有业务项目", () => {
  const s = state(),
    user = { id: s.owner_id };
  const project = {
    namespace: { id: s.namespace_id },
    path: s.projects.api.path,
    description: s.marker + "：仅用于 DSH GitLab 验收",
  };
  expect(() => assertOwned(project, s, user)).not.toThrow();
  for (const changed of [
    { ...project, path: "other-project" },
    { ...project, namespace: { id: 999 } },
    { ...project, description: "其他业务" },
  ])
    expect(() => assertOwned(changed, s, user)).toThrow("拒绝");
  expect(() => assertOwned(project, s, { id: 999 })).toThrow("拒绝");
});

it("UI 创建中断时仅允许精确预留路径的空描述项目，其他角色和路径仍拒绝", () => {
  const s = state(),
    user = { id: s.owner_id },
    path = s.marker + "-created";
  const project = {
    id: 99,
    namespace: { id: s.namespace_id },
    path,
    description: null,
  };
  const target = { role: "created", id: 99, path };
  expect(() => assertOwned(project, s, user, target)).not.toThrow();
  expect(() =>
    assertOwned(project, s, user, { ...target, role: "api" }),
  ).toThrow("拒绝");
  expect(() =>
    assertOwned({ ...project, path: path + "-other" }, s, user, target),
  ).toThrow("拒绝");
  expect(() => assertOwned(project, s, user, { ...target, id: 100 })).toThrow(
    "拒绝",
  );
});
