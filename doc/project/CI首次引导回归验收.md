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

## 最终本机结果

macOS arm64、Node.js 22.22.3、项目 pnpm 11.7.0。三个宿主使用同一个 0.13.0 tgz，SHA-256 为 `2f2d56222b89fadce466d92e2caf04a8bee14866f0672412064026610b575cef`。包的 95 个运行文件、支持策略和锁文件与原 0.13.0 交付相同，包差异仅为本轮更新的 changelog、文档导航与验证指南。

| 宿主 | 公开／同批 profile 无豁免安装 | 类型与回归 | Web、持久化、停用／启用、卸载及 MCP |
| --- | --- | --- | --- |
| 0.2.1-alpha.1 | 通过，SDK 副本 0 | 385 项，失败 0、跳过 0 | 全部通过 |
| 0.2.1-alpha.2 | 通过，SDK 副本 0 | 同上 | 全部通过 |
| 0.2.1-alpha.3 | 通过，SDK 副本 0 | 同上 | 全部通过 |

父进程确实存在默认模型环境密钥，三个宿主各 6 次启动的 `default_model_env_key` 全部为 false，证明隔离生效。18 个宿主 PID 均已退出，另行进程扫描无余留。浏览器专项另计 5 项；本轮没有重复运行未改动的真实模型／GitLab 业务链路，原验收范围保持其历史记录。

`artifacts/validation/ci-onboarding/` 保存 PASS 汇总、GitHub 原始元数据、5 项专项 TAP、同一包及三版 SDK／锁文件／385 项回归／Web／生命周期记录；`reproduction/` 保留原脚本无密钥失败，`exploration/v1/` 保留第一轮 alpha.3 未完成账号引导的失败。认证 URL 与原始日志保留在忽略目录，密钥值不写入记录或 Git。

本轮只创建本地常规 CI 修复提交，不递增产品版本或移动已发布标签。修复后的 GitHub Actions 须在用户推送修复提交后确认；原始 `v0.13.0` 运行仍保留失败，本机通过不表述为远端已通过。
