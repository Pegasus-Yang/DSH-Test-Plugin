/** 设置页与宿主共享的预览字段；目录和初始化文件由宿主生成。 */
export interface PreviewPreferences {
    enabled: boolean;
    recordingEnabled?: boolean;
    browscreenExecutable: string;
    port: number;
    mcpId: string;
}
export declare const previewPreferenceDefaults: PreviewPreferences;
export interface PreviewSettingsInfo {
    namespace: string;
    mcpInstances: {
        id: string;
        label: string;
        compatible: boolean;
    }[];
    message: string;
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
