import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import { type BrowserPreferences } from "../browser-preferences.js";
import { type PreviewPreferences, type PreviewSettingsInfo } from "../preview-preferences.js";
export interface BrowserSettingsFields {
    browser?: BrowserPreferences;
    browserConnection?: BrowserPreferences;
    browserPreview?: PreviewPreferences;
}
export declare function BrowserSettings({ form, info, refresh, }: {
    form: ConfigForm<BrowserSettingsFields>;
    info: PreviewSettingsInfo;
    refresh: () => Promise<void>;
}): import("react/jsx-runtime").JSX.Element;
