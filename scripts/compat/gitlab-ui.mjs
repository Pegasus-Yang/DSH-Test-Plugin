/** 核对真实操作顺序，拒绝用取消后的额外导航补出返回列表的通过结果。 */
import assert from "node:assert/strict";

export function assertDraftCancellation(document, listUrl, run) {
  const draft = document.cases.at(-1);
  assert(draft, "缺少 GitLab 草稿取消用例");
  const path = new URL(listUrl).pathname;
  const calls = new Map(draft.call_records.map((call) => [call.call_id, call]));
  const name = (step) => calls.get(step.tool_call_id)?.name ?? "";
  const label = (step) => step.inputs?.element ?? step.description;
  const cancel = draft.steps.findIndex(
    (step) =>
      /browser_click$/.test(name(step)) && /Cancel|取消/.test(label(step)),
  );
  assert(cancel >= 0, "缺少实际 Cancel 调用");
  const before = draft.steps.slice(0, cancel);
  const list = before.findIndex(
    (step) =>
      /browser_navigate$/.test(name(step)) &&
      new URL(step.inputs.url).pathname === path,
  );
  assert(list >= 0, "草稿没有从工作项列表进入");
  assert(
    !before.some(
      (step) =>
        /browser_navigate$/.test(name(step)) &&
        new URL(step.inputs.url).pathname === path + "/new",
    ),
    "草稿绕过了原生新建弹窗",
  );
  assert(
    before
      .slice(list + 1)
      .some(
        (step) =>
          /browser_click$/.test(name(step)) &&
          /New item|New issue|新建/.test(label(step)),
      ),
    "草稿没有点击原生新建入口",
  );
  const returned = draft.steps.findIndex(
    (step) =>
      step.kind === "check" &&
      step.expected?.operator === "eq" &&
      step.expected?.value === path &&
      step.state === "PASS",
  );
  assert(returned > cancel, "缺少取消后的路径断言");
  for (const step of draft.steps.slice(cancel + 1, returned)) {
    if (step.kind !== "operation") continue;
    assert(
      /browser_wait_for$|browser_handle_dialog$/.test(name(step)) ||
        (/browser_click$/.test(name(step)) && /Discard|丢弃/.test(label(step))),
      "取消后存在额外导航或其他修正动作",
    );
  }
  assert(
    draft.steps
      .slice(cancel + 1)
      .some(
        (step) =>
          step.kind === "check" &&
          /表单.*关闭/.test(step.description) &&
          step.state === "PASS" &&
          step.assertion?.status === "PASS" &&
          [false, 0].includes(step.assertion.actual) &&
          run.instances.some(
            (instance) =>
              instance.case_run_id === draft.case_run_id &&
              instance.steps.some((record) =>
                record.observations.some(
                  (observation) =>
                    observation.observation_id ===
                      step.assertion.operand_snapshot?.actual_observation_id &&
                    observation.binding.case_run_id === draft.case_run_id &&
                    observation.producer.adapter === "playwright-dom-v1" &&
                    observation.value === step.assertion.actual,
                ),
              ),
          ),
      ),
    "缺少新建表单已关闭的可信断言",
  );
}
