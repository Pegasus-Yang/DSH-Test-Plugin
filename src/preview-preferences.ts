/** 设置页与宿主共享的预览字段；目录和初始化文件由宿主生成。 */
export interface PreviewPreferences {
  enabled: boolean;
  recordingEnabled?: boolean;
  browscreenExecutable: string;
  port: number;
  mcpId: string;
}
export const previewPreferenceDefaults: PreviewPreferences = {
  enabled: false,
  recordingEnabled: false,
  browscreenExecutable: "browscreen",
  port: 13390,
  mcpId: "",
};
export interface PreviewSettingsInfo {
  namespace: string;
  mcpInstances: { id: string; label: string; compatible: boolean }[];
  message: string;
}

export const browscreenVersionRange = ">=0.3.0,<0.4.0";
export const videoInstallHint =
  "请在 DSH 宿主安装录制依赖：uv tool install --force --python 3.14 'browscreen[video]==0.3.0' -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com。安装后重新执行测试。";
export interface BrowscreenCheck {
  ok: boolean;
  message: string;
  executable?: string;
  version?: string;
  code?: string;
}
