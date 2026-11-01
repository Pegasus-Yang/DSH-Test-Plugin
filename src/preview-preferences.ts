/** 设置页与宿主共享的预览字段；目录和初始化文件由宿主生成。 */
import { runbridgeEnabled } from "./browser-preferences.js";
export interface PreviewPreferences {
  schemaVersion?: number;
  enabled: boolean;
  recordingEnabled?: boolean;
  browscreenExecutable: string;
  port: number;
  mcpId: string;
}
export const previewPreferenceDefaults: PreviewPreferences = {
  schemaVersion: 2,
  enabled: false,
  recordingEnabled: false,
  browscreenExecutable: "browscreen",
  port: 13390,
  mcpId: "",
};
/** 旧 RunBridge 的画面开关独立保存，迁移时不被旧本机媒体偏好覆盖。 */
export function effectivePreviewPreferences(
  browser?: import("./browser-preferences.js").BrowserPreferences,
  media?: PreviewPreferences,
): PreviewPreferences | undefined {
  if (browser && runbridgeEnabled(browser) && media?.schemaVersion !== 2)
    return {
      ...previewPreferenceDefaults,
      ...media,
      enabled: browser.previewEnabled,
    };
  return media;
}
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
