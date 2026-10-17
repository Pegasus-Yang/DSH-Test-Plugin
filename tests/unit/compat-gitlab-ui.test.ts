import { expect, it } from "vitest";
import { assertDraftCancellation } from "../../scripts/compat/gitlab-ui.mjs";

const list = "http://localhost/team/project/-/work_items";
function fixture() {
  const calls = [
    "browser_navigate",
    "browser_click",
    "browser_click",
    "browser_click",
    "browser_navigate",
  ].map((name, index) => ({
    call_id: String(index),
    name: "mcp__playwright__" + name,
  }));
  const operation = (id: string, inputs: Record<string, string>) => ({
    kind: "operation",
    tool_call_id: id,
    inputs,
    description: "真实原子操作",
    state: "SUCCEEDED",
  });
  const steps: any[] = [
    operation("0", { url: list }),
    operation("1", { element: "New item" }),
    operation("2", { element: "Cancel" }),
    operation("3", { element: "Discard changes" }),
    {
      kind: "check",
      state: "PASS",
      expected: { operator: "eq", value: new URL(list).pathname },
      description: "页面路径",
    },
    {
      kind: "check",
      state: "PASS",
      expected: { operator: "eq", value: false },
      description: "新建 Issue 表单已关闭",
      assertion: {
        status: "PASS",
        actual: false,
        operand_snapshot: { actual_observation_id: "closed" },
      },
    },
  ];
  return {
    document: {
      cases: [{}, { case_run_id: "draft", steps, call_records: calls }],
    },
    run: {
      instances: [
        {
          case_run_id: "draft",
          steps: [
            {
              observations: [
                {
                  observation_id: "closed",
                  binding: { case_run_id: "draft" },
                  producer: { adapter: "playwright-dom-v1" },
                  value: false,
                },
              ],
            },
          ],
        },
      ],
    },
    steps,
    operation,
  };
}

it("原生新建弹窗取消后直接核对表单关闭和原列表路径", () => {
  const single = fixture();
  expect(() =>
    assertDraftCancellation(single.document, list, single.run),
  ).not.toThrow();
  single.document.cases.shift();
  for (const [operator, value] of [
    ["eq", false],
    ["visible", false],
    ["neq", true],
  ]) {
    single.steps.at(-1).expected = { operator, value };
    expect(() =>
      assertDraftCancellation(single.document, list, single.run),
    ).not.toThrow();
  }
});

it("即使路径断言为 PASS，取消后的额外导航仍拒绝验收", () => {
  const f = fixture();
  f.steps.splice(4, 0, f.operation("4", { url: list }));
  expect(() => assertDraftCancellation(f.document, list, f.run)).toThrow(
    "额外导航",
  );
});

it("拒绝绕过原生入口直接打开新建页", () => {
  const f = fixture();
  f.steps.splice(2, 0, f.operation("4", { url: list + "/new?type=issue" }));
  expect(() => assertDraftCancellation(f.document, list, f.run)).toThrow(
    "绕过",
  );
});

it("只有原列表路径不能证明新建表单已关闭", () => {
  const f = fixture();
  f.steps.pop();
  expect(() => assertDraftCancellation(f.document, list, f.run)).toThrow(
    "表单已关闭",
  );
  const wrong = fixture();
  wrong.steps.at(-1).assertion.actual = true;
  expect(() =>
    assertDraftCancellation(wrong.document, list, wrong.run),
  ).toThrow("表单已关闭");
  const api = fixture();
  api.run.instances[0].steps[0].observations[0].producer.adapter =
    "http-json-v1";
  expect(() => assertDraftCancellation(api.document, list, api.run)).toThrow(
    "表单已关闭",
  );
});
