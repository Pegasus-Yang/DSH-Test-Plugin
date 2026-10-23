import { type BrowserPreferences } from "../browser-preferences.js";
import type { RunBridgeSettingsResult } from "../runbridge-settings.js";
export declare const remoteGuide = "https://github.com/Pegasus-Yang/DSH-Test-Plugin/blob/main/doc/user-guide/RunBridge\u8FDC\u7A0B\u6D4F\u89C8\u5668\u4E0E\u6301\u7EED\u9884\u89C8.md";
export declare function RunBridgeConnection({ value, edit, result, checking, read, cancel, errors, }: {
    value: BrowserPreferences;
    edit: (value: Partial<BrowserPreferences>) => void;
    result?: RunBridgeSettingsResult;
    checking: boolean;
    read: (connect: boolean) => void;
    cancel: () => void;
    errors: Record<string, string>;
}): import("react/jsx-runtime").JSX.Element;
