# DeepSeek Harness 测试插件

原生 TypeScript 插件，为 DeepSeek Harness 增加测试计划、串行执行、确定性断言、运行记录与离线 HTML 报告。支持自然语言入口和 JSON 测试集合；复用 Harness 的模型、原生工具审批及 Playwright MCP，不修改宿主核心。

当前为 `0.1.0` 开发版本。已实现主要执行链路，验收证据及尚未覆盖的设计检查见 [开发与验收记录](doc/project/开发进度.md)；设计清单不会因代码存在而自动标为通过。

## 本地开始

要求 Node.js 22.19+、pnpm 11 和已配置可用模型的本地 DeepSeek Harness `0.2.1-alpha.1`。

```sh
pnpm install
node scripts/link-host.mjs /你的/deepseek-harness
pnpm build
node scripts/install-browser.mjs
node scripts/start-host.mjs
```

开发启动脚本在本项目 `.local/` 创建隔离配置，复用本机 `~/.dsh` 中现有模型路由和凭据引用，并配置固定版本的 Playwright MCP；不会改动宿主源码或原来的 profile。带认证的本机访问地址保存在 `.local/host-state.json`，不要公开该文件。

在启动的 Harness Web 新会话中执行：

```text
/test-run examples/ceshiren-agent.json
/test-status
/test-stop
/test-report
```

自然语言入口为 `/test <任务及明确预期>`；规划器缺少预期时会提出问题。可从 [完整示例](examples/ceshiren-agent.json) 开始，逐项检查生成计划中的选择器和预期来源。

测试结束后，DSH网页会主动提示保存位置，并提供“查看测试报告”链接。报告是静态HTML；网页链接复用DSH现有服务及登录态，也可直接打开本地文件离线查看。升级后重启DSH并刷新网页。

运行产物位于 `artifacts/runs/<运行ID>/`：`plan.json`、`events.jsonl`、`results.json`、`evidence/`、`report.html`。每次重跑生成新目录；整个目录复制后仍可离线查看报告。运行结果、调试日志、凭据、构建产物均由 `.gitignore` 排除。

## 文档与验证

- [使用说明](doc/user-guide/使用说明.md)：命令、计划、断言、停止与报告。
- [安装与运维](doc/deployment/安装与运维.md)：宿主配置、预算、隔离处置和发行包。
- [当前实现](doc/architecture/当前实现.md)：模块、身份与数据流、支持边界。
- [完整文档导航](doc/README.md)：设计方案、历史审核和当前证据。

```sh
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:integration
pnpm test:e2e  # 需要先启动隔离宿主，会访问真实网站
```

报告中的 PASS 由绑定的真实观察和固定比较器计算，模型不能提交实际值或直接宣称测试通过。工具异常、必要证据缺失、清理失败和取消分别记录；结果结算不等同于外部执行已停止。
