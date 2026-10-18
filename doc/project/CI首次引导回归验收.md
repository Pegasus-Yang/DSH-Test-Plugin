# CI首次引导回归验收

[文档导航](../README.md) · [多版本验证](../deployment/DSH多版本验证.md) · [0.13.0 本地交付](0.13.0多版本兼容验收.md)

2026-10-18。修复范围为验证脚本、CI 专项回归及文档；包版本仍为 0.13.0，发行运行代码不变，已发布的 `v0.13.0` 标签不移动。本轮创建本地修复提交，由用户审核后推送；修复提交的远端 CI 结果须推送后核对。

## 远端失败与复现

[原始运行 39102345912](https://github.com/Pegasus-Yang/DSH-Test-Plugin/actions/runs/39102345912) 对应 `fa65052697898448b447ab694a7ee3e6ef9d0a55`、标签 `v0.13.0`。GitHub API 记录 `plugin` 构建作业成功，三个 `host` 作业失败，汇总门禁失败。用户提供的 alpha.2 日志表明失败位于 `public-web`：首次引导遮罩拦截“设置”按钮，Playwright 超时。

Ubuntu 标签迁移属于独立告警，变更计划见 [runner-images 官方公告](https://github.com/actions/runner-images/issues/14748)。本轮没有通过更换镜像规避页面错误。

原脚本只等待欢迎页两秒，点击一次“继续”后直接进入设置。无模型凭据时，宿主随后显示“添加一个 API Key 开始使用”，需要选择“稍后配置”。本机进程原来继承了 `DEEPSEEK_API_KEY`，使该分支被跳过，掩盖了 CI 条件的缺口。

在公开 alpha.2 SDK 的全新 home/profile 中安装同一个 0.13.0 包，移除宿主进程的该变量后，原脚本复现点击超时，DOM 与截图明确保留该凭据弹窗。没有填写密钥或调用模型。

## 修正与验证

- 共用浏览器入口和设置操作按弹窗可访问名称识别已知引导，使用实际按钮完成；等待目标可操作，支持引导异步出现和不同宿主的账号菜单。alpha.1／alpha.2 凭据表单选择“稍后配置”；alpha.3 的“开始使用”账号引导使用原生关闭，沿宿主 [AccountOnboarding 的 complete 回调](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/packages/client/ui-settings-account/src/client/AccountOnboarding.tsx) 结束引导。仅重试 Playwright 操作超时，未知弹窗和其他异常保留失败。
- 公开宿主及未启用受控模型的同批宿主在启动前移除 `DEEPSEEK_API_KEY`；受控模型 profile 继续按显式配置使用凭据。摘要和 Web 记录只保存变量存在性，不输出密钥。
- 增加 5 项真实 Chromium 专项：无密钥时连续两个引导、晚于两秒的欢迎页、已有配置的账号菜单、alpha.3 账号引导原生关闭、未知弹窗拒绝。五项全部通过；CI 在浏览器安装后、宿主矩阵之前执行。
- 第一轮修正仅覆盖凭据表单，alpha.1／alpha.2 通过，alpha.3 仍显示“开始使用”账号引导，原 FAIL、截图及日志保留。核对该版官方源码并补齐原生关闭后，使用最终脚本、全新目录重新完成三个宿主的完整矩阵。

## 首轮本机结果

macOS arm64、Node.js 22.22.3、项目 pnpm 11.7.0。三个宿主使用同一个 0.13.0 tgz，SHA-256 为 `2f2d56222b89fadce466d92e2caf04a8bee14866f0672412064026610b575cef`。包的 95 个运行文件、支持策略和锁文件与原 0.13.0 交付相同，包差异仅为本轮更新的 changelog、文档导航与验证指南。

| 宿主 | 公开／同批 profile 无豁免安装 | 类型与回归 | Web、持久化、停用／启用、卸载及 MCP |
| --- | --- | --- | --- |
| 0.2.1-alpha.1 | 通过，SDK 副本 0 | 385 项，失败 0、跳过 0 | 全部通过 |
| 0.2.1-alpha.2 | 通过，SDK 副本 0 | 同上 | 全部通过 |
| 0.2.1-alpha.3 | 通过，SDK 副本 0 | 同上 | 全部通过 |

父进程确实存在默认模型环境密钥，三个宿主各 6 次启动的 `default_model_env_key` 全部为 false，证明隔离生效。18 个宿主 PID 均已退出，另行进程扫描无余留。浏览器专项另计 5 项；本轮没有重复运行未改动的真实模型／GitLab 业务链路，原验收范围保持其历史记录。

`artifacts/validation/ci-onboarding/` 保存 PASS 汇总、GitHub 原始元数据、5 项专项 TAP、同一包及三版 SDK／锁文件／385 项回归／Web／生命周期记录；`reproduction/` 保留原脚本无密钥失败，`exploration/v1/` 保留第一轮 alpha.3 未完成账号引导的失败。认证 URL 与原始日志保留在忽略目录，密钥值不写入记录或 Git。

本轮只创建本地常规 CI 修复提交，不递增产品版本或移动已发布标签。修复后的 GitHub Actions 须在用户推送修复提交后确认；原始 `v0.13.0` 运行仍保留失败，本机通过不表述为远端已通过。

## 第二次远端失败：未选择工作区

同日用户推送 `b213273bc62f72e55598138345a6689a351033b3` 后，[运行 39104580394](https://github.com/Pegasus-Yang/DSH-Test-Plugin/actions/runs/39104580394) 的构建及三个宿主各自的 5 项浏览器专项全部通过，三个宿主仍在 `public-web` 失败。已读取三版实际作业日志并下载全部宿主证据；三份摘要的失败位置均为 `enter()` 等待 `[contenteditable="true"]` 超时，公开 CLI 安装均无豁免、profile 内 SDK 副本为 0。

三版失败截图均已没有首次引导弹窗，而是停在“选择一个工作区开始”的首页。宿主 [ComposerContentEditable](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/client/ui-conversation/src/client/input/editor/ComposerContentEditable.tsx) 按 `editor !== null && editable` 设置 `contentEditable`；未选择工作区时输入框不可编辑，但设置入口仍可用。上一轮修正新增的首页就绪检查错误地要求输入框可编辑；首轮使用的浏览器夹具始终提供可编辑输入框，macOS 完整矩阵也未覆盖远端这一起始状态，因此没有发现这个额外前提。

本轮将首页就绪改为实际“设置”按钮或“账号菜单”可执行 Playwright 试点击；打开设置仍执行真实点击，已知引导继续由原生按钮完成，未知弹窗仍阻止操作。停用／卸载分支删除同样不相关的可编辑输入框等待，沿用实际样式、HTTP 和 MCP 断言。Web 结果新增 `editable_composer_on_entry`，记录就绪时是否存在可编辑输入框，以确认实际覆盖了未选工作区状态。真实模型驱动继续先创建工作区和会话，再操作聊天输入框。

新增两条真实 Chromium 回归，同时覆盖直接设置入口和账号菜单入口：输入框固定为 `contenteditable="false"`，先完成首次引导，再打开插件设置，核对真实按钮事件与设置值。旧脚本下两条均因输入框等待超时而失败；修复后浏览器专项合计 7 项。

从上述运行下载的原始候选包 SHA-256 为 `7e8a4d591d49e1c1309524157eb966c244c60a7b2aa66183e7949ec26adcdfc5`，与三份远端失败摘要一致。本轮使用这个原包复验，改动仅限 CI 验证代码、回归和文档，产品版本仍为 0.13.0。

## 本轮 Linux 复现

使用官方 `node:22.22.3-bookworm-slim` 的 linux/amd64 容器，Node.js 22.22.3、pnpm 11.7.0；系统为 Debian Bookworm，GitHub 实际 runner 为 `ubuntu-latest`。容器仅挂载项目验证副本、只读使用的官方 Git 对象副本、候选包及验证输出，没有挂载用户 home、宿主运行配置或模型凭据。项目依赖从空目录冻结安装，两个 Playwright 版本各自安装所需 Chromium。

先使用 `b213273` 的原始脚本、上述 CI 原包和全新 alpha.2 home/profile 运行完整驱动，公开 CLI 无豁免安装通过，随后在 `public-web` 同样等待输入框超时并返回 1；截图与远端均停在未选工作区的首页，验证宿主已退出。保留该次预期 FAIL，不改写为 PASS。修复后的 7 项真实 Chromium 专项在同一 Linux 容器全部通过，失败与跳过均为 0；旧脚本的两项未选工作区专项失败另存。

## 本轮 Linux 完整矩阵结果

三个宿主分别使用全新目录、独立 `DSH_HOME` 和 profile，以同一个 CI 原包运行最终脚本；没有放宽超时、版本门禁或业务断言。

| 宿主 | 公开／同批 profile 无豁免安装 | 同批 SDK、类型与回归 | Web、持久化、停用／启用、卸载及 MCP |
| --- | --- | --- | --- |
| 0.2.1-alpha.1 | 通过，SDK 副本 0 | 同批版本无漂移；385 项，失败 0、跳过 0 | 全部通过 |
| 0.2.1-alpha.2 | 通过，SDK 副本 0 | 同上 | 全部通过 |
| 0.2.1-alpha.3 | 通过，SDK 副本 0 | 同上 | 全部通过 |

三份公开 Web 结果均为 `editable_composer_on_entry: false`，明确证明在未选工作区、没有可编辑聊天输入框的条件下通过设置入口验证。全部 Web 结果无浏览器脚本错误；三个宿主各 6 次启动均没有默认模型环境密钥，各 6 个 PID 均已退出。矩阵结束后容器内仅剩初始化进程和验证容器的保活进程，没有 DSH、MCP 或 Chromium 残留；临时容器已停止并移除。

原 CI 包的 95 个 `dist` 文件、兼容策略及插件配置与当前工作区逐字节一致；验证脚本、浏览器回归及 CI 步骤的源码摘要与最终工作区一致。证据保存在忽略目录 `artifacts/validation/ci-workspace-state/`，包括远端三版失败摘要与截图、原脚本 Linux 复现、7 项专项 TAP、原候选包、三版 SDK／锁文件／385 项回归／Web／生命周期和进程清理证明。认证 URL 与原始宿主日志继续只保存在私有验证目录。

本次为 CI 脚本修正，未重跑真实模型或 GitLab 业务链路，不改变原 0.13.0 业务验收范围；版本及已发布标签保持不变。创建中文本地提交，不自动推送。上述结果为本机 Linux 容器验证，修复提交对应的 GitHub Actions 仍须推送后核对。
