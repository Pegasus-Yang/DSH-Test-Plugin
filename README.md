# DeepSeek Harness 测试插件

简体中文 | [English](README.en.md)

在 **DeepSeek Harness（DSH）的当前对话** 中完成测试规划、UI/API 操作、证据采集、确定性断言和报告生成的 TypeScript 插件。用自然语言描述任务即可开始，也可以执行预先编写的 JSON 测试集合。插件复用 DSH 的模型循环、工具、审批和会话保存机制，不创建独立执行 Agent，也不修改宿主核心。

当前版本：**0.5.0（开发版本）**。已在本地 DSH 验证浏览器测试、纯接口测试、计划审核和报告链路；完整验证范围及历史问题见 [开发与验收记录](doc/project/开发进度.md)。

## 能做什么

| 功能 | 使用方式与行为 |
| --- | --- |
| 自然语言测试 | `/test` 将任务拆成业务短句和文字检查点，通报后直接执行 |
| 先审核再执行 | `/test-plan` 使用原生 plan 模式，可要求修改，批准当前草案后才执行 |
| 执行时调整操作 | 规划不访问目标；选择器、工具参数和采集方式在执行当前步骤时确定 |
| UI 自动化 | 通过专用 Playwright MCP 浏览网页、搜索、点击并采集 DOM 数据和截图 |
| 接口测试 | HTTP GET JSON 采集，验证状态码及响应字段；纯接口用例无需浏览器 |
| 程序断言 | 从可信观察计算实际值，与有来源的预期比较；不能仅凭模型声称 PASS |
| 对话内进度 | 原始任务、拆分思路、步骤、工具结果、审批及最终总结保留在同一会话 |
| 静态报告 | 步骤、断言、实际/预期、工具调用、附件和筛选；最终回复提供查看链接和保存位置 |
| 停止与清理 | 停止业务后等待在途结算，再在同一会话执行预授权清理；无法确认释放时隔离环境 |
| JSON 集合 | 多用例、多数据行、依赖、准备及清理步骤；保留原始计划和运行账本 |

## 安装到本地 DSH

### 1. 准备环境并构建插件

需要 Node.js **22.19+**、pnpm **11.7.0**，以及已构建、已配置可用模型的本地 DSH **0.2.1-alpha.1**。本机验收使用 Node.js 22.22.3；其他 DSH 版本需要重新验证兼容性。宿主的依赖安装和构建请先按其自身文档完成。

在插件项目目录执行，替换示例中的绝对路径：

```sh
cd /绝对路径/DeepseekHarnessTestPlugin
pnpm install
node scripts/link-host.mjs /绝对路径/deepseek-harness
pnpm typecheck
pnpm build
pnpm pack --out artifacts/package/dsh-test-plugin.tgz
```

`link-host` 将开发依赖链接到本地已构建的宿主包，并在 `.local/host.json` 保存宿主路径；不修改宿主源码。仅执行 API 测试时无需安装浏览器；执行 UI 测试时继续运行：

```sh
node scripts/install-browser.mjs
```

### 2. 安装到 web profile

在 **DSH 源码目录** 执行：

```sh
cd /绝对路径/deepseek-harness
pnpm dsh plugin --profile web add /绝对路径/DeepseekHarnessTestPlugin/artifacts/package/dsh-test-plugin.tgz
```

已有独立 `dsh` CLI 时，可用 `dsh` 替代 `pnpm dsh`。默认安装到用户 DSH home；使用自定义 `DSH_HOME` 时，安装与启动必须指定同一个目录。

