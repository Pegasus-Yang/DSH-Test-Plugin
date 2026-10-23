# RunBridge 远程执行与画面

[文档导航](../README.md) · [使用指南](../user-guide/RunBridge远程浏览器与持续预览.md) · [历史提案](../design/runbridge-mcp/README.md)

本文描述插件 0.15.0 与配套 Hub 0.9.1／Node 0.8.1 的实现。租约接口自 0.9.0／0.8.0 引入。每次测试冻结连接来源和私有文件，沿用发起命令的当前 DSH Agent，不引入执行子 Agent；旧服务与旧静态许可的记录只保留历史范围。

```mermaid
flowchart LR
    Input[TXT Markdown CSV] --> Test[当前 Agent 测试作用域]
    Test --> Native[DSH 原生工具管线]
    Native --> Bridge[公开 MCP 工具投影与绑定]
    Bridge -->|HTTP tools/call| Hub[Hub 鉴权与指令路由]
    Hub -->|执行协议 2| Node[Node Python worker 与 Chromium]
    Node -->|同一 Page 的 PNG 上传| Stream[Hub 会话画面分发]
    Stream --> Cache[插件服务端最新帧]
    Cache -->|同源图片路由| Preview[现有只读浮窗]
```

`runbridge.ts` 使用官方 MCP Client 2.0.0 和公开 DSH `createMcpToolDefinition`，在 Agent 作用域注册 `mcp__runbridge__*`；沿用原生审批、取消、错误及图片附件投影。私有令牌只用于服务端 HTTP 和 WebSocket 首消息认证，浮窗不直接访问 Hub。运行状态暴露资源身份，省略私有文件路径和令牌。

runbridge-access.ts 分别解析 Hub 认证文件和现成访问文件，JSON／YAML 共用 32 KiB 上限及安全错误处理，默认示例为带注释 YAML。Hub 文件仅有 hub_url、hub_token；节点文件保留 hub_url、node_id、grant_id、access_token、expires_at。原文件缺少新到期字段仍可解析，但执行授权以 Hub 状态为准，两类文件不自动猜测或回退。凭据不进入模型、普通设置或报告。

runbridge-lease.ts 负责整批使用权。自动模式先用 Hub 凭据 GET pool 工具目录并在当前 Agent 投影同源声明；首个可信浏览器初始化时才以唯一 request_id 申请，实际 MCP 定义与目录按内容核对。纯 API 不申请。一次 TXT／Markdown／CSV 运行共享原租约，每条用例仍独立开关浏览器；按需用原节点令牌查询／续租，续租不刷新空闲，不延长原浏览器会话。租期上限及空闲期限由 Hub 配置，客户端不把一天写成硬上限。

领取前将请求身份保存到 run.node_lease.request_id；首次令牌原样保存到 outputRoot/.runbridge-access/ 的本批私有文件，目录 700、文件 600，位于运行报告目录外。响应丢失、重复请求不返回令牌或无法保存凭据时不申请第二份租约继续旧任务；明确的创建前拒绝记录 NOT_ACQUIRED，其余保留 UNKNOWN。自动生成文件仅在确认归还后删除，用户访问文件不改写。

设置读取不联网。Hub 检测只读目录和资源，不建立 MCP 执行连接；现成模式先查询原租约，再做 MCP 握手、tools/list 与只读 node_inspect。仅回传身份、资源及状态摘要，不领取、不刷新空闲、不解除隔离；检测不代表稍后一定可领取或可执行。

浏览器连接与本机画面偏好使用一份页面草稿，通过同一 namespace revision 的两个设置操作原子保存。关闭设置后再次打开保留草稿；整页刷新离开前使用浏览器标准提示，不把凭据或草稿存入浏览器持久存储。模式、访问路径、资源或租期修改会清除旧检测；设置可见时每 15 秒及窗口重新获得焦点时重读文件，文件摘要改变即撤销旧连接结论。保存只重新验证格式，不强制连接；运行中的测试保留原后端，新配置下次运行生效。

插件管理 node_id/resource_id/lease/启动 request_id；启动后管理 session_id/page_id。页面选择只能使用本会话返回的 ID；默认列页保持绑定，关闭当前页后必须明确新建或选择。`tool_request_status` 单独保留原动作 request_id，session_id 继续绑定本轮，不注入或依赖 page_id。所选后端以外的浏览器 MCP 被当前测试守卫拒绝。接口用例不会申请浏览器。MCP Client 标识从包清单读取版本。

生命周期与可信采集只经内部子调用进入原生工具管线；业务操作由 `test_execute_operation` 先保存说明，再转交对应原子工具。对象参数继续支持；`arguments_json` 为完整 JSON 字符串，防止宿主将无类型的嵌套数组转换成对象，仍经 Schema 和工具守卫验证。Hub 提供固定 DOM 采集与 DOM 检视，不开放调用方任意 evaluate/run_code。

DOM 的 text/number/count/visible/url/attribute/value 保持原合同：Node 在同一次读取检查 origin，按冻结输出 Schema 绑定实际值与证据，截断数据不能通过。固定采集仅覆盖主页面；交互的 frame_selector 不代表采集支持 iframe。Node 对 DOM 返回结果执行 256 KiB 检查。截图保存公开投影之外保留的规范 MCP 原始 PNG。上传由插件读取明确的宿主文件路径，单文件或多文件原始字节合计不超过 4 MiB，再编码为 base64；Hub 接纳有界请求，Node 解码并检查总量，服务端不读取调用方指定的本机路径。

