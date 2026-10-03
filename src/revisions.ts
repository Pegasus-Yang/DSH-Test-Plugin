/** 动态检查只追加有来源的断言，按实例提交有效集合。 */
import { isDeepStrictEqual } from "node:util";
import {
  parsePlan,
  type PlanRevision,
  type Step,
  type SuiteRun,
} from "./contracts.js";
import type { Recorder } from "./recorder.js";
export function applyRevision(
  run: SuiteRun,
  recorder: Recorder,
  proposal: Omit<PlanRevision, "revision" | "parent_revision">,
  budget: number,
): PlanRevision {
  if (run.lifecycle !== "RUNNING") throw new Error("修订入口已关闭");
  const previous = Math.max(
    ...run.instances.flatMap((i) => i.applied_revisions),
  );
  if (previous >= budget) throw new Error("修订预算耗尽");
  if (
    !proposal.reason ||
    !proposal.target_instance_ids?.length ||
    !proposal.added_steps?.length ||
    !proposal.source_refs?.length ||
    typeof proposal.post_hoc !== "boolean"
  )
    throw new Error("修订字段不完整");
  if (
    new Set(proposal.target_instance_ids).size !==
    proposal.target_instance_ids.length
  )
    throw new Error("修订目标重复");
  for (const source of proposal.source_refs)
    if (!run.plan.source_refs.some((s) => isDeepStrictEqual(s, source)))
      throw new Error("规则没有已验证来源；新来源须由用户重新提交计划");
  for (const step of proposal.added_steps)
    if (
      step.kind !== "assertion" ||
      !proposal.source_refs.some((s) => s.id === step.assertion?.rule_ref)
    )
      throw new Error("首版修订只接受有来源断言，不得扩权或增加业务动作");
  const targets = proposal.target_instance_ids.map((id) => {
    const instance = run.instances.find((i) => i.case_run_id === id);
    if (
      !instance ||
      instance.lifecycle === "FINISHED" ||
      instance.lifecycle === "INTERRUPTED" ||
      instance.cancelled ||
      instance.blocked ||
      instance.integrity_error
    )
      throw new Error("修订包含不可用或已终结实例");
    return instance;
  });
  const changes: { instance: (typeof targets)[number]; steps: Step[] }[] = [];
  for (const instance of targets) {
    const steps = structuredClone(instance.effective_steps);
    const index =
      proposal.insertion_boundary === "end"
        ? steps.length
        : steps.findIndex((s) => s.step_id === proposal.insertion_boundary);
    if (
      index < 0 ||
      instance.steps.some(
        (s) => s.phase === "test" && s.step_id === proposal.insertion_boundary,
      )
    )
      throw new Error("插入边界已执行或不存在");
    if (
      instance.steps.some(
        (s) =>
          s.required &&
          s.phase !== "cleanup" &&
          ["FAIL", "ERROR", "INCONCLUSIVE", "BLOCKED", "CANCELLED"].includes(
            s.status,
          ),
      )
    )
      throw new Error("实例已进入fail-fast");
    for (const added of proposal.added_steps) {
      if (steps.some((s) => s.step_id === added.step_id))
        throw new Error("重复检查点");
      const producer = added.assertion!.observation_ref.split(".")[0];
      if (
        instance.steps.some((s) => s.step_id === producer) &&
        !proposal.post_hoc
      )
        throw new Error("已观察的检查必须标记post_hoc");
    }
    steps.splice(index, 0, ...structuredClone(proposal.added_steps));
    const testCase = run.plan.cases.find(
      (c) => c.case_id === instance.case_id,
    )!;
    parsePlan({ ...run.plan, cases: [{ ...testCase, steps }] });
    changes.push({ instance, steps });
  }
  const revision: PlanRevision = {
    ...structuredClone(proposal),
    revision: previous + 1,
    parent_revision: previous,
  };
  recorder.event("plan_revised", revision);
  for (const { instance, steps } of changes) {
    const ids = steps
      .filter((s) => s.required && s.kind === "assertion")
      .map((s) => s.step_id);
    recorder.event("revision_applied", {
      revision: revision.revision,
      case_run_id: instance.case_run_id,
      effective_required_assertion_ids: ids,
      effective_steps: steps,
      post_hoc: revision.post_hoc,
    });
    instance.effective_steps.splice(
      0,
      instance.effective_steps.length,
      ...steps,
    );
    instance.applied_revisions.push(revision.revision);
    (instance.revision_history ??= []).push(structuredClone(revision));
    instance.effective_required_assertion_ids = ids;
  }
  recorder.snapshot(run);
  return revision;
}
