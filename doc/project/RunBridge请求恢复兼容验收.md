# RunBridge 请求恢复兼容验收

[文档导航](../README.md) · [使用指南](../user-guide/RunBridge远程浏览器与持续预览.md) · [架构](../architecture/RunBridge远程执行与画面.md) · [首次接入验收](RunBridge远程浏览器接入验收.md)

日期：2026-10-14（Asia/Shanghai）。本次插件版本 0.12.1，服务兼容基线为 RunBridge Hub 0.5.1 / Node 0.5.0。Hub/Node 的运行代码、持久请求记录、HTTP 上传限额和对应服务测试由服务任务维护；本轮只修改插件仓。

## 修复目标

原插件只能从 browser_sessions 的唯一会话项恢复身份。新 Hub 提供持久请求状态，插件需要接纳已分配后失败的真实会话，以及确定未分配的终态证据，同时避免将无记录或矛盾响应解释为资源不存在。

普通收尾和设置页恢复复用同一判定；释放成功只确认环境可以再次使用，不改变初始化错误、业务失败、未知操作或旧报告。

## 查询合同与处理

browser_sessions(node_id, request_id) 保留 sessions 数组，并新增 request 对象：request_id、node_id、grant_id、state、session_id、error_code、execution_outcome。

| 输入证据 | 预期与已验证行为 |
| --- | --- |
| 同请求、节点、grant 的 FAILED + session_id=null + NOT_STARTED，sessions 为空 | 确认未分配；原生收尾完成并保留初始化 ERROR，设置页保存 remote_request 处置证据，只有查询请求，不发送 browser_stop 或重放 browser_start |
| 已分配后 FAILED，实际会话 cleanup=UNKNOWN | 恢复原 session_id 并关闭同会话；UNKNOWN 保留未知资源，后续真实 COMPLETE 才确认释放 |
| PENDING / UNKNOWN / SUCCEEDED 携带有效会话关联 | 与唯一 sessions 项及原归属校验一致后恢复身份；请求状态本身不能确认清理 |
| PENDING / UNKNOWN 无会话、NOT_FOUND、不完整或矛盾数据 | 保留未知资源和隔离；没有记录不证明未分配 |
| request、node、grant、session 不一致，或重复会话 | 拒绝核对，不发送关闭，也不再次启动 |
| 旧响应仅有 sessions | 保持唯一原请求匹配和会话归属校验；空列表和重复结果继续隔离 |
| 明确收到 REQUEST_RECORD_LIMIT / REQUEST_CONCURRENCY_LIMIT + NOT_STARTED | 确认分配前拒绝；若响应丢失，仍按原请求核对，不以 NOT_FOUND 释放 |

已分配会话只接受 CLOSED、FAILED 或 INTERRUPTED 与 cleanup=COMPLETE 的组合。设置页恢复验证原访问文件，不能换 grant 接管旧会话；旧 results.json 保持逐字节不变。

## 验证结果

- 全量回归：29 个文件、362 项通过；相较 0.12.0 增加 32 项，覆盖请求恢复、原生流程、处置审计及上传边界。
- 针对性回归：RunBridge 30 项、恢复 21 项、适配器 5 项，共 56 项通过。
- 原生流程确认：确定未分配的启动失败完成收尾但保留 ERROR；NOT_FOUND 拒绝确认释放并保留隔离。
- 上传验证：中文文件名，单文件或两个文件总量恰好 4 MiB 时编码后的字节一致；超过总量一字节在宿主拒绝，未请求远程工具。
- TypeScript 类型检查、源码构建、发行入口检查通过；0.12.1 的包版本、运行 manifest 与 MCP 客户端版本同步。
- 全量通过后更新版本元数据，再复核 4 项远程原生流程通过；其余 58 项在该次针对性运行中由名称筛选排除，已在前面的全量回归覆盖。
- `dsh-test-plugin-0.12.1.tgz` 解包后的 158 个文件与当前工作区逐字节一致，其中 dist 为 95 个文件；解包后的公开入口及确定未分配 / NOT_FOUND 恢复判定通过。安装包 SHA-256 为 `719029b049f1003663900b2e672737c403898f30be9d73fff4bfe12fc547873d`。

实际执行使用项目已安装依赖及 package.json 中脚本的 Node 入口：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run tests/unit tests/integration
node scripts/build.mjs
node scripts/check-package.mjs
```

本机 pnpm 启动器无法在其私有包管理器目录创建锁定版本，本轮直接运行上述已有项目入口，未安装或替换依赖。

## 交付与证据范围

首批本地提交 `399f06b` 为兼容实现、回归与 dist；版本、当前文档及最终产物在后续完成提交中收口。附注标签 `v0.12.1` 指向完成提交，保留 `v0.12.0`；准确提交使用 `git rev-list -n 1 v0.12.1` 查询。本轮不推送。

本轮插件回归使用官方公开工具投影和生命周期替身，没有再次运行真实模型或启动远程浏览器。实际 /mcp HTTP 上传限额、服务准备失败、取消及 Hub 重启恢复由 Hub 任务验证；本页的宿主编码回归不能代替 HTTP 验证。0.12.0 的真实 Ubuntu 浏览器、画面与 GitLab 结果继续保存在首次接入验收中，历史失败不改写。

可选边界继续保留：固定 DOM 采集仅覆盖主页面，256 KiB 限制发生在传回 Hub 后，CDPSession 初始化失败需重新选页；本轮不扩展 iframe 固定采集、浏览器侧采集限额或自动重建 CDP 连接。
