import type { InjectFace, PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ProgressSnapshot } from "../progress-model.js";
import { type ReportActions } from "./report-controls.js";
export interface ProgressActions extends ReportActions {
    notice: {
        getSnapshot: () => string;
        subscribe: (listener: () => void) => () => void;
        dismiss: () => void;
    };
    read: (signal: AbortSignal) => Promise<ProgressSnapshot | null>;
    openDetails: () => void;
    previewVisible: {
        getSnapshot: () => boolean;
        subscribe: (listener: () => void) => () => void;
    };
    openPreview: (state: ProgressSnapshot) => void;
    followPreview: (state: ProgressSnapshot) => void;
}
export declare function ProgressDock(props: PropsRuntime<"conversation.input.dock"> & InjectFace<ProgressActions>): import("react/jsx-runtime").JSX.Element;
/** 原生审核接管输入区时，标题旁的入口仍可查看步骤和持续观察状态。 */
export declare function ProgressHeader(props: PropsRuntime<"conversation.session.header.actions"> & InjectFace<ProgressActions>): import("react/jsx-runtime").JSX.Element | null;
export declare function ProgressDetails(props: PropsRuntime<"sidebar.right.pane.tab"> & InjectFace<ProgressActions>): import("react/jsx-runtime").JSX.Element;
export declare function PreviewPanel(props: PropsRuntime<"sidebar.right.pane.tab"> & InjectFace<ProgressActions>): import("react/jsx-runtime").JSX.Element;
