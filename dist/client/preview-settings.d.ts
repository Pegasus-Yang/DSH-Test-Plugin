import type { ConfigForms } from "@deepseek-ai/dsh-client-ui-settings/client";
import { type RecoveryActions } from "./recovery-panel.js";
import { type ReportActions } from "./report-controls.js";
export declare function PreviewSettingsPage({ forms, rebuildReport, ...recovery }: {
    forms: ConfigForms;
} & RecoveryActions & ReportActions): import("react/jsx-runtime").JSX.Element;
