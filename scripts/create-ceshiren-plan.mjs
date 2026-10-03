/** 冻结用户用例及经只读勘察确认的采集规则，不保存预先读取的实际点赞值。 */
import { writeFile } from "node:fs/promises";
const action = (id, description, goal, capture, outputs, depends_on = []) => ({
  step_id: id,
  kind: "action",
  description,
  depends_on,
  required: true,
  action: {
    goal,
    capability: "browser",
    allowed_targets: ["https://ceshiren.com"],
    inputs: {},
    outputs,
    completion_requirements: Object.keys(outputs),
    capture,
  },
});
const assertion = (
  id,
  description,
  observation_ref,
  operator,
  expected,
  depends_on,
) => ({
  step_id: id,
  kind: "assertion",
  description,
  required: true,
  depends_on,
  assertion: { observation_ref, operator, ...expected, rule_ref: "user_task" },
});
const close = action(
  "close",
  "关闭并确认浏览器上下文释放",
  "调用test_capture释放浏览器，然后test_finish_step。",
  { released: { kind: "browser_close" } },
  { released: { type: "boolean", const: true } },
);
close.run_if = "resource_exists";
close.resource_ref = "browser_context";
const plan = {
  schema_version: "1",
  suite_id: "ceshiren_agent",
  name: "测试人社区 · 搜索 agent 并验证首帖点赞",
  source_refs: [
    {
      id: "user_task",
      kind: "user",
      uri: "user:acceptance",
      version: "1",
      locator: "用户验收用例",
      excerpt:
        "访问ceshiren.com，搜索 agent 关键字，并打开第一条搜索结果帖子，断言帖子的点赞数不为0。按默认搜索浮层第一条结果的首帖计数；禁止点赞或改写网站内容。",
    },
  ],
  cases: [
    {
      case_id: "search_agent",
      name: "搜索 agent，打开第一条结果并核对点赞",
      datasets: [
        {
          data_id: "agent",
          inputs: { keyword: "agent" },
          expected: { keyword: "agent", likes_not: 0 },
        },
      ],
      preconditions: [],
      steps: [
        action(
          "visit",
          "访问测试人社区首页",
          "使用browser_navigate访问https://ceshiren.com，等待首页出现，然后test_capture和test_finish_step。",
          { url: { kind: "dom", mode: "url" } },
          { url: { type: "string" } },
        ),
        action(
          "search",
          "搜索 agent 并记录默认第一条结果",
          "点击右上角搜索按钮，输入agent，按Enter在当前搜索浮层启动搜索，等待默认帖子结果出现。保留浮层，不按Ctrl+Enter进入完整搜索页，不要打开帖子。然后test_capture和test_finish_step。",
          {
            keyword: { kind: "dom", mode: "value", selector: "#search-term" },
            first_href: {
              kind: "dom",
              mode: "attribute",
              selector: 'a.search-link[href^="/t/"]',
              attribute: "href",
              index: 0,
            },
            first_title: {
              kind: "dom",
              mode: "text",
              selector: 'a.search-link[href^="/t/"] .topic-title',
              index: 0,
            },
            result_count: {
              kind: "dom",
              mode: "count",
              selector: 'a.search-link[href^="/t/"]',
            },
          },
          {
            keyword: { type: "string" },
            first_href: { type: "string" },
            first_title: { type: "string" },
            result_count: { type: "integer", minimum: 1 },
          },
          ["visit"],
        ),
        assertion(
          "keyword",
          "断言实际搜索词为 agent",
          "search.keyword",
          "eq",
          { expected_ref: "data.expected.keyword" },
          ["search"],
        ),
        action(
          "open",
          "打开默认第一条帖子并读取首帖点赞数",
          "点击当前搜索浮层的第一条帖子链接（不可选择其他结果）。等待帖子页面完整显示，读取首帖#post_1，滚动到首帖底部点赞计数可见。禁止点击点赞。然后调用test_capture和test_finish_step。",
          {
            path: {
              kind: "dom",
              mode: "attribute",
              selector: "#topic-title h1 a",
              attribute: "href",
              field: "pathname",
            },
            title: { kind: "dom", mode: "text", selector: "#topic-title h1" },
            likes: {
              kind: "dom",
              mode: "number",
              selector: "#post_1 .like-count",
            },
          },
          {
            path: { type: "string" },
            title: { type: "string" },
            likes: { type: "integer", minimum: 0 },
          },
          ["keyword"],
        ),
        assertion(
          "first_result",
          "断言打开的帖子就是搜索第一条",
          "open.path",
          "eq",
          { expected_observation_ref: "search.first_href" },
          ["open"],
        ),
        assertion(
          "likes_nonzero",
          "断言首帖点赞数不为 0",
          "open.likes",
          "neq",
          { expected_ref: "data.expected.likes_not" },
          ["first_result"],
        ),
      ],
      cleanup: [close],
    },
  ],
};
await writeFile(
  "examples/ceshiren-agent.json",
  JSON.stringify(plan, null, 2) + "\n",
);
