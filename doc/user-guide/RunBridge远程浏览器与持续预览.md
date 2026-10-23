# RunBridge 远程浏览器与持续预览

[文档导航](../README.md) · [安装与运维](../deployment/安装与运维.md) · [当前架构](../architecture/RunBridge远程执行与画面.md)

浏览器可在另一台机器或虚拟机运行。插件通过 Hub 在当前 DSH Agent 上执行，持续画面来自同一页面；TXT、Markdown、CSV、审核、实际步骤和报告入口继续使用。整个 Node 使用权由一份有限租约独占，浏览器资源 FREE 和 Node 未领取分别判断。

## 准备服务与私有文件

需要插件 **0.15.0**、公开 DSH **0.2.1-alpha.1／alpha.2／alpha.3**、Node.js **22.19+**，配套 RunBridge **Hub 0.9.1／Node 0.8.1**。租约接口从 Hub 0.9.0／Node 0.8.0 引入，具体实测版本见本轮验收。Hub 开启 MCP、配置独立 hub_token_file 与 public_url；Node 完成登记并提供 READY 的受管理 Chromium。服务安装、启动及迁移按两端自己的当前指南进行，浏览器操作及 PNG 采集由 Node 的 Python Playwright 执行。

两类文件都放在 **运行 DSH 的机器** 的私有目录，建议权限 600。支持 JSON 与带注释 YAML，默认模板为 YAML，按内容解析，不依赖后缀；最多 32 KiB，只允许单一配置对象，不使用重复字段或多文档。字段用字符串并保留引号，不把令牌发给模型、写进用例或提交 Git。enrollment.token 只用于 Node 登记，node_token 只用于设备身份，均不能代替下列凭据。

### Hub 自动领取（推荐）

向 Hub 维护者取得共享申请凭据，保存为 runbridge-hub.yaml：

```yaml
# 只查询资源池和申请整个 Node，不能直接执行设备动作。
hub_url: "https://hub.example/runbridge"
hub_token: "<Hub维护者提供的共享申请凭据>"
```

hub_url 是可达的 Hub 基址，不含末尾 /mcp，反向代理前缀保留。Hub 共享凭据不代表用户／账号，不提供对其他持有者的强制回收或接管权限。目标 Node ID 在设置页单独填写，不在此文件中混入节点令牌。

### 现成访问文件

也可在 Hub 预先领取后，将原始 access_config 保存为 JSON 或 YAML：

```yaml
# 本文件是一份有限的 Node 使用权，结束后插件会主动归还。
hub_url: "https://hub.example/runbridge"
node_id: "node_example"
grant_id: "grant_example"
access_token: "<Hub本次签发的节点令牌>"
expires_at: "2030-01-01T01:00:00Z"
```

新 Hub 导出这五个字段；旧四字段文件仍可解析，但原来的静态许可不自动迁移。expires_at 是导出时的期限，续租后及空闲回收的实际状态向 Hub 查询，修改本机时间字段不能续租。共享同一令牌的客户端共用一份使用权，插件归还后它们都失去执行能力，应为本批使用专用租约。失效后插件不重新申请，因为此模式没有 Hub 申请凭据。

## 保存连接并运行

1. 打开 **设置 → 测试插件 → 浏览器设置**，位置选 **远程 RunBridge MCP**，选择明确的连接来源。
2. 自动模式填写 **Hub 认证文件**完整路径和 **目标 Node ID**；现成模式填写 **访问文件**完整路径。两类文件分别校验，不通过字段缺失猜另一种来源。展开 **查看文件格式与空白模板**，复制或下载对应 YAML 模板；模板不签发租约。
3. **读取配置**只在宿主解析文件并显示无令牌摘要。**检测连接**在自动模式只查询资源与同源工具目录，显示“Hub 目录已验证 · 尚未领取”；现成模式查询原租约、完成 MCP 握手和只读节点核对。两种检测都不创建浏览器、不领取、不刷新空闲期限。
4. 填受管理资源 ID，通常 chromium。自动模式的 **整批 Node 租期**可留空，由 Hub 默认取 min(3600 秒, 当前上限)；显式值须为正整数且不超过 Hub 配置上限。上限默认一天，空闲默认十分钟，均由 Hub 配置，插件不硬编码上限。
5. **每条用例的会话租期**为 1～3600 秒，默认 1800 秒。它与整批 Node 租期、单个工具超时分别计算，续 Node 租约不会延长已经创建的浏览器会话。
6. 按需勾选 **显示实时画面**并点击 **保存浏览器设置**。有效文件可离线保存，保存不会领取或检测网络；当前测试保持原连接，下次运行生效。远程执行无需另行注册通用 RunBridge MCP 或安装本机 Browscreen。
7. 在正确对话工作区执行 /test-run cases.md 或 /test-data data.csv --file cases.md。规划／审核只读取工具目录，不占 Node；批准并进入首个浏览器初始化后领取，实际 MCP tools/list 与目录不一致时在业务前停止。纯接口测试不领取 Node。

一批 TXT／Markdown／CSV 多实例共用原 Node 租约，逐用例分别创建、关闭浏览器；浏览器关闭后仍持有 Node。整批完成、取消或失败时等待原操作结算，再归还 Node，确认 RELEASED 且 cleanup=COMPLETE 后封存报告。领取响应丢失时不重复领取或换新令牌续跑；没有取得原令牌的未知申请需 Hub 维护者核查。

运行中插件用原节点令牌查询并按需续租，续租不刷新空闲计时。只有真实设备执行活动刷新空闲；长时间模型思考、人工等待、看画面或查询仍可能被回收。租约失效后停止原任务，保留原 grant/session/request，不自动领取新设备继续旧步骤。进度和报告分别展示业务断言、到期／空闲状态与设备归还结果。

