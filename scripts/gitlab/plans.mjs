/** 冻结 GitLab 场景与业务预期，不使用运行时实际响应反向生成预期。 */
export const seeds = [
  {
    title: "DSH 检索 alpha Python测试开发",
    description: "alpha 的固定验收正文\n第二行：保留中文与空格。",
    labels: "dsh-smoke",
    state: "opened",
  },
  {
    title: "DSH 检索 beta Agent进度",
    description: "beta 的固定验收正文",
    labels: "dsh-regression",
    state: "opened",
  },
  {
    title: "DSH 检索 gamma 已关闭",
    description: "gamma 的固定验收正文",
    labels: "dsh-smoke",
    state: "closed",
  },
];
export const comment = "DSH 固定评论：验收记录应能重新读取。";
const ref = (key) => ({ input_ref: "data.inputs." + key });
const check = (id, observation, expected, description) => ({
  step_id: id,
  kind: "assertion",
  required: true,
  depends_on: [observation.split(".")[0]],
  description,
  assertion: {
    observation_ref: observation,
    operator: "eq",
    literal: expected,
    rule_ref: "gitlab_cases",
  },
});

export function createPlans(config, state) {
  if (config.origin !== state.origin)
    throw new Error(
      "配置与准备记录的 GitLab 地址不同，请使用对应配置或重新准备",
    );
  if (state.account?.secret !== config.username)
    throw new Error("配置账号与准备记录不同，请重新准备该账号的测试数据");
  const origin = config.origin;
  const path = (role) => "/projects/" + state.projects[role].id;
  const issue = (role, index) =>
    path(role) + "/issues/" + state.projects[role].issues[index].iid;
  const credentials = { secret: config.username, password: config.password };
  const sources = [
    {
      id: "gitlab_cases",
      kind: "user",
      uri: "file:examples/gitlab/README.md",
      version: "1",
      locator: "GitLab 场景表及固定数据",
      excerpt:
        "仅操作本次准备记录中的独立测试项目；预期由用例和固定种子定义，禁止从当前实际响应推导通过结果。",
    },
  ];
  function action(id, goal, capability, inputs = {}, capture = {}) {
    const outputs = Object.fromEntries(
      Object.keys(capture).map((name) => [
        name,
        { type: name === "response" ? "object" : "string" },
      ]),
    );
    return {
      step_id: id,
      kind: "action",
      required: true,
      depends_on: [],
      description: goal,
      action: {
        goal:
          goal +
          "。完成后调用 test_capture 保存可信输出，再 test_finish_step；浏览器动作通过 test_execute_operation 逐条说明并执行。",
        capability,
        allowed_targets: [origin],
        inputs,
        outputs,
        capture,
        completion_requirements: Object.keys(outputs),
      },
    };
  }
  function http(id, url, goal = "通过独立 HTTP GET 采集完整 JSON 响应") {
    return action(
      id,
      goal,
      "api",
      {},
      { response: { kind: "http", url: origin + "/api/v4" + url, field: "" } },
    );
  }
  function browser(id, goal, inputs = {}) {
    return action(id, goal, "browser", inputs, {
      path: { kind: "dom", mode: "url", field: "pathname" },
    });
  }
  function dom(id, goal, inputs, name) {
    const step = action(
      id,
      goal +
        "。本步必须采集 " +
        name +
        "，根据实际 DOM 定位本步指定的可见文本，用 mode:text；不把侧栏或整页内容当作该字段",
      "browser",
      inputs,
    );
    step.action.outputs = {
      [name]: {
        type: "string",
        description:
          name === "preview"
            ? "Markdown 预览正文的粗体段落文字；不含编辑器工具栏、隐藏菜单或帮助文案"
            : "本步指定的可见业务文本",
      },
    };
    step.action.completion_requirements = [name];
    delete step.action.capture;
    step.action.capture_mode = "runtime";
    return step;
  }
  function login() {
    return browser(
      "login",
      "访问绑定的登录页面，使用绑定账号和密码登录；如已登录，先退出再登录。等待离开登录页",
      {
        sign_in_url: config.sign_in_url,
        username: ref("credentials.secret"),
        password: ref("credentials.password"),
      },
    );
  }
  function testCase(id, name, steps, ui = false) {
    return {
      case_id: id,
      name,
      preconditions: ui ? [login()] : [],
      cleanup: ui
        ? [
            {
              step_id: "release_browser",
              kind: "action",
              required: true,
              run_if: "always",
              depends_on: [],
              description: "关闭本实例浏览器，保留已判定失败，继续下一实例",
              action: {
                goal: "当前是收尾：直接 test_capture({}) 关闭浏览器，再 test_finish_step。已有 FAIL/BLOCKED 已冻结，不重新进入页面、不编辑旧字段、不尝试修复或重跑业务。按 test_current 进入下一实例或 test_finish。",
                capability: "browser",
                allowed_targets: [origin],
                inputs: {},
                outputs: { released: { type: "boolean" } },
                completion_requirements: ["released"],
                capture: { released: { kind: "browser_close" } },
              },
            },
          ]
        : [],
      // secret 键复用 Recorder 的已知敏感值保护；账号和密码均在账本、报告与导出中脱敏。
      datasets: [
        {
          data_id: "baseline",
          inputs: {
            credentials: ui ? credentials : { secret: config.username },
          },
          expected: {},
        },
      ],
      steps,
    };
  }
  function responseChecks(id, expected) {
    return Object.entries(expected).map(([key, value], index) =>
      check(
        id + "_check_" + (index + 1),
        id + ".response." + key,
        value,
        "核对 " + key,
      ),
    );
  }
  const apiProject = state.projects.api;
  const api = [];
  const read = (id, name, url, expected) =>
    api.push(
      testCase(id, name, [
        http("request", url),
        ...responseChecks("request", expected),
      ]),
    );
  read(
    "project_search",
    "项目检索：按专用名称搜索，核对数量、身份及可见性",
    "/projects?search=" + encodeURIComponent(apiProject.path) + "&simple=true",
    {
      status: 200,
      "body.length": 1,
      "body.0.id": apiProject.id,
      "body.0.path": apiProject.path,
      "body.0.visibility": "public",
    },
  );
  read(
    "project_by_path",
    "URL 编码的命名空间路径可准确定位项目",
    "/projects/" + encodeURIComponent(apiProject.path_with_namespace),
    {
      status: 200,
      "body.id": apiProject.id,
      "body.path": apiProject.path,
      "body.description": state.marker + "：仅用于 DSH GitLab 验收",
    },
  );
  const pages = [1, 2, 3, 4].flatMap((page, index) => {
    const id = "page_" + page;
    return [
      http(
        id,
        path("api") +
          "/issues?order_by=created_at&sort=asc&per_page=1&page=" +
          page,
      ),
      ...responseChecks(
        id,
        index < 3
          ? {
              status: 200,
              "body.length": 1,
              "body.0.iid": apiProject.issues[index].iid,
              "body.0.title": seeds[index].title,
            }
          : { status: 200, body: [] },
      ),
    ];
  });
  api.push(testCase("pagination", "分页：三页顺序唯一，越界页为空数组", pages));
  for (const [id, query, indexes] of [
    ["opened", "state=opened", [0, 1]],
    ["closed", "state=closed", [2]],
    ["label", "labels=dsh-smoke&state=opened", [0]],
    ["search", "search=" + encodeURIComponent("Python测试开发"), [0]],
  ]) {
    read(
      "filter_" + id,
      "Issue 条件筛选：" + id,
      path("api") + "/issues?order_by=created_at&sort=asc&" + query,
      {
        status: 200,
        "body.length": indexes.length,
        ...Object.fromEntries(
          indexes.flatMap((n, i) => [
            ["body." + i + ".iid", apiProject.issues[n].iid],
            ["body." + i + ".state", seeds[n].state],
            ["body." + i + ".title", seeds[n].title],
          ]),
        ),
      },
    );
  }
  read(
    "issue_detail",
    "Issue 详情：精确正文、标签、状态及所属项目",
    issue("api", 0),
    {
      status: 200,
      "body.iid": apiProject.issues[0].iid,
      "body.project_id": apiProject.id,
      "body.title": seeds[0].title,
      "body.description": seeds[0].description,
      "body.labels": [seeds[0].labels],
      "body.state": "opened",
      "body.user_notes_count": 1,
    },
  );
  read(
    "issue_comments_access",
    "权限边界：公开 Issue 的评论 REST 接口仍需认证",
    issue("api", 0) + "/notes?activity_filter=only_comments",
    {
      status: 401,
      "body.message": "401 Unauthorized",
    },
  );
  read(
    "empty_search",
    "无匹配条件返回空数组，不能当成接口故障",
    path("api") + "/issues?search=" + state.marker + "-missing",
    { status: 200, body: [] },
  );
  read(
    "missing_project",
    "不存在项目返回 JSON 404",
    "/projects/" +
      encodeURIComponent(
        state.namespace_path + "/" + state.marker + "-missing",
      ),
    { status: 404, "body.message": "404 Project Not Found" },
  );
  read(
    "missing_issue",
    "已有项目中不存在的 Issue 返回 JSON 404",
    path("api") + "/issues/999999999",
    { status: 404, "body.message": "404 Not found" },
  );
  read("anonymous_user", "匿名用户访问需认证接口返回 JSON 401", "/user", {
    status: 401,
    "body.message": "401 Unauthorized",
  });

  const ui = [];
  const uiIssueUrl =
    origin +
    "/" +
    state.projects.ui.path_with_namespace +
    "/-/issues/" +
    state.projects.ui.issues[0].iid;
  const edited = "DSH 编辑后：中文 Agent 验收";
  const editedBody = "DSH 编辑后的固定正文\n第二行：保存后刷新仍应存在。";
  const uiComment = "DSH UI 评论：保存后从独立接口重新读取。";
  const lifecycle = [
    dom(
      "edit_issue",
      "打开绑定 Issue，编辑标题和正文并保存。必须完整输入 description 的两行正文，保留换行和第二行；如富文本不便输入可切换 Markdown 编辑器。正文使用 browser_type 的 text 完整输入，不能当作 browser_press_key 的 key。保存前核对全部正文，刷新后只采集 Issue 标题",
      { url: uiIssueUrl, title: edited, description: editedBody },
      "title",
    ),
    check("ui_title", "edit_issue.title", edited, "UI 标题是修改后的精确文本"),
    http("after_edit", issue("ui", 0)),
    ...responseChecks("after_edit", {
      status: 200,
      "body.title": edited,
      "body.description": editedBody,
      "body.state": "opened",
    }),
    dom(
      "comment",
      "打开绑定 Issue，输入绑定评论并提交，刷新页面后只采集刚保存的评论正文，不能采集整条活动或作者信息",
      { url: uiIssueUrl, body: uiComment },
      "comment",
    ),
    check(
      "comment_text",
      "comment.comment",
      uiComment,
      "刷新后重新读取的评论正文精确匹配",
    ),
    http("after_comment", issue("ui", 0)),
    ...responseChecks("after_comment", {
      status: 200,
      "body.user_notes_count": 2,
      "body.title": edited,
    }),
    browser(
      "close_issue",
      "通过 Issue 页面的关闭操作关闭绑定 Issue，等待状态更新",
      { url: uiIssueUrl },
    ),
    http("after_close", issue("ui", 0)),
    ...responseChecks("after_close", {
      status: 200,
      "body.state": "closed",
      "body.title": edited,
    }),
    browser(
      "reopen_issue",
      "通过 Issue 页面的重新打开操作重开绑定 Issue，刷新后等待状态更新",
      { url: uiIssueUrl },
    ),
    http("after_reopen", issue("ui", 0)),
    ...responseChecks("after_reopen", {
      status: 200,
      "body.state": "opened",
      "body.description": editedBody,
    }),
  ];
  ui.push(
    testCase(
      "ui_issue_lifecycle",
      "UI 与 API 交叉核对：编辑、评论、关闭、重开 Issue",
      lifecycle,
      true,
    ),
  );
  const listUrl =
    origin + "/" + state.projects.ui.path_with_namespace + "/-/work_items";
  ui.push(
    testCase(
      "ui_filters",
      "UI 组合筛选：关闭状态与标签，打开匹配的 Issue",
      [
        dom(
          "filter_list",
          "打开绑定 Issue 列表，使用页面的 Closed 标签和 Label 筛选选择 dsh-smoke；打开唯一匹配的 gamma Issue，采集主内容区中该 Issue 的业务标题。先通过实际 DOM 确认定位指向 Issue 标题，再采集；不能直接取全页面的第一个 h1，不能采集导航栏的 Primary navigation 或其他导航标题。不能用直接拼接筛选 URL 替代界面操作",
          { url: listUrl, label: "dsh-smoke" },
          "title",
        ),
        check(
          "filtered_title",
          "filter_list.title",
          seeds[2].title,
          "筛选并打开的是关闭且标签匹配的 gamma Issue",
        ),
        http(
          "filtered_api",
          path("ui") + "/issues?state=closed&labels=dsh-smoke",
        ),
        ...responseChecks("filtered_api", {
          status: 200,
          "body.length": 1,
          "body.0.iid": state.projects.ui.issues[2].iid,
          "body.0.state": "closed",
          "body.0.labels": ["dsh-smoke"],
        }),
      ],
      true,
    ),
  );
  const draft = state.marker + "-cancelled-draft";
  ui.push(
    testCase(
      "ui_draft_cancel",
      "UI 表单：Markdown 预览与取消，确认草稿没有创建",
      [
        dom(
          "preview_draft",
          "打开绑定的新建 Issue 表单，使用纯文本 Markdown 编辑模式（需要时先切换），填写标题和绑定的 Markdown 原文，点击 Preview，等待预览渲染完成。先观察实际 DOM，确认匹配的是预览正文中已显示的粗体段落，再用一个已验证的精确选择器采集。不能使用逗号并列多个候选选择器、~ * 通配或全页面的 main strong 兜底，首个匹配可能是空或隐藏节点。不要采集编辑器输入框、整个容器、工具栏、隐藏菜单或帮助文字。不要提交表单",
          {
            url: listUrl + "/new?type=issue",
            title: draft,
            description: "**DSH 草稿预览**",
          },
          "preview",
        ),
        check(
          "preview_text",
          "preview_draft.preview",
          "DSH 草稿预览",
          "Markdown 渲染为预期可见文字",
        ),
        browser(
          "cancel_draft",
          "点击页面 Cancel 取消按钮，若弹出丢弃确认则确认；回到 Issue 列表，不能点击创建",
          { url: listUrl },
        ),
        check(
          "cancel_path",
          "cancel_draft.path",
          new URL(listUrl).pathname,
          "取消后回到列表",
        ),
        http("draft_api", path("ui") + "/issues?search=" + draft),
        ...responseChecks("draft_api", { status: 200, body: [] }),
      ],
      true,
    ),
  );
  const newProject = state.marker + "-created";
  const createdPath = state.namespace_path + "/" + newProject;
  const createdDescription = state.marker + "：仅用于 DSH GitLab 验收";
  ui.push(
    testCase(
      "ui_project_create",
      "UI 新建公开项目并创建中文 Issue，接口核对持久化",
      [
        browser(
          "create_project",
          "打开绑定的新建空白项目页面，在本账号命名空间创建绑定名称的 public 项目，不初始化 README，不创建组。等待进入项目首页",
          {
            url: origin + "/projects/new#blank_project",
            name: newProject,
            path: newProject,
            namespace: state.namespace_path,
            visibility: "public",
          },
        ),
        check(
          "created_path",
          "create_project.path",
          "/" + createdPath,
          "进入新项目首页",
        ),
        browser(
          "set_project_description",
          "打开新项目的 Settings / General，找到 Project description，填写绑定的 description 并点击对应 Save changes。刷新设置页确认保存，不更改项目名称、路径或可见性",
          {
            url: origin + "/" + createdPath + "/edit",
            description: createdDescription,
          },
        ),
        http("project_api", "/projects/" + encodeURIComponent(createdPath)),
        ...responseChecks("project_api", {
          status: 200,
          "body.path": newProject,
          "body.visibility": "public",
          "body.description": createdDescription,
        }),
        dom(
          "create_issue",
          "打开绑定的新建 Issue 页面，填写绑定的中文标题，切换纯文本 Markdown 编辑模式，用 browser_type 完整输入 description 的两行正文，保留换行和第二行，不用 browser_press_key 拼接正文；保存前核对全部正文，创建后刷新详情页并采集 Issue 标题",
          {
            url: origin + "/" + createdPath + "/-/issues/new",
            title: "DSH 新建：中文与空格验证",
            description: "通过 UI 新建的固定正文\n第二行持久化验证。",
          },
          "title",
        ),
        check(
          "created_issue_title",
          "create_issue.title",
          "DSH 新建：中文与空格验证",
          "新建 Issue 标题精确匹配",
        ),
        http(
          "created_issue_api",
          "/projects/" +
            encodeURIComponent(createdPath) +
            "/issues?search=" +
            encodeURIComponent("DSH 新建：中文与空格验证"),
        ),
        ...responseChecks("created_issue_api", {
          status: 200,
          "body.length": 1,
          "body.0.title": "DSH 新建：中文与空格验证",
          "body.0.description": "通过 UI 新建的固定正文\n第二行持久化验证。",
          "body.0.state": "opened",
        }),
      ],
      true,
    ),
  );
  function suite(id, name, cases) {
    return {
      schema_version: "1",
      suite_id: id,
      name,
      source_refs: sources,
      cases,
    };
  }
  return {
    api: suite("gitlab_api", "GitLab · 复杂接口回归", api),
    ui: suite("gitlab_ui", "GitLab · 复杂 UI 与持久化回归", ui),
    all: suite("gitlab_all", "GitLab · UI 和接口完整回归", [...ui, ...api]),
  };
}
