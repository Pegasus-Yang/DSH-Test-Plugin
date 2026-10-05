import { type PlanRevision, type SuiteRun } from "./contracts.js";
import type { Recorder } from "./recorder.js";
export declare function applyRevision(run: SuiteRun, recorder: Recorder, proposal: Omit<PlanRevision, "revision" | "parent_revision">, budget: number): PlanRevision;
