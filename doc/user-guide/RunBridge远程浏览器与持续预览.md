# RunBridge 远程浏览器与持续预览

[文档导航](../README.md) · [安装与运维](../deployment/安装与运维.md) · [当前架构](../architecture/RunBridge远程执行与画面.md)

浏览器可以运行在另一台机器或虚拟机中。插件通过 RunBridge Hub 的 MCP 执行用例，并把同一页面的持续画面显示在现有浮窗中。原有 TXT、Markdown、CSV、计划审核、实际步骤、断言和报告入口继续使用。

## 准备服务

需要插件 **0.13.2**、公开 DSH **0.2.1-alpha.1、alpha.2 或 alpha.3**、Node.js **22.19+**，以及 RunBridge Hub/Node **0.7.0**。Hub 安装 `mcp` extra，开启 `/mcp` 并配置允许的 Host；Node 配置受管理 Chromium 和 Python Playwright **1.63.0** 运行时。浏览器操作和采集均在 Node 的 Python worker 执行，Hub 无需安装 Playwright。

先按两端当前快速开始和 MCP 接入文档完成登记、运行和许可签发。确认节点 ONLINE、目标受管理资源 READY/FREE。启动本次会话后检查 `browser_status` 返回的 `visual.supported` 与 `stream_path`；声明支持不等于已收到首帧，实际画面需等待 LIVE 和新 PNG。不再要求旧版 `host.managed_visual` 字段。

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

预览复用当前 MCP 的 `browser_status` 读取画面状态，然后订阅同一会话的画面流。网络中断后会核对状态并重连；许可被拒绝或会话失效时停止自动重连，需检查原许可及资源。旧 HTTP 会话查询返回 410 时应升级插件，不应因此重新签发许可。画面异常本身不会改变业务断言。

浏览器网页中的 `localhost` 指 **Node 所在机器**；接口测试 GET 则从 **DSH 宿主** 发出。两端都需要访问各自的目标地址，地址可不同；不要把宿主回环地址当作虚拟机回环地址。

断言由固定 DOM 或 HTTP 响应采集并计算。截图、操作成功和模型说明都不能代替业务检查。实际操作与失败尝试保存在报告中；截图证据来自 MCP 原始 PNG，浮窗只保存最新帧。当前提供持续 PNG 预览与报告截图，远程视频录制和历史画面回放尚未提供。

固定 DOM 采集仅覆盖主页面；iframe 操作不代表 iframe 断言采集也已支持。文件上传读取 DSH 宿主上的明确路径，单文件和多文件合计最多 4 MiB 原始字节。Hub 0.7.0 接纳编码后的有界请求，Node 解码检查总量；插件会在超出原始总量时先拒绝发送。

## 异常与恢复

插件把本轮节点、grant、资源、启动请求、会话、页面和连接代次绑定在运行中，模型不能覆盖这些身份。响应丢失不会自动重放写操作；未知启动按原请求核对会话，不能另起浏览器掩盖未知状态。

动作结果已返回 request_id，但执行仍在途或结果不确定时，可用 `tool_request_status(request_id=原动作ID)` 查询。插件自动绑定原会话，当前页已关闭也能查询；该 ID 与启动请求身份分开，不允许覆盖节点或会话。查询 SUCCEEDED 仅表示动作完成，业务结果仍由 `test_capture` 验证。若响应完全丢失、未取得动作 ID，不能猜测 ID，也不能盲目再次提交。

已分配会话的关闭必须收到本次会话的技术终态（CLOSED、FAILED 或 INTERRUPTED）及 `cleanup=COMPLETE`。技术终态本身不代表业务通过；清理 PENDING/UNKNOWN 会保留隔离。MCP 断开也不代表浏览器已经清理。

具备持久请求查询的 Hub 可以找回准备或连接失败后已分配的会话，插件继续核对并关闭同一会话。另一种可解除隔离的证据是：原 grant、节点和 request_id 明确对应 FAILED、session_id=null、execution_outcome=NOT_STARTED，且会话列表为空。这表示本请求从未分配浏览器，插件只记录核对证据，不发送关闭请求。PENDING、UNKNOWN、NOT_FOUND 或字段矛盾本身都不能证明资源不存在，仍保留隔离；旧 Hub 的空查询也不能据此释放。

隔离后在 **测试环境 → 处理并释放** 使用原访问文件核对遗留资源，旧结果和证据保持原样。若原许可已失效、文件换成另一 grant，或无法唯一找回未知启动，请由资源所有者核查，按[环境处置指南](测试环境卡住怎么办.md)提交实际处置证据。不能用新许可接管旧会话。新 Hub 的持久记录支持重启后按原请求查询，但没有记录仍属于未知结果。

本轮适配范围及实际结果见[0.13.2 验收](../project/0.13.2版本发布验收.md)。旧 Hub 0.5.1 / Node 0.5.0 的 MCP 兼容路径保留，历史实机结果见[首次接入](../project/RunBridge远程浏览器接入验收.md)和[请求恢复兼容验收](../project/RunBridge请求恢复兼容验收.md)。本轮 0.7.0 隔离联调在 macOS ARM64 运行；旧版、Ubuntu 虚拟机、Windows、公网 TLS/NAT 和容量均不冒充本轮验证。
