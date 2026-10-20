# RunBridge 升级对接核查

核查日期：2026-10-20（Asia/Shanghai）。状态：完成现状核查，适配建议尚未实施。

[文档导航](../README.md) · [插件当前远程架构](../architecture/RunBridge远程执行与画面.md) · [远程浏览器指南](../user-guide/RunBridge远程浏览器与持续预览.md)

## 结论与范围

插件 0.13.1 对 RunBridge Hub/Node 0.7.0 的基础 MCP 执行仍可用，持续预览和新增的动作结果查询需要适配。目前不能宣称完整兼容新版。

本轮核对三个工作副本的源码，并使用插件已提交的 `dist`、真实 MCP HTTP、隔离 Hub/Node 和独立受管理 Chromium 验证。测试完成后确认后端仅产生一条保存记录，会话为 CLOSED/COMPLETE，资源回到 FREE，隔离进程全部停止。未修改插件运行代码或 RunBridge 两仓，未启动日常部署。

| 项目 | 核查基线 |
| --- | --- |
| 测试插件 | 0.13.1，`22caa24c7d95ca2a21f45546e5ae62851ce467ee` |
| RunBridge Hub | 0.7.0，`50242ca845ca4326e384a8dfc344c74b05a72d92` |
| RunBridge Node | 0.7.0，`ed8e85813c68ab37ff843dd9fda1c5fe18bd5c98` |
| 运行环境 | macOS ARM64；Node.js 22.22.3；两端 Python 3.14.7；Hub MCP 2.3.0；Node Playwright 1.63.0 |

新版执行链为：插件 → Hub MCP 参数适配和指令路由 → Node Python worker → Chromium。Hub 不再持有 Playwright Page；受管理画面由 Node 对执行所用的同一 Page 采集、上传，再由 Hub 分发。原有 26 项 MCP 工具保留，新增 `tool_request_status`，共 27 项。

## 必须调整

### 1. 持续预览仍调用已退役的会话查询入口

位置：[runbridge-preview.ts](../../src/runbridge-preview.ts) 的 `RunBridgePreview.bind()`，查询行 74、错误处理行 84–86。

插件读取 `GET /v1/sessions/{session_id}`，新版该接口稳定返回 HTTP 410、`NATIVE_API_RETIRED`，会话查询已迁至 `GET /v2/sessions/{session_id}`。插件把所有非成功响应解释为“远程画面许可或会话已失效”，并停止重连。因此有效的许可和活动会话也无法显示预览，还会给出错误原因。

真实复现结果：

- 通过插件正常启动会话并完成表单操作。
- 旧查询返回 410；同一许可、同一会话的新查询返回 200，`visual.supported=true`。
- 未修改插件的预览状态为 `ready=false, failed=true`，原因显示“远程画面许可或会话已失效”。
- 使用新查询返回的订阅地址，能收到同一页面的 24570 字节 PNG；现有 `decodeRemoteFrame()` 能直接解码，画面显示已保存结果。

修正查询入口即可保留现有浮窗、首消息认证、帧校验及撤图机制。**画面 WebSocket 仍为 `/v1/sessions/{session_id}/visual/stream`，不能把全部 `/v1` 批量替换成 `/v2`。**

建议通过当前 RunBridge MCP 连接的 `browser_status` 获取 `visual`，由服务端继续绑定本次 session；旧版和新版均有此工具，可避免预览直接依赖已变更的 HTTP 会话版本。若后续明确只支持新版，直接使用 `/v2` 会话查询是更小的改法，但旧 Hub 的兼容边界需随之更新。两种路线均尚未实施。

服务端依据：Hub `src/runbridge_hub/native.py` 的退役路由、`browser.py` 的 `status()`、`visual_api.py` 的订阅路由，以及 `doc/reference/浏览器画面流接口.md`。另核对旧提交 `56e4d2f` 的 `BrowserService.status()`，同样返回 `visual`；这只是兼容路线的源码依据，未在旧服务上重跑实测。