启动前持久保存 request_id 和未知资源；Hub 按 grant/node/request 保存无凭据的请求结果及首次分配的会话关联，运行 Task 完成后释放。重复请求不会新开浏览器或复活已结束会话；响应丢失时只核对原请求，不重放启动。

browser_sessions(node_id, request_id) 保留 sessions 数组，新增 request={request_id,node_id,grant_id,state,session_id,error_code,execution_outcome}。插件先核对原请求、节点和 grant，必要字段缺失或关联矛盾时保留隔离：

| 查询结果 | 插件处理 |
| --- | --- |
| FAILED、session_id=null、execution_outcome=NOT_STARTED，且 sessions 为空 | 确认本请求未分配会话，资源标为 absent；直接保留查询结果作收尾证据，不发送无会话身份的关闭请求 |
| PENDING、SUCCEEDED、FAILED 或 UNKNOWN，携带非空 session_id 且与唯一 sessions 项一致 | 验证真实会话归属后找回身份，执行同会话关闭；只有技术终态和 Node cleanup=COMPLETE 一起确认释放 |
| PENDING/UNKNOWN 无已知会话、NOT_FOUND、重复会话或身份不一致 | 保留未知资源和隔离，不将无记录当作未分配，也不自动重放启动 |
| 旧 Hub 未返回 request 对象 | 沿用同 request_id 的唯一 sessions 查询及会话归属校验；空列表不能证明没有分配 |

上述为浏览器会话层证据，不能单独证明 Node 已归还。普通收尾适配器与历史会话恢复复用同一证据判定；设置页审计分别保存实际清理会话或确定未分配请求，旧结果与报告保持原样。REQUEST_RECORD_LIMIT / REQUEST_CONCURRENCY_LIMIT 仅在明确收到分配前 NOT_STARTED 错误时认定未占用；这些响应丢失后仍须按原请求核对，NOT_FOUND 继续隔离。

预览通过已有 MCP 连接的 `browser_status` 读取本会话 visual，不调用已退役的 `GET /v1/sessions/{id}`。新版 HTTP 会话查询为 `/v2`，画面 WebSocket 仍为 `/v1/sessions/{id}/visual/stream`，版本不能一并替换。状态查询支持取消和 5 秒超时；HTTP 认证／许可拒绝或会话失效停止重连，网络中断允许重试，已切换代次的迟到响应不重建旧订阅。

Node Python worker 对执行所用同一 Page 约每 300 毫秒采集 PNG，独立于动作队列；`target_id` 与 page_id 一致。Hub 只鉴权和分发，不安装 Playwright、不创建页面或采集连接。插件继续核对 session/resource/page/connection_generation/stream/frame，Hub 与插件只保留最新帧，五秒无新帧撤图；结束、撤销和隔离停止订阅。画面失败不改写业务结果。

新版动作结果带 request_id。`tool_request_status` 查询原动作，不重放写入，也不把 SUCCEEDED 直接转换成业务 PASS。只有取得动作 ID 时才能查询；整个响应丢失且 ID 未知时继续保留未知状态，通过业务观察或原有恢复路径核实，不能猜测 ID 或重试提交。

受管理浏览器临时目录使用短 `/tmp/rb-*` 私有目录，仅在 Node 按所有权记录确认所属 worker／浏览器退出后删除。插件继续通过 MCP 创建独立受管理浏览器，不增加借用已有 Chrome 的入口。YAML 兼容增强见[0.14.1 验收](../project/0.14.1版本发布验收.md)，配置交互交付见[0.14.0 验收](../project/0.14.0版本发布验收.md)。0.7.0 执行与画面适配及旧版缺陷复现分别见[0.13.2 验收](../project/0.13.2版本发布验收.md)和[升级核查](../design/RunBridge升级对接核查.md)。

## 整批归还与报告

NativeTest 的准备阶段只取只读目录；实际领取在原生工具守卫、计划审核和宣告之后。收尾等待领取与维护请求结算，停止新业务，用原节点令牌 DELETE 原 grant 并轮询。只有 RELEASED／COMPLETE 确认设备归还；RELEASING 继续等待，QUARANTINED、UNKNOWN 或超时保持隔离。原 grant/session/request 和旧业务断言不改写，不领取新令牌恢复旧步骤。

run.node_lease 与每条实例的 browser_context 分开持久化；进度只投影去除 access_file 的白名单状态，报告分别展示断言和设备归还。finish()、dispose()、卸载与恢复等待收尾 Promise，旧作用域关闭但仍在 dispose 时继续阻止新批次。报告封存前等待 Node 归还结果，不依赖 MCP 断开。

RecoveryManager 使用原访问文件匹配 Hub、Node、grant，查询／重复释放原租约，确认实际终态后另存处置证明；旧结果与 UNKNOWN 原样保留。原令牌缺失时只能由维护者核查后提交实际证据，共享 Hub 凭据没有强制接管旁路。[本轮验收](../project/0.15.0版本发布验收.md)与[适配方案](../design/RunBridge节点租约适配方案.md)分别记录实现范围和交付结果。
