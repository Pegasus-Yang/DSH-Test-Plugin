export interface PreviewPreferences {
    schemaVersion?: number;
    enabled: boolean;
    recordingEnabled?: boolean;
    browscreenExecutable: string;
    port: number;
    mcpId: string;
}
export declare const previewPreferenceDefaults: PreviewPreferences;
/** 旧 RunBridge 的画面开关独立保存，迁移时不被旧本机媒体偏好覆盖。 */
export declare function effectivePreviewPreferences(browser?: import("./browser-preferences.js").BrowserPreferences, media?: PreviewPreferences): PreviewPreferences | undefined;
export interface PreviewSettingsInfo {
    browserConnection?: import("./browser-preferences.js").BrowserPreferences;
    namespace: string;
    nativeTools?: string[];
    agentVisible?: boolean;
    mcpInstances: {
        id: string;
        label: string;
        compatible: boolean;
        enabled?: boolean;
        tools?: string[];
        visible?: boolean;
    }[];
    message: string;
    activeMedia?: {
        enabled: boolean;
        mode: string;
        reason: string;
        source?: string;
        frames: number;
    };
}
export declare const browscreenVersionRange = ">=0.3.0,<0.4.0";
export declare const videoInstallHint = "\u8BF7\u5728 DSH \u5BBF\u4E3B\u5B89\u88C5\u5F55\u5236\u4F9D\u8D56\uFF1Auv tool install --force --python 3.14 'browscreen[video]==0.3.0' -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com\u3002\u5B89\u88C5\u540E\u91CD\u65B0\u6267\u884C\u6D4B\u8BD5\u3002";
export interface BrowscreenCheck {
    ok: boolean;
    message: string;
    executable?: string;
    version?: string;
    code?: string;
}