### 2. 新增动作结果查询工具被注册，但无法提供必填参数

位置：[runbridge.ts](../../src/runbridge.ts) 的 `managed`（行 61–68）、Schema 投影（行 216–223）、参数守卫（行 243–248、276–278）和会话／页面注入（行 336–353）。

新版 `tool_request_status(session_id, request_id)` 用于查询已经提交的动作，不会重放操作。插件动态注册了该工具，却把它的 `request_id` 当作启动时受管的身份参数：

| 调用方式 | 实际结果 |
| --- | --- |
| 带原动作 `request_id` | 本地拒绝：“远程身份参数由插件绑定，不能覆盖：request_id” |
| 不带 `request_id` | 插件允许发送，Hub 拒绝：必填 request_id 缺失 |
| 使用同一 MCP Client，直接向 Hub 提交原 session_id/request_id | 成功返回 `status=SUCCEEDED`，证明服务端查询正常 |

这不阻断普通填表和断言，但在新版返回 REQUEST_IN_PROGRESS、超时或其他带 request_id 的不确定结果时，插件无法使用新增查询能力核实原动作。

应区分“插件生成的启动请求身份”和“已有动作的查询标识”：仅对 `tool_request_status` 保留所需 request_id，session_id 仍绑定当前运行，并将其作为会话级只读工具处理，不依赖当前 page_id。不能全局放开受管身份，也不能查询成功后直接把业务断言改成通过。

适配范围也需明确：当前 MCP 动作 ID 由 Hub 生成；如果整个动作响应丢失，插件可能没有收到该 ID。接通查询工具能处理**已取得动作 ID**的状态核查，不能据此宣称解决所有网络断线后的动作找回。本轮未注入该故障，现有“不盲目重放”的原则仍适用。

服务端依据：Hub `src/runbridge_hub/mcp_server.py` 的 `tool_request_status()`、`browser.py` 的动作返回 request_id，以及当前 MCP 使用指南。

### 3. 适配交付时同步更新当前文档

[当前架构](../architecture/RunBridge远程执行与画面.md)和[使用指南](../user-guide/RunBridge远程浏览器与持续预览.md)仍以 Hub 0.5.1 / Node 0.5.0 为基线，描述 Hub 持有 Page、Hub 执行采集、Hub 安装且匹配 Playwright 等旧实现。新版已由 Node 承担这些职责，节点画面就绪也应按实际 `visual` 与执行能力检查，不能继续要求旧 `host.managed_visual=cdp-png` 字段。

本轮保留旧文档描述其已实现的基线；完成适配后再同步更新中英文当前说明、连接前提、架构图、查询入口、错误恢复和验收边界。历史 0.12.x 接入记录继续保留日期与原基线。

## 已通过的实际对接

| 检查 | 结果及证据层次 |
| --- | --- |
| MCP 握手、tools/list、真实 Schema 投影 | 插件 Client 连接新版 MCP 服务，27 项工具全部注册成功 |
| 会话申请及身份绑定 | 返回 ACTIVE，插件保存本次 session/page/grant/connection_generation |
| 导航、语义快照 | 真实 Chromium 读取隔离表单 |
| 填写、点击、等待、固定 DOM 采集 | 页面显示保存结果；captures.values、url、truncated 字段继续满足插件合同 |
| 最终业务记录 | 隔离网站后端 records 数组恰为一条，与本次输入一致 |
| MCP 截图 | 返回规范 image/png，24570 字节，保存后可视检查正常 |
| 标签页目录 | 当前 page_id 与本会话目录匹配 |
| 新版画面流与旧解码器 | 真实同页 PNG 解码成功；本次静态页面的流帧与 MCP 截图 SHA-256 一致 |
| 动作结果查询的 Hub 能力 | 原始 MCP 调用返回原动作 SUCCEEDED；经插件投影调用的失败另列上文 |
| 按原启动请求找回并释放 | 保留原 request_id/grant/node，移除本地已知 session/page 模拟身份待找回；插件查询原请求后完成同会话 CLOSED/COMPLETE，状态为 absent |
| 资源及进程收尾 | Node 资源 FREE；本次隔离 Hub、Node 和专用 worker 退出，专用所有权记录清理完成 |

