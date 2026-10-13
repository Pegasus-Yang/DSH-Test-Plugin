# RunBridge 远程浏览器与持续预览

[文档导航](../README.md) · [安装与运维](../deployment/安装与运维.md) · [当前架构](../architecture/RunBridge远程执行与画面.md)

浏览器可以运行在另一台机器或虚拟机中。插件通过 RunBridge Hub 的 MCP 执行用例，并把同一页面的持续画面显示在现有浮窗中。原有 TXT、Markdown、CSV、计划审核、实际步骤、断言和报告入口继续使用。

## 准备服务

需要插件 **0.12.0**、公开 DSH **0.2.1-alpha.1**、Node.js **22.19+**，以及 RunBridge Hub、Node **0.5.0**。Hub 安装 `mcp` extra，开启 `/mcp` 并配置允许的 Host；Node 配置受管理 Chromium 和官方 Playwright **1.63.0** 运行时。Hub 的 Python Playwright 与 Node 的运行时版本须匹配。

先按服务项目的 `doc/user-guide/MCP浏览器接入.md`（Hub）和 `doc/user-guide/MCP对接准备.md`（Node）完成登记、运行和许可签发。确认节点 ONLINE、目标资源 READY/FREE，能力中 `host.managed_visual=cdp-png`。这表示实际探测支持采集；画面仍须等到用例启动并产生首帧才显示。

Node 所有者签发仅允许目标受管理资源的访问许可，将生成的访问文件安全交付到 **DSH 宿主**。文件内容是连接配置，例如：

```json
{
  "hub_url": "http://hub.example:8787",
  "node_id": "node_example",
  "grant_id": "grant_example",
  "access_token": "<所有者签发的访问令牌>"
}
```

本机文件建议权限为 `600`，放在不提交的私有目录。不要把访问令牌填写到用例、模型对话或截图里。DSH 无需另行注册一个通用 RunBridge MCP；测试插件会在当前 Agent 上建立连接并注册工具。

## 保存连接并运行

1. 打开 **设置 → 测试插件 → 浏览器执行**。
2. 浏览器位置选 **远程 RunBridge MCP**；填写 DSH 宿主上私有访问文件的完整路径、受管理资源 ID（通常 `chromium`）和每条用例的租期（1～3600 秒，须覆盖执行及收尾）。
3. 勾选 **显示远程浏览器持续画面**，点击 **保存浏览器连接**。下一次测试读取这些设置；执行中的测试保持原连接。
4. 在正确的工作区运行 `/test-run cases.md`，或 `/test-data data.csv --file cases.md`。CSV 先展示全部实例并审核；浏览器在通过执行入口后按需申请。

通过命令行 overlay 固定的插件配置可能不可在网页中修改；页面会明确提示。普通安装请在 profile 中启用插件后使用设置页。也可以在插件的 profile 配置中填写 `browser: { backend: runbridge, accessFile: 私有文件路径, resourceId: chromium, leaseSeconds: 1800, previewEnabled: true }`。

选择远程模式后无需为该执行安装本机 Playwright MCP 或 Browscreen。切回本机模式仍按原预览指南配置。远程模式不会自动复用已有 Chrome 登录状态；每条浏览器用例创建独立上下文并确认收尾。

## 看画面、读结果

首帧到达后显示浏览器浮窗；可以隐藏或收回侧边栏。关闭观看不停止用例。切页时先撤下旧图，新页首帧到达后再显示；超过五秒没有新帧、断开、隔离或会话结束时撤下图片。

浏览器网页中的 `localhost` 指 **Node 所在机器**；接口测试 GET 则从 **DSH 宿主** 发出。两端都需要访问各自的目标地址，地址可不同；不要把宿主回环地址当作虚拟机回环地址。

断言由固定 DOM 或 HTTP 响应采集并计算。截图、操作成功和模型说明都不能代替业务检查。实际操作与失败尝试保存在报告中；截图证据来自 MCP 原始 PNG，浮窗只保存最新帧。当前提供持续 PNG 预览与报告截图，远程视频录制和历史画面回放尚未提供。

## 异常与恢复

插件把本轮节点、grant、资源、启动请求、会话、页面和连接代次绑定在运行中，模型不能覆盖这些身份。响应丢失不会自动重放写操作；未知启动按原请求核对会话，不能另起浏览器掩盖未知状态。

关闭必须收到本次会话的技术终态（CLOSED、FAILED 或 INTERRUPTED）及 `cleanup=COMPLETE`。技术终态本身不代表业务通过；PENDING/UNKNOWN 会保留隔离。MCP 断开也不代表浏览器已经清理。

隔离后在 **测试环境 → 处理并释放** 使用原访问文件核对并关闭遗留会话，旧结果和证据保持原样。若原许可已失效、文件换成另一 grant，或 Hub 重启后无法唯一找回未知启动，请由资源所有者核查，按[环境处置指南](测试环境卡住怎么办.md)提交实际处置证据。不能用新许可接管旧会话。

本轮实测范围见[远程浏览器接入验收](../project/RunBridge远程浏览器接入验收.md)。当前验证的虚拟机为 Ubuntu ARM64；Windows、公网 TLS/NAT 和容量场景未在本轮验证。
