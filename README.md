# DeepSeek Harness 测试插件

原生 TypeScript 插件，在 DeepSeek Harness 的当前对话中增加测试规划、可信采集、确定性断言、运行记录与离线 HTML 报告。支持自然语言入口和 JSON 测试集合；规划阶段只拆解业务短句和文字检查点，每一步执行时再确定具体操作、参数和数据采集方式；复用 Harness 的模型、原生工具审批及 Playwright MCP，不修改宿主核心。

当前为 `0.5.0` 开发版本。已实现主要执行链路，验收证据及尚未覆盖的设计检查见 [开发与验收记录](doc/project/开发进度.md)；设计清单不会因代码存在而自动标为通过。

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
/test-run examples/httpbin-get.json
/test-status
/test-stop
/test-report
```

自然语言入口为 `/test <任务及明确预期>`，规划后直接执行；需要先审核时使用 `/test-plan <任务及明确预期>`，通过宿主原生 plan 审核卡片修改或批准后执行。规划会展示原始任务、简短拆分思路和步骤清单，过程说明跟随 DSH 显式语言偏好；无偏好时沿用用户输入语言。当前 Agent 缺少预期时在同一对话提出问题。文字规划不需要用户提供选择器或响应字段结构；已知完整执行定义时可使用 [JSON示例](examples/ceshiren-agent.json)。

测试在发起命令的同一原生对话中完成：模型正常规划、调用工具、请求审批、追问并给出最终回复。命令提交后输入框恢复为原生运行状态，可使用“停止生成”；停止后等待在途结算，再在同一会话执行预授权清理。插件不创建额外 Agent、不插入自制进度卡片、不显示其他会话的旧报告。结束时原生工具结果和最终回复提供“查看测试报告”链接及保存位置。报告是静态 HTML，网页链接复用本机 DSH 服务及登录态，也可离线查看。升级后重启 DSH 并刷新网页。

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
