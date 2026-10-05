export const previewPreferenceDefaults = {
    enabled: false,
    recordingEnabled: false,
    browscreenExecutable: "browscreen",
    port: 13390,
    mcpId: "",
};
export const browscreenVersionRange = ">=0.3.0,<0.4.0";
export const videoInstallHint = "请在 DSH 宿主安装录制依赖：uv tool install --force --python 3.14 'browscreen[video]==0.3.0' -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com。安装后重新执行测试。";
