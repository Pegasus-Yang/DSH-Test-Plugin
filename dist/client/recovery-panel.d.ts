import type { RecoverySnapshot } from "../recovery.js";
export interface RecoveryActions {
    readRecovery: (signal: AbortSignal) => Promise<RecoverySnapshot>;
    recover: (token: string) => Promise<string>;
    releaseEvidence: (file: string, token: string) => Promise<string>;
}
export declare function RecoveryPanel({ readRecovery, recover, releaseEvidence, }: RecoveryActions): import("react/jsx-runtime").JSX.Element;
