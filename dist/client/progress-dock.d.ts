import type { ProgressSnapshot } from "../progress-model.js";
import type { ProgressActions } from "./components.js";
export declare function ProgressCard({ snapshot, now, failed, actions, }: {
    snapshot: ProgressSnapshot;
    now: number;
    failed: boolean;
    actions: ProgressActions;
}): import("react/jsx-runtime").JSX.Element;
