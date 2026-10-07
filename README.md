# DSH Test Plugin

**在 DeepSeek Harness 对话中，用自然语言完成测试规划、执行和结果交付。**

简体中文 · [English](README.en.md) · [快速开始](#快速开始) · [完整文档](doc/README.md) · [更新日志](changelog.md) · [问题反馈](https://github.com/Pegasus-Yang/DSH-Test-Plugin/issues)

DSH Test Plugin 是 DeepSeek Harness（DSH）的原生测试插件。描述想验证的业务流程，插件会拆解计划，结合真实页面或接口响应执行检查，并在同一对话中展示进度、证据和结果。它复用当前对话的模型、工具、审批和会话记录，支持网页 UI 测试与 GET JSON 接口测试。

从一次探索到重复执行：可以直接输入测试任务，也可以维护 TXT、Markdown 用例和 CSV 参数数据；执行后获得可复查的 HTML 报告，以及供其他执行人复用的 Markdown 手工用例。

## 功能亮点

| 能力 | 可以做什么 |
| --- | --- |
| 自然语言规划与审核 | 将任务拆成业务步骤和检查点；直接执行，或先审核、修改计划再运行 |
| 网页与接口测试 | 通过 Playwright MCP 操作网页，执行时结合页面情况确定具体操作；采集 GET JSON 响应，检查状态码与响应字段 |
| 文件用例与参数化 | 使用 TXT、Markdown 保存用例，用 CSV 展开多组数据，逐项审核后串行执行 |
| 执行进度与耗时 | 在输入框上方查看当前步骤、已结算数量和耗时；按需展开完整步骤，适应长文字与多实例 |
| 实时画面与录像 | 在同一页面观看无头浏览器画面；可独立开启录像，在报告中回看、拖动和下载 MP4 |
| 证据与测试报告 | 保存实际观察、预期及来源，通过程序比较给出断言结果；生成含步骤、断言和附件的静态 HTML 报告，支持离线保存与重建 |
| 实际步骤与手工用例 | 逐条记录真实操作，按序号整理操作和预期结果，导出包含前置、实际步骤及收尾的 Markdown 手工用例 |

## 实际效果

以下截图展示使用 GitLab 作为被测系统时的实际运行效果。

**随时知道正在做什么。** 进度区显示当前操作、已结算数量、总耗时和本步用时；展开后可以查看完整步骤。

![GitLab 登录页检查的当前步骤、结算进度和耗时](doc/user-guide/images/GitLab当前步骤.png)

**在对话中观看浏览器执行。** 实时画面浮窗与对话记录、步骤进度一起展示，可以移动、缩放，也可以显示或隐藏。

![完整 DSH 页面：实时浮窗展示 GitLab 登录页，同时可见对话执行记录与步骤进度](doc/user-guide/images/GitLab浏览器实时画面.png)

**用证据核对测试结果。** 报告按用例组织实际步骤、断言和附件，展示实际值与预期；浏览器用例可附带录像，接口用例只展示相应的请求与检查。

![GitLab Markdown 接口报告：实际步骤、状态码检查和证据入口](doc/user-guide/images/GitLab接口测试报告.png)

更多计划审核、步骤展开和报告截图见[使用说明](doc/user-guide/使用说明.md#用截图认识功能)。

## 快速开始

### 1. 准备 DSH 与测试工具

- Node.js **22.19+**，已安装并配置可用模型的 DeepSeek Harness **0.2.1-alpha.1**。
- 在 DSH 中使用 **native 工具模式**；网页测试还需要专用 Playwright MCP 和匹配的 Chromium。
- 仅做接口测试时无需安装浏览器；源码开发需要 pnpm **11.7.0**。

宿主安装按 DSH 自身文档完成，插件和浏览器工具的具体配置见[安装与运维](doc/deployment/安装与运维.md#配置)。

### 2. 安装并启用插件

在 DSH 插件管理页填写下面的仓库地址，安装后启用：

```text
https://github.com/Pegasus-Yang/DSH-Test-Plugin.git#v0.11.2
```

也可以使用独立 DSH CLI 安装：

```sh
dsh plugin --profile web add github:Pegasus-Yang/DSH-Test-Plugin#v0.11.2
dsh web
```

命令行安装前先正常停止正在运行的 DSH，安装与后续启动使用同一 profile 和 `DSH_HOME`，启动后刷新页面。从 DSH 源码目录运行时，将 `dsh` 替换为 `pnpm dsh`。仓库发行版本包含构建产物，可以直接安装。

升级、卸载和本地安装包的操作见[安装与运维](doc/deployment/安装与运维.md)。

### 3. 在对话中运行第一条测试

准备一个可访问的 GitLab 登录页，在 **DSH 对话框**中输入：

```text
/test 访问 http://127.0.0.1:8929/users/sign_in，断言页面存在用户名输入框、密码输入框和 Sign in 登录按钮
```

将地址替换成自己的 GitLab 地址。这条用例不需要账号；GitLab 部署请查阅[官方 Docker 文档](https://docs.gitlab.com/install/docker/)，系统条件与测试账号要求见[GitLab 测试指南](doc/user-guide/GitLab测试要求与本地调试.md)。

插件会展示计划、逐步执行并更新进度，结束后提供结果和报告链接。希望先确认计划时，使用 `/test-plan`。执行文件用例前，将文件所在目录设为当前对话工作区，路径按该工作区读取。

### 4. 按需开启画面与录像

安装本机 Browscreen 命令，在 **设置 → 测试插件 → 浏览器预览与录像** 中开启所需的预览或录像、检测安装、选择专用 Playwright MCP，并保存设置。之后使用正常测试命令即可，采集服务由插件按需启动。

实时画面只在当前浏览器的 CDP 连接和有效首帧就绪后显示。录像有独立开关，默认关闭；隐藏浮窗不会停止已启用的录像。接口实例不显示浏览器画面或视频区域。

安装要求和操作步骤见[实时预览配置](doc/user-guide/浏览器实时预览一步一步配置.md)与[浏览器录像与报告](doc/user-guide/浏览器录像与报告.md)。

## 命令与用例

以下命令都在 DSH 对话框中使用：

| 命令 | 用途 |
| --- | --- |
| `/test <任务>` | 展示计划后直接执行 |
| `/test-plan <任务>` | 先审核、修改计划，再执行 |
| `/test-run <文件>` | 从当前工作区读取 TXT 或 Markdown 用例并执行 |
| `/test-data <CSV> --file <用例文件>` | 按 CSV 展开参数，审核后执行 |

需要中途停止时，使用 DSH 原生停止按钮；运行完成后可从进度区或设置页重建报告。完整输入规则和界面操作见[使用说明](doc/user-guide/使用说明.md)。

想体验更完整的流程，可以使用[GitLab 样例](examples/gitlab/README.md)：两条 UI 用例覆盖组合筛选和草稿预览取消，三条接口用例覆盖搜索、分页和错误响应，另有 CSV 参数化模板。按[测试指南](doc/user-guide/GitLab测试要求与本地调试.md)准备专用账号和本轮数据，账号保存在不提交的本机配置中。

## 支持范围

- 运行于 DSH native 工具模式，共享测试环境按串行方式执行；多对话独立浏览器并行运行属于[后续优化](doc/design/多对话并行测试优化方案.md)。
- 接口测试支持 **GET JSON** 采集；自动预览使用本机 Chromium Playwright MCP，当前支持单活动页面。
- 自然语言和文件用例执行都使用当前对话的模型；报告重建从已保存记录生成，不重新执行用例。
- 测试结果保留失败、取消和清理状态；证据缺失、工具错误或必要清理失败不会算作通过。报告界面及部分提示以中文为主。

## 文档与帮助

| 从这里开始 | 内容 |
| --- | --- |
| [完整文档导航](doc/README.md) | 使用、部署、架构、设计和验收记录 |
| [使用说明](doc/user-guide/使用说明.md) | 命令、文件、参数、计划审核与报告 |
| [CSV 参数文件使用手册](doc/user-guide/CSV参数文件使用手册.md) | 可复制示例、占位符、数据展开、审核与常见错误 |
| [GitLab 测试要求与本地调试](doc/user-guide/GitLab测试要求与本地调试.md) | 系统与账号要求、复杂用例、数据准备及插件调试 |
| [执行步骤与进度](doc/user-guide/执行步骤与进度显示.md) | 步骤展开、运行阶段和耗时 |
| [实际步骤与手工用例](doc/user-guide/实际步骤与手工用例.md) | 操作记录及可复用的手工用例导出 |
| [预览配置](doc/user-guide/浏览器实时预览一步一步配置.md) · [录像与报告](doc/user-guide/浏览器录像与报告.md) | 实时画面、视频依赖、回看和下载 |
| [安装与运维](doc/deployment/安装与运维.md) · [故障速查](doc/deployment/常见问题速查与处理.md) | 安装、升级、卸载、环境恢复和常见问题 |
| [当前架构](doc/architecture/当前实现.md) | 模块职责与执行链路 |

## 开发与贡献

欢迎通过 [Issues](https://github.com/Pegasus-Yang/DSH-Test-Plugin/issues) 反馈问题或提交改进。反馈时请附上插件、DSH、Node.js 和 MCP 版本，复现步骤及已脱敏的错误信息。

源码开发：

```sh
git clone https://github.com/Pegasus-Yang/DSH-Test-Plugin.git
cd DSH-Test-Plugin
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:integration
```

本地打包与隔离调试见[安装与运维](doc/deployment/安装与运维.md)，真实测试范围见[开发与验收记录](doc/project/开发进度.md)。提交改动前完成相关检查并同步文档；凭据、日志和原始运行资料保存在不提交的本机目录中。

## 许可证

本项目采用 [MIT](LICENSE) 许可证。第三方依赖及图标许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
