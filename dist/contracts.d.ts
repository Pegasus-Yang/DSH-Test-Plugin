/** 测试计划、运行事实及结果的共同类型与输入校验。 */
import { Ajv } from "ajv";
import type { TextInput } from "./case-input.js";
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export type Status = "PASS" | "FAIL" | "ERROR" | "BLOCKED" | "SKIPPED" | "CANCELLED" | "INCONCLUSIVE";
export type Phase = "setup" | "test" | "cleanup";
export type Operator = "eq" | "neq" | "contains" | "range" | "exists" | "text" | "visible";
export interface SourceRef {
    id: string;
    kind: string;
    uri: string;
    version: string;
    locator: string;
    excerpt: string;
}
export interface DataRow {
    data_id: string;
    inputs: Record<string, Json>;
    expected: Record<string, Json>;
}
export interface Capture {
    kind: "dom" | "http" | "browser_close";
    selector?: string;
    mode?: "text" | "number" | "count" | "visible" | "url" | "attribute" | "value";
    attribute?: string;
    url?: string;
    field?: string;
    index?: number;
}
export interface ActionSpec {
    goal: string;
    capability: "browser" | "api";
    allowed_targets: string[];
    inputs: Record<string, Json>;
    outputs: Record<string, Record<string, unknown>>;
    completion_requirements: string[];
    capture?: Record<string, Capture>;
    capture_mode?: "runtime";
    approval?: boolean;
}
export interface AssertionSpec {
    observation_ref: string;
    operator: Operator;
    expected_ref?: string;
    literal?: Json;
    expected_observation_ref?: string;
    rule_ref: string;
    unit?: string;
    tolerance?: number;
}
export interface Step {
    step_id: string;
    kind: "action" | "assertion" | "intent";
    checks?: string[];
    description: string;
    depends_on: string[];
    required: boolean;
    action?: ActionSpec;
    assertion?: AssertionSpec;
    run_if?: "always" | "resource_exists";
    resource_ref?: string;
}
export interface TestCase {
    case_id: string;
    name: string;
    rationale?: string;
    preconditions: Step[];
    datasets: DataRow[];
    steps: Step[];
    cleanup: Step[];
}
export interface TestSuite {
    planning?: {
        original_task: string;
        rationale: string;
        input?: TextInput;
    };
    schema_version: "1";
    suite_id: string;
    name: string;
    source_refs: SourceRef[];
    cases: TestCase[];
}
export interface Binding {
    suite_run_id: string;
    case_run_id: string;
    phase: Phase;
    step_id: string;
    attempt_id: string;
}
export interface Observation {
    observation_id: string;
    binding: Binding;
    producer: {
        call_id: string;
        adapter: string;
        field: string;
    };
    context_id: string;
    output_name: string;
    value: Json;
    evidence_refs: string[];
    observed_at: string;
}
export interface Evidence {
    evidence_id: string;
    relative_path: string;
    media_type: string;
    sha256: string;
    redacted: boolean;
}
export interface CallRecord {
    call_id: string;
    binding: Binding;
    name: string;
    args_redacted: Json;
    started_at: string;
    finished_at?: string;
    isError?: boolean;
    result?: Json;
    body_started: "unknown" | boolean;
}
export interface AssertionResult {
    assertion_id: string;
    status: Status;
    operator: Operator;
    expected: Json;
    actual: Json;
    reason: string;
    operand_snapshot: {
        actual_observation_id?: string;
        expected_observation_id?: string;
        actual_path: string;
        expected_path?: string;
    };
    evidence_refs: string[];
    plan_revision: number;
}
export interface StepResult {
    step_id: string;
    phase: Phase;
    description: string;
    required: boolean;
    status: Status | "SUCCEEDED" | "RUNNING";
    started_at: string;
    finished_at?: string;
    duration_ms: number;
    reason?: string;
    calls: CallRecord[];
    observations: Observation[];
    assertion?: AssertionResult;
    cleanup_applicable?: boolean;
    capture_attempts?: {
        capture: Record<string, Capture>;
        reason: string;
        started_at: string;
        error?: string;
    }[];
}
export interface CaseRun {
    case_run_id: string;
    case_id: string;
    data_id: string;
    name: string;
    data: DataRow;
    session_id?: string;
    cleanup_session_id?: string;
    status: Status | "PENDING" | "RUNNING" | "WAITING_APPROVAL";
    lifecycle: "CREATED" | "RUNNING" | "FINISHED" | "CANCELLING" | "INTERRUPTED";
    steps: StepResult[];
    issues: string[];
    applied_revisions: number[];
    revision_history?: PlanRevision[];
    effective_required_assertion_ids: string[];
    effective_steps: Step[];
    resources: Record<string, {
        id: string;
        state: "exists" | "absent" | "unknown";
    }>;
    cancelled: boolean;
    blocked: boolean;
    integrity_error: boolean;
    incomplete: boolean;
    unsettled_call_ids: string[];
    resource_quarantined: boolean;
}
export interface BrowserRecording {
    recording_id: string;
    case_run_id: string;
    target_id: string;
    status: "RECORDING" | "COMPLETE" | "PARTIAL" | "FAILED" | "EMPTY";
    started_at: string;
    first_frame_at?: string;
    finished_at?: string;
    relative_path?: string;
    evidence_id?: string;
    bytes?: number;
    duration_ms?: number;
    reason?: string;
}
export interface SuiteRun {
    schema_version: "1";
    suite_run_id: string;
    name: string;
    created_at: string;
    finished_at?: string;
    lifecycle: "RUNNING" | "FINISHED" | "CANCELLING" | "INTERRUPTED";
    plan: TestSuite;
    instances: CaseRun[];
    evidence: Evidence[];
    recordings?: BrowserRecording[];
    incomplete: boolean;
    resource_quarantined: boolean;
    manifest: Record<string, Json>;
}
export interface PlanRevision {
    revision: number;
    parent_revision: number;
    reason: string;
    source_refs: SourceRef[];
    added_steps: Step[];
    target_instance_ids: string[];
    insertion_boundary: string;
    post_hoc: boolean;
}
export declare const ajv: Ajv;
export declare const planSchema: {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
        planning: {
            type: string;
            required: string[];
            additionalProperties: boolean;
            properties: {
                original_task: {
                    type: string;
                };
                rationale: {
                    type: string;
                };
                input: {
                    type: string;
                };
            };
        };
        schema_version: {
            type: string;
            enum: string[];
            description: string;
        };
        suite_id: {
            type: string;
            pattern: string;
            minLength: number;
        };
        name: {
            type: string;
            minLength: number;
        };
        source_refs: {
            type: string;
            minItems: number;
            items: {
                type: string;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        pattern: string;
                        minLength: number;
                    };
                    kind: {
                        type: string;
                    };
                    uri: {
                        type: string;
                    };
                    version: {
                        type: string;
                    };
                    locator: {
                        type: string;
                    };
                    excerpt: {
                        type: string;
                    };
                };
            };
        };
        cases: {
            type: string;
            minItems: number;
            items: {
                type: string;
                required: string[];
                additionalProperties: boolean;
                properties: {
                    case_id: {
                        type: string;
                        pattern: string;
                        minLength: number;
                    };
                    name: {
                        type: string;
                    };
                    rationale: {
                        type: string;
                    };
                    preconditions: {
                        type: string;
                        items: {
                            type: string;
                            required: string[];
                            additionalProperties: boolean;
                            properties: {
                                step_id: {
                                    type: string;
                                    pattern: string;
                                    minLength: number;
                                };
                                kind: {
                                    enum: string[];
                                };
                                checks: {
                                    type: string;
                                    items: {
                                        type: string;
                                        minLength: number;
                                    };
                                };
                                description: {
                                    type: string;
                                    minLength: number;
                                };
                                depends_on: {
                                    type: string;
                                    items: {
                                        type: string;
                                        pattern: string;
                                        minLength: number;
                                    };
                                    uniqueItems: boolean;
                                };
                                required: {
                                    type: string;
                                };
                                run_if: {
                                    enum: string[];
                                };
                                resource_ref: {
                                    type: string;
                                    pattern: string;
                                    minLength: number;
                                };
                                action: {
                                    type: string;
                                    required: string[];
                                    additionalProperties: boolean;
                                    properties: {
                                        goal: {
                                            type: string;
                                            minLength: number;
                                        };
                                        capability: {
                                            enum: string[];
                                        };
                                        allowed_targets: {
                                            type: string;
                                            minItems: number;
                                            items: {
                                                type: string;
                                                minLength: number;
                                            };
                                        };
                                        inputs: {
                                            type: string;
                                        };
                                        outputs: {
                                            type: string;
                                            additionalProperties: {
                                                type: string;
                                            };
                                        };
                                        completion_requirements: {
                                            type: string;
                                            items: {
                                                type: string;
                                                pattern: string;
                                                minLength: number;
                                            };
                                            uniqueItems: boolean;
                                        };
                                        capture_mode: {
                                            enum: string[];
                                        };
                                        capture: {
                                            type: string;
                                            additionalProperties: {
                                                type: string;
                                                required: string[];
                                                additionalProperties: boolean;
                                                properties: {
                                                    kind: {
                                                        enum: string[];
                                                    };
                                                    selector: {
                                                        type: string;
                                                    };
                                                    mode: {
                                                        enum: string[];
                                                    };
                                                    attribute: {
                                                        type: string;
                                                    };
                                                    url: {
                                                        type: string;
                                                    };
                                                    field: {
                                                        type: string;
                                                    };
                                                    index: {
                                                        type: string;
                                                        minimum: number;
                                                    };
                                                };
                                            };
                                        };
                                        approval: {
                                            type: string;
                                        };
                                    };
                                };
                                assertion: {
                                    type: string;
                                    required: string[];
                                    additionalProperties: boolean;
                                    properties: {
                                        observation_ref: {
                                            type: string;
                                        };
                                        operator: {
                                            enum: string[];
                                        };
                                        expected_ref: {
                                            type: string;
                                            pattern: string;
                                            description: string;
                                        };
                                        expected_observation_ref: {
                                            type: string;
                                        };
                                        literal: {
                                            type: string[];
                                            description: string;
                                        };
                                        rule_ref: {
                                            type: string;
                                            pattern: string;
                                            minLength: number;
                                        };
                                        unit: {
                                            type: string;
                                        };
                                        tolerance: {
                                            type: string;
                                            minimum: number;
                                        };
                                    };
                                };
                            };
                        };
                    };
                    datasets: {
                        type: string;
                        items: {
                            type: string;
                            required: string[];
                            additionalProperties: boolean;
                            properties: {
                                data_id: {
                                    type: string;
                                    pattern: string;
                                    minLength: number;
                                };
                                inputs: {
                                    type: string;
                                };
                                expected: {
                                    type: string;
                                };
                            };
                        };
                    };
                    steps: {
                        type: string;
                        minItems: number;
                        items: {
                            type: string;
                            required: string[];
                            additionalProperties: boolean;
                            properties: {
                                step_id: {
                                    type: string;
                                    pattern: string;
                                    minLength: number;
                                };
                                kind: {
                                    enum: string[];
                                };
                                checks: {
                                    type: string;
                                    items: {
                                        type: string;
                                        minLength: number;
                                    };
                                };
                                description: {
                                    type: string;
                                    minLength: number;
                                };
                                depends_on: {
                                    type: string;
                                    items: {
                                        type: string;
                                        pattern: string;
                                        minLength: number;
                                    };
                                    uniqueItems: boolean;
                                };
                                required: {
                                    type: string;
                                };
                                run_if: {
                                    enum: string[];
                                };
                                resource_ref: {
                                    type: string;
                                    pattern: string;
                                    minLength: number;
                                };
                                action: {
                                    type: string;
                                    required: string[];
                                    additionalProperties: boolean;
                                    properties: {
                                        goal: {
                                            type: string;
                                            minLength: number;
                                        };
                                        capability: {
                                            enum: string[];
                                        };
                                        allowed_targets: {
                                            type: string;
                                            minItems: number;
                                            items: {
                                                type: string;
                                                minLength: number;
                                            };
                                        };
                                        inputs: {
                                            type: string;
                                        };
                                        outputs: {
                                            type: string;
                                            additionalProperties: {
                                                type: string;
                                            };
                                        };
                                        completion_requirements: {
                                            type: string;
                                            items: {
                                                type: string;
                                                pattern: string;
                                                minLength: number;
                                            };
                                            uniqueItems: boolean;
                                        };
                                        capture_mode: {
                                            enum: string[];
                                        };
                                        capture: {
                                            type: string;
                                            additionalProperties: {
                                                type: string;
                                                required: string[];
                                                additionalProperties: boolean;
                                                properties: {
                                                    kind: {
                                                        enum: string[];
                                                    };
                                                    selector: {
                                                        type: string;
                                                    };
                                                    mode: {
                                                        enum: string[];
                                                    };
                                                    attribute: {
                                                        type: string;
                                                    };
                                                    url: {
                                                        type: string;
                                                    };
                                                    field: {
                                                        type: string;
                                                    };
                                                    index: {
                                                        type: string;
                                                        minimum: number;
                                                    };
                                                };
                                            };
                                        };
                                        approval: {
                                            type: string;
                                        };
                                    };
                                };
                                assertion: {
                                    type: string;
                                    required: string[];
                                    additionalProperties: boolean;
                                    properties: {
                                        observation_ref: {
                                            type: string;
                                        };
                                        operator: {
                                            enum: string[];
                                        };
                                        expected_ref: {
                                            type: string;
                                            pattern: string;
                                            description: string;
                                        };
                                        expected_observation_ref: {
                                            type: string;
                                        };
                                        literal: {
                                            type: string[];
                                            description: string;
                                        };
                                        rule_ref: {
                                            type: string;
                                            pattern: string;
                                            minLength: number;
                                        };
                                        unit: {
                                            type: string;
                                        };
                                        tolerance: {
                                            type: string;
                                            minimum: number;
                                        };
                                    };
                                };
                            };
                        };
                    };
                    cleanup: {
                        type: string;
                        items: {
                            type: string;
                            required: string[];
                            additionalProperties: boolean;
                            properties: {
                                step_id: {
                                    type: string;
                                    pattern: string;
                                    minLength: number;
                                };
                                kind: {
                                    enum: string[];
                                };
                                checks: {
                                    type: string;
                                    items: {
                                        type: string;
                                        minLength: number;
                                    };
                                };
                                description: {
                                    type: string;
                                    minLength: number;
                                };
                                depends_on: {
                                    type: string;
                                    items: {
                                        type: string;
                                        pattern: string;
                                        minLength: number;
                                    };
                                    uniqueItems: boolean;
                                };
                                required: {
                                    type: string;
                                };
                                run_if: {
                                    enum: string[];
                                };
                                resource_ref: {
                                    type: string;
                                    pattern: string;
                                    minLength: number;
                                };
                                action: {
                                    type: string;
                                    required: string[];
                                    additionalProperties: boolean;
                                    properties: {
                                        goal: {
                                            type: string;
                                            minLength: number;
                                        };
                                        capability: {
                                            enum: string[];
                                        };
                                        allowed_targets: {
                                            type: string;
                                            minItems: number;
                                            items: {
                                                type: string;
                                                minLength: number;
                                            };
                                        };
                                        inputs: {
                                            type: string;
                                        };
                                        outputs: {
                                            type: string;
                                            additionalProperties: {
                                                type: string;
                                            };
                                        };
                                        completion_requirements: {
                                            type: string;
                                            items: {
                                                type: string;
                                                pattern: string;
                                                minLength: number;
                                            };
                                            uniqueItems: boolean;
                                        };
                                        capture_mode: {
                                            enum: string[];
                                        };
                                        capture: {
                                            type: string;
                                            additionalProperties: {
                                                type: string;
                                                required: string[];
                                                additionalProperties: boolean;
                                                properties: {
                                                    kind: {
                                                        enum: string[];
                                                    };
                                                    selector: {
                                                        type: string;
                                                    };
                                                    mode: {
                                                        enum: string[];
                                                    };
                                                    attribute: {
                                                        type: string;
                                                    };
                                                    url: {
                                                        type: string;
                                                    };
                                                    field: {
                                                        type: string;
                                                    };
                                                    index: {
                                                        type: string;
                                                        minimum: number;
                                                    };
                                                };
                                            };
                                        };
                                        approval: {
                                            type: string;
                                        };
                                    };
                                };
                                assertion: {
                                    type: string;
                                    required: string[];
                                    additionalProperties: boolean;
                                    properties: {
                                        observation_ref: {
                                            type: string;
                                        };
                                        operator: {
                                            enum: string[];
                                        };
                                        expected_ref: {
                                            type: string;
                                            pattern: string;
                                            description: string;
                                        };
                                        expected_observation_ref: {
                                            type: string;
                                        };
                                        literal: {
                                            type: string[];
                                            description: string;
                                        };
                                        rule_ref: {
                                            type: string;
                                            pattern: string;
                                            minLength: number;
                                        };
                                        unit: {
                                            type: string;
                                        };
                                        tolerance: {
                                            type: string;
                                            minimum: number;
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
    };
};
export declare const actionSchema: {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
        goal: {
            type: string;
            minLength: number;
        };
        capability: {
            enum: string[];
        };
        allowed_targets: {
            type: string;
            minItems: number;
            items: {
                type: string;
                minLength: number;
            };
        };
        inputs: {
            type: string;
        };
        outputs: {
            type: string;
            additionalProperties: {
                type: string;
            };
        };
        completion_requirements: {
            type: string;
            items: {
                type: string;
                pattern: string;
                minLength: number;
            };
            uniqueItems: boolean;
        };
        capture_mode: {
            enum: string[];
        };
        capture: {
            type: string;
            additionalProperties: {
                type: string;
                required: string[];
                additionalProperties: boolean;
                properties: {
                    kind: {
                        enum: string[];
                    };
                    selector: {
                        type: string;
                    };
                    mode: {
                        enum: string[];
                    };
                    attribute: {
                        type: string;
                    };
                    url: {
                        type: string;
                    };
                    field: {
                        type: string;
                    };
                    index: {
                        type: string;
                        minimum: number;
                    };
                };
            };
        };
        approval: {
            type: string;
        };
    };
};
export declare const assertionSchema: {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
        observation_ref: {
            type: string;
        };
        operator: {
            enum: string[];
        };
        expected_ref: {
            type: string;
            pattern: string;
            description: string;
        };
        expected_observation_ref: {
            type: string;
        };
        literal: {
            type: string[];
            description: string;
        };
        rule_ref: {
            type: string;
            pattern: string;
            minLength: number;
        };
        unit: {
            type: string;
        };
        tolerance: {
            type: string;
            minimum: number;
        };
    };
};
export declare const captureSchema: {
    type: string;
    additionalProperties: {
        type: string;
        required: string[];
        additionalProperties: boolean;
        properties: {
            kind: {
                enum: string[];
            };
            selector: {
                type: string;
            };
            mode: {
                enum: string[];
            };
            attribute: {
                type: string;
            };
            url: {
                type: string;
            };
            field: {
                type: string;
            };
            index: {
                type: string;
                minimum: number;
            };
        };
    };
};
/** 运行时只绑定采集方法；输出语义、类型、目标范围和断言预期仍来自冻结计划。 */
export declare function validateCaptures(action: ActionSpec, captures: Record<string, Capture>): void;
/** 读取自有JSON字段；不存在返回undefined，不作类型转换。 */
export declare function field(value: unknown, path: string): unknown;
/** 校验计划的结构、引用、数据及必需依赖。 */
export declare function parsePlan(input: unknown, allowIntents?: boolean): TestSuite;
/** 为每条数据创建独立实例，不做笛卡尔积。 */
export declare function expand(plan: TestSuite): CaseRun[];
/** 按冻结的有效断言集合聚合，局部可选问题不遮蔽必需结果。 */
export declare function aggregate(run: CaseRun): Status;
export declare function statistics(run: SuiteRun): Record<string, number>;
