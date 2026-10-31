/** 将原规划、实际操作和运行依据组织为同一条执行过程。 */
import type { CaseRun, Phase, Step, StepResult, SuiteRun } from "./contracts.js";
import type { ActualCase, ActualRow } from "./actual-operations.js";
export interface ExecutionGroup {
    id: string;
    description: string;
    phase: Phase;
    planned?: Step;
    steps: StepResult[];
    rows: ActualRow[];
    system: boolean;
    status: string;
    needs_review: boolean;
}
/**
 * 只按规划标识及冻结规则来源归组，不根据标题或任意 ID 后缀猜测。
 *
 * :param run: 已保存的整批运行。
 * :param instance: 当前用例实例。
 * :param actual: 该实例已投影的实际记录。
 * :returns: 包含未执行规划及无法归属记录的完整分组。
 */
export declare function executionGroups(run: SuiteRun, instance: CaseRun, actual: ActualCase): ExecutionGroup[];
interface ProcessContext {
    run: SuiteRun;
    instance: CaseRun;
    actual: ActualCase;
    index: number;
    compare: (step: StepResult, caseIndex: number) => string;
    callDetails: (id: string, value: unknown) => string;
}
export declare function executionProcess(context: ProcessContext): string;
export {};