**保留当前安装的 tgz 文件。** profile 将其记录为本地 `file:` 依赖。后续统一使用 `dsh-test-plugin.tgz`；若删除旧包后安装报 ENOENT，请按 [旧包路径恢复流程](doc/deployment/安装与运维.md#安装报-enoent指向已删除的旧安装包) 先按包名 remove，再 add 新包，不要删除整个 profile。

### 3. 配置工作区与 Playwright MCP，启动 DSH

安装包会自动登记插件，但不替你配置模型或浏览器。按 [安装与运维中的配置示例](doc/deployment/安装与运维.md#配置) 创建 `/绝对路径/DeepseekHarnessTestPlugin/.local/dsh-test.patch.yml`：指定插件 `workspace`、`outputRoot`，启用 native 工具模式，并为 UI 测试配置专用 Playwright MCP。纯 API 测试可省略 MCP 项。

在 DSH 源码目录启动；已有服务请先正常停止，再使用原有启动参数加上此 patch，选择空闲端口：

```sh
pnpm dsh web --patch /绝对路径/DeepseekHarnessTestPlugin/.local/dsh-test.patch.yml --port 3080
```

打开 DSH 输出的访问地址，进入测试工作区，使用标准模式创建会话。升级插件后须重启同一 profile 的宿主并刷新网页。插件已由 bundle 注册，配置 patch 只更新 `harness-test`，不要再插入一个同名实例。

## 开始使用

以下是 **DSH 对话输入框中的命令**，不是终端命令。

直接规划并执行浏览器测试：

```text
/test 访问ceshiren.com，搜索 agent 关键字，并打开第一条搜索结果帖子，断言帖子的点赞数不为0
```

先审核接口测试计划：

```text
/test-plan 发送GET请求到 https://httpbin.org/get?keyword=agent&client=dsh，验证HTTP状态码为200、返回的keyword为agent、client为dsh
```

审核卡片展示 **原始任务、拆分思路、步骤清单**。可以要求修改并补充意见；同意后才执行。`/test` 展示相同内容后直接执行，无需确认。缺少明确预期时，模型会在当前对话追问；无需提前提供未知页面的选择器或响应字段结构。

执行工作区内的 JSON 示例：

```text
/test-run examples/ceshiren-agent.json
/test-run examples/httpbin-get.json
```

逐条执行示例，不要同时共享同一浏览器环境。路径相对于插件配置的 `workspace`；使用其他工作区时，先将示例复制到该工作区。`/test-run` 只接受 JSON 路径，自然语言任务使用 `/test` 或 `/test-plan`。

| 命令 | 用途 |
| --- | --- |
| `/test-status` | 查看当前会话测试状态 |
| `/test-stop` | 请求停止业务并完成允许的收尾；也可用原生“停止生成” |
| `/test-report [运行ID]` | 重新生成报告；省略 ID 时只查当前会话 |
| `/test-release <处置JSON路径>` | 核实停止和环境重置后，登记证据解除隔离 |

过程说明优先使用 DSH 显式语言偏好；未设置时，中文任务使用中文，否则回退到英文。工具记录可能被 DSH 默认折叠，可以展开或查看“轨迹”。详细行为见 [使用说明](doc/user-guide/使用说明.md)。

## 报告与运行数据

最终回复给出 **查看测试报告** 链接及完整保存位置，无需手动查找运行 ID。HTTP 链接复用 DSH 服务和登录态；报告本身是静态 HTML，也可直接离线打开，无需额外报告服务。

默认产物位置为插件 `outputRoot` 下的独立运行目录：

```text
artifacts/runs/<运行ID>/
├── plan.json       # 原始计划
├── events.jsonl    # 事件账本
├── results.json    # 运行结果、观察与断言
├── evidence/       # 截图和响应等证据
└── report.html     # 静态报告
```

报告提供概览、用例筛选、步骤、断言、附件和运行信息，可对照实际值、预期及来源。复制整个目录可保留完整证据。`/test-report` 从账本重建为 `report-rebuilt.html` 和 `results-rebuilt.json`，不覆盖原始结果，也不重新调用模型或业务工具。

## 当前边界

- 仅支持 DSH native 工具模式，同一共享环境串行运行；浏览器工具名使用 `mcp__playwright__` 前缀。
- 接口可信采集目前支持 **GET JSON**，不支持 POST 或自定义请求体。
- JSON 执行仍使用 DSH 模型循环；只有报告重建不需要模型，不等同于无模型回放。
- 自然语言规划和定位可能重试；简单数字条件有语义校验，但不保证任意自然语言的完整语义证明。
- 对话可使用英文；报告界面和部分命令提示目前仍以中文为主。
- 取消、证据缺失、工具错误和清理失败不会算作通过。历史设计清单中未执行的检查仍保留未验收状态。

## 开发与文档

如需独立开发环境，在完成前面的依赖安装、link-host、build 和浏览器安装后，从插件根目录运行：

```sh
node scripts/start-host.mjs
```

该辅助脚本默认在端口 13379 启动隔离 DSH home，加载本地 `dist`，从现有 `~/.dsh` 读取特定模型配置及凭据引用。它不是部署到现有 profile 的替代安装步骤；适用条件及变量见 [安装与运维](doc/deployment/安装与运维.md#隔离开发环境)。认证地址保存在 `.local/host-state.json`，不要公开该文件。

```sh
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:integration
```

真实网页验收需要已运行的 DSH、模型和相应工具，不能由构建成功替代。构建产物、运行记录、日志和本地配置均由 `.gitignore` 排除。

- [使用说明](doc/user-guide/使用说明.md) / [User guide](doc/user-guide/使用说明.en.md)
- [安装与运维](doc/deployment/安装与运维.md) / [Installation and deployment](doc/deployment/安装与运维.en.md)
- [当前实现](doc/architecture/当前实现.md)与[完整文档导航](doc/README.md)
- [开发与验收记录](doc/project/开发进度.md)

许可证：[MIT](LICENSE)。第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
