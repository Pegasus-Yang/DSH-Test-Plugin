/** 设置页与宿主共享的预览字段；目录和初始化文件由宿主生成。 */
export interface PreviewPreferences {
  enabled: boolean;
  browscreenProject: string;
  port: number;
  mcpId: string;
}
export const previewPreferenceDefaults: PreviewPreferences = {
  enabled: false,
  browscreenProject: "",
  port: 13390,
  mcpId: "",
};
export interface PreviewSettingsInfo {
  namespace: string;
  mcpInstances: { id: string; label: string; compatible: boolean }[];
  message: string;
}
