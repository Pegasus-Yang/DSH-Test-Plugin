import { type PreviewPreferences, type PreviewSettingsInfo } from "../preview-preferences.js";
export declare const localGuide = "https://github.com/Pegasus-Yang/DSH-Test-Plugin/blob/main/doc/user-guide/\u6D4F\u89C8\u5668\u5B9E\u65F6\u9884\u89C8\u4E00\u6B65\u4E00\u6B65\u914D\u7F6E.md";
export declare function LocalPreviewSettings({ value, edit, info, refresh, errors, }: {
    value: PreviewPreferences;
    edit: (value: Partial<PreviewPreferences>) => void;
    info: PreviewSettingsInfo;
    refresh: () => Promise<void>;
    errors: Record<string, string>;
}): import("react/jsx-runtime").JSX.Element;
