import type { ConfigForms } from "@deepseek-ai/dsh-client-ui-settings/client";
import { type RecoveryActions } from "./recovery-panel.js";
import { type ReportActions } from "./report-controls.js";
export declare function PreviewSettingsPage({ forms, rebuildReport, describeReport, tryPreview, stopPreview, currentSession, ...recovery }: {
    forms: ConfigForms;
    tryPreview?: () => Promise<string>;
    stopPreview?: () => Promise<string>;
    currentSession?: () => string | undefined;
} & RecoveryActions & ReportActions): import("react/jsx-runtime").JSX.Element;
