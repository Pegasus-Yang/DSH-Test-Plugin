/** 设置页与宿主共享的预览字段；目录和初始化文件由宿主生成。 */
export interface PreviewPreferences {
    enabled: boolean;
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
export declare const browscreenVersionRange = ">=0.2.1,<0.3.0";
export interface BrowscreenCheck {
    ok: boolean;
    message: string;
    executable?: string;
    version?: string;
    code?: string;
}
