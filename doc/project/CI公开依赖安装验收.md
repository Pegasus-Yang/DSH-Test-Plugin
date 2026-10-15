# CI 公开依赖安装验收

[文档导航](../README.md) · [宿主升级适配验收](DSH宿主升级适配验收.md) · [安装与运维](../deployment/安装与运维.md) · [版本发布](../deployment/版本发布与Git标签.md)

## 问题与复现

2026-10-15 修复插件 **0.12.3** 的公开 SDK 开发依赖。用户提供的 GitHub CI 日志使用 DSH `0.2.1-alpha.1`，7 个单元测试套件在加载 `dsh-mcp-client` 时找不到 `@deepseek-ai/dsh-scope`。将已升级至 alpha.3 的 `0.12.2` 提交 `2ab807f` 克隆到项目目录之外、冻结安装后，同样复现 **7 个套件失败、21 个通过、186 项已加载测试通过**。

原因是 `autoInstallPeers: false`，SDK 的部分 peer 需要开发环境显式提供，但清单和锁文件没有包含其运行时导入所需的包。本机 `link-host` 曾留下 303 个未直接声明的宿主源码链接，Node 可以沿祖先目录找到它们；在已有 `node_modules` 中再次冻结安装、仅检查直接依赖是否来自 npm，均不能证明干净环境完整。

## 修复范围

开发依赖统一固定为 `0.2.1-alpha.3`，补齐以下实际导入链，并重新生成锁文件：

| 补齐的包                      | 运行时导入来源                                |
| ----------------------------- | --------------------------------------------- |
| `@deepseek-ai/dsh-scope`      | `dsh-mcp-client`、`dsh-agent`、`dsh-tools` 等 |
| `@deepseek-ai/dsh-subprocess` | `dsh-mcp-client`                              |
| `@deepseek-ai/dsh-attachment` | `dsh-mcp-client`                              |
| `@deepseek-ai/dsh-sandbox`    | `dsh-tools`                                   |
| `@deepseek-ai/dsh-http-proxy` | `dsh-subprocess`                              |

保留原有 peer 安装策略；新增 5 条精确版本的 `minimumReleaseAgeExclude`，由 pnpm 根据本次新依赖生成。宿主仍提供运行时 SDK 服务，插件没有新增服务配置或业务能力。CI 在构建与 `dist` 比较后执行 `node --input-type=module -e "await import('./dist/index.js')"`，直接检查入口和传递依赖能否加载。

独立 macOS 回归先通过 300 项单元测试，随后取消等待的集成用例出现一次调度竞态：真实 25 毫秒宽限期与 `setTimeout(0)` 竞争，预期的第二次 followup 尚未发生。原用例单独复验通过。该用例改用受控时钟，在宽限期结束前 1 毫秒确认仍等待、未关闭，排空后才允许清理，并验证取消状态和原会话归属；生产超时参数保持原值。

## 独立环境与结果

验证副本均位于 `/private/tmp/`，与项目源码和宿主目录没有祖先依赖关系。Linux 首次安装没有 `node_modules`，没有挂载宿主源码、模型配置或凭据。使用官方 `node:22.22.3-bookworm-slim` 的 **linux/amd64** 容器、Node.js `22.22.3`、pnpm `11.7.0`，按工作流顺序执行；容器系统为 Debian Bookworm，GitHub 的实际 runner 为 `ubuntu-latest`。

| 检查                                           | 结果                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`               | 通过；公开仓库新安装，锁文件未变化                                                                |
| `pnpm verify:package`                          | 通过                                                                                              |
| `pnpm build` 与 `git diff --exit-code -- dist` | 通过；构建产物与提交候选一致                                                                      |
| 直接导入 `dist/index.js`                       | 通过；未借助宿主链接                                                                              |
| `pnpm typecheck`                               | 通过                                                                                              |
| `pnpm test:unit`                               | 28 个文件、300 项通过                                                                             |
| `pnpm test:integration`                        | 1 个文件、63 项通过                                                                               |
| 取消测试改用受控时钟后的复验                   | Linux 完整 63 项集成测试及入口导入再次通过                                                        |
| `pnpm pack`、解包及 `check-package`            | 通过                                                                                              |
| SDK 来源检查                                   | 干净 macOS 副本的 30 个顶层 SDK 均来自本副本的 `.pnpm`；Linux 的 `dsh-scope` 也解析至本副本公开包 |

完整初次 Linux 工作流通过后，仅针对后续取消测试修改重跑集成回归；最终文档再单独核对及打包。原始复现、安装、Linux 流程、取消测试复验及包核对结果保存在忽略目录 `artifacts/validation/ci-public-deps/`，首次失败摘要也予以保留。临时验证容器均在命令结束后自动删除。

最终 tgz 共 158 个文件，其中 `dist` 为 95 个；包内文件与交付文件逐字节一致，清单按 pnpm 标准移除 `packageManager` 后语义一致。解包后只连接独立公开依赖副本，宿主入口真实导入通过；最终 `dist` 与 Linux 重建结果逐字节一致，最终集成源码也与 Linux 复验副本一致。

## 交付边界

包版本、运行 manifest、当前中英文文档及本地附注标签统一为 **0.12.3**。历史 0.12.2 的真实宿主、模型、Markdown 网页/接口用例及报告证据保持原貌；本次验证覆盖依赖安装和 CI 行为回归，没有新增真实模型或 GitLab 业务执行。

只创建本地提交和附注标签 `v0.12.3`，由用户审核后手动推送。Linux 本地结果不代表远端 GitHub Actions 已通过；实际远端状态须在推送后核对对应提交。