自动领取的执行文件由插件保存在 outputRoot/.runbridge-access/，目录 700、文件 600；位于报告目录之外，不随报告交付。已确认归还后删除本轮自动文件，未知／隔离时保留以恢复；用户提供的现成文件不删除、不重写。

### profile 配置示例

普通用户优先使用设置页；需要停服编辑时，在当前 profile 已注册的 harness-test 条目 config.browserConnection 中填写，下面均不含原始凭据：

```yaml
browserConnection:
  backend: runbridge
  connectionSource: hub
  hubFile: "/private/runbridge-hub.yaml"
  nodeId: "node_example"
  # nodeLeaseSeconds: 3600  # 可省略，交给 Hub 默认策略。
  accessFile: ""           # 保留另一来源偏好，不在自动模式读取。
  resourceId: "chromium"
  leaseSeconds: 1800
  previewEnabled: true
```

现成文件模式改为 connectionSource: access-file 和 accessFile: "/private/runbridge-access.yaml"；Hub 文件、目标和 Node 租期可保留为另一来源偏好，现成模式不使用它们。历史配置没写 connectionSource 时按现成文件读取。browserConnection 与 browserPreview 仍用一次 revision 原子保存；高优先级 overlay 固定时先修订原始来源，避免叠加覆盖。

检测结论有时间，仅代表当时状态。来源、路径、Node、资源或租期变化撤销旧结论；设置可见时每十五秒及重新聚焦只重读文件，不自动保活。草稿关闭设置后保留，放弃恢复全部已保存偏好；整页确认离开后不持久保留草稿。切回本机模式继续沿用原预览指南。

## 看画面、读结果

首帧到达后显示浏览器浮窗；可以隐藏或收回侧边栏。关闭观看不停止用例。切页时先撤下旧图，新页首帧到达后再显示；超过五秒没有新帧、断开、隔离或会话结束时撤下图片。

预览复用当前 MCP 的 `browser_status` 读取画面状态，然后订阅同一会话的画面流。网络中断后会核对状态并重连；许可被拒绝或会话失效时停止自动重连，需检查原许可及资源。旧 HTTP 会话查询返回 410 时应升级插件，不应因此重新签发许可。画面异常本身不会改变业务断言。

浏览器网页中的 `localhost` 指 **Node 所在机器**；接口测试 GET 则从 **DSH 宿主** 发出。两端都需要访问各自的目标地址，地址可不同；不要把宿主回环地址当作虚拟机回环地址。

断言由固定 DOM 或 HTTP 响应采集并计算。截图、操作成功和模型说明都不能代替业务检查。实际操作与失败尝试保存在报告中；截图证据来自 MCP 原始 PNG，浮窗只保存最新帧。当前提供持续 PNG 预览与报告截图，远程视频录制和历史画面回放尚未提供。

固定 DOM 采集仅覆盖主页面；iframe 操作不代表 iframe 断言采集也已支持。文件上传读取 DSH 宿主上的明确路径，单文件和多文件合计最多 4 MiB 原始字节。当前 Hub 接纳编码后的有界请求，Node 解码检查总量；插件会在超出原始总量时先拒绝发送。

## 异常与恢复

插件把本轮节点、grant、资源、启动请求、会话、页面和连接代次绑定在运行中，模型不能覆盖这些身份。响应丢失不会自动重放写操作；未知启动按原请求核对会话，不能另起浏览器掩盖未知状态。

动作结果已返回 request_id，但执行仍在途或结果不确定时，可用 `tool_request_status(request_id=原动作ID)` 查询。插件自动绑定原会话，当前页已关闭也能查询；该 ID 与启动请求身份分开，不允许覆盖节点或会话。查询 SUCCEEDED 仅表示动作完成，业务结果仍由 `test_capture` 验证。若响应完全丢失、未取得动作 ID，不能猜测 ID，也不能盲目再次提交。

已分配会话的关闭必须收到本次会话的技术终态（CLOSED、FAILED 或 INTERRUPTED）及 `cleanup=COMPLETE`。技术终态本身不代表业务通过；清理 PENDING/UNKNOWN 会保留隔离。MCP 断开也不代表浏览器已经清理。

具备持久请求查询的 Hub 可以找回准备或连接失败后已分配的会话，插件继续核对并关闭同一会话。另一种可解除隔离的证据是：原 grant、节点和 request_id 明确对应 FAILED、session_id=null、execution_outcome=NOT_STARTED，且会话列表为空。这表示本请求从未分配浏览器，插件只记录核对证据，不发送关闭请求。PENDING、UNKNOWN、NOT_FOUND 或字段矛盾本身都不能证明资源不存在，仍保留隔离；旧 Hub 的空查询也不能据此释放。

隔离后在 **测试环境 → 处理并释放** 使用原节点令牌查询及归还原 grant；这会回收该租约下遗留会话，并等待 RELEASED／COMPLETE。旧业务结果、会话和请求 UNKNOWN 保持原样。QUARANTINED、释放超时、缺少原令牌或换成另一 grant 时保留隔离，由 Hub／设备维护者核查并按[环境处置指南](测试环境卡住怎么办.md)提交实际证据。共享 hub_token 不能强制回收，也不能接管旧会话。

本轮租约适配见[0.15.0 验收](../project/0.15.0版本发布验收.md)。[0.14.1 YAML／JSON 验收](../project/0.14.1版本发布验收.md)、[0.14.0 配置交互](../project/0.14.0版本发布验收.md)和[0.13.2 的 0.7.0 适配](../project/0.13.2版本发布验收.md)保留历史范围。旧服务和旧静态许可不自动迁移到新的独占租约；升级服务前按 Hub 的迁移指南释放旧资源并重新领取。Windows、公网 TLS/NAT 与容量不纳入本轮新实测。