“按原请求找回”验证的是恢复分支与服务端真实查询，未模拟网络实际丢包。没有将它等同于全故障矩阵。

## 回归与证据

插件相关确定性回归命令如下，排除忽略目录中的历史 CI 工作副本，确保测试来自当前根目录：

```bash
node node_modules/vitest/vitest.mjs run \
  tests/unit/runbridge.test.ts \
  tests/unit/runbridge-preview.test.ts \
  tests/unit/adapters.test.ts \
  tests/unit/recovery.test.ts \
  tests/integration/native.test.ts \
  --exclude '**/.local/**' \
  --pool=forks --maxWorkers=1 --no-file-parallelism \
  --reporter=default --reporter=json \
  --outputFile=.local/runbridge-audit-20261020/regression.json
```

当前根目录的 5 个测试文件、123 项回归全部通过：RunBridge 30 项、预览 4 项、适配器 5 项、恢复 21 项、原生生命周期集成 63 项。既有 mock 测试不会检测 Hub 路由退役及新增工具参数，所以确定性回归通过也不能覆盖上述真实兼容缺陷。

本轮三个文档文件的 101 个本地引用检查通过，`git diff --check` 通过。

隔离脚本和原始证据保存在 Git 忽略目录 `.local/runbridge-audit-20261020/`：

- `live.py`、`probe.mjs`：复用 Hub 自带的隔离 Runtime 启动临时服务，直接加载插件 `dist` 核查；账号和访问许可由本次测试新建。
- `probe-facts.json`：12 组事实，包含两项成功复现的兼容缺陷；脚本退出码 0 表示核查断言符合预期，**不表示所有功能通过**。
- `runtime-facts.json`：后端保存条数、资源 FREE 与隔离服务退出事实。
- `screenshot.png`、`visual-frame.png`：同一页面的 MCP 截图与真实画面帧，SHA-256 均为 `1eb2477d3a266a9b13d77ca64787e383f8df44beb0b6ec57972b2476f0893478`。
- `regression.json`：当前根目录相关回归结果。

首轮在沙箱内启动 Chromium 失败，没有计为通过；后续在允许浏览器启动的环境完成隔离实测，并按本次所有权记录回收首轮残留。实际日常部署在核查时未监听，未重启它们；没有连接虚拟机验证安装版本或重新执行 DSH 真实模型、GitLab Markdown 用户入口及三个宿主正式交付矩阵。

## 建议实施顺序与完成标准

1. 修正预览状态查询，增加旧入口返回 410、新查询／MCP status 提供 visual、同页首帧可显示的回归；保持首消息认证、身份校验及过期撤图。
2. 为动作查询按工具区分 request_id 语义及会话绑定，覆盖合法查询、身份覆盖拒绝、当前页不存在时仍可查询，以及带动作 ID 的不确定结果核查。
3. 更新受影响的当前文档与 MCP Client 版本标识；后者当前在 `runbridge.ts` 中仍硬编码 0.12.1，是已有元数据漂移，不是本次基础执行故障的原因。
4. 用修复后的同一候选发行包重跑真实 0.7.0 链路，证明预览已 ready、查询可经插件调用、业务保存无重复且 CLOSED/COMPLETE/FREE；按最终宣称的范围补齐旧 Hub 验证及项目要求的 DSH 宿主、真实模型与 GitLab 用户入口验收。

本轮仅交付核查与适配建议，包版本仍为 0.13.1，不创建新发行标签。
