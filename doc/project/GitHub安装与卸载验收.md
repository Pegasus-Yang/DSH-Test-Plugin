# GitHub 安装与卸载验收

日期：2026-10-05。版本：0.9.1。目标是普通用户直接安装 Git 仓库后可启用和执行，停用、卸载后 Playwright MCP 仍可工作；不依赖本机 DSH 源码、`link-host` 或调试 overlay。

## 原始问题与修复

实际从 `github:Pegasus-Yang/DSH-Test-Plugin` 安装的 0.9.0 包只含文档、配置和示例，没有 `dist/index.js`；清单入口仍指向该文件。DSH 能登记 bundle，随后启用报告 `harness-test (dsh-test-plugin): failed to import`。旧验收使用本地 tgz，未覆盖 Git 来源。

同时，旧自动预览通过 config-editor 持久修改另一个 MCP，生成 JSON 引用已安装包中的初始化文件；公开卸载移除包后，这条引用失效。

0.9.1 将构建产物随 Git 版本提交，不添加安装生命周期脚本。公开 npm SDK 开发依赖使源码可独立构建；入口检查及 CI 重建比较防止遗漏或陈旧产物。自动预览改为选中 MCP 的运行配置拦截，原始 Entry 和 profile 不改写。插件退出恢复最新原始参数，整体停服不重启正在退出的 MCP；初始化扩展保留运行目录副本。

## 验证环境与结果

| 范围 | 环境与结果 |
| --- | --- |
| 无宿主链接的构建 | 干净 Git 源码副本，仅公开 npm 开发依赖；Node.js 22.22.3、pnpm 11.7.0；类型、构建与产物一致性检查通过 |
| 回归 | 144 个单元测试与 33 个集成测试，共 177 项通过；包含删除插件文件、最新用户参数保留、切换 MCP、关闭及宿主退出 |
| 真实宿主 | 临时安装公开 npm `@deepseek-ai/dsh@0.2.1-alpha.1`，独立 home/profile/workspace，不加载本机 DSH 源码 |
| Git 候选安装 | 标准 CLI `plugin --profile web add git+file://...#提交`，默认构建策略，直接安装成功，宿主/客户端/CDP 入口存在；隔离宿主安装器使用系统 pnpm 12.8.1 |
| 真实 GitHub 安装 | 标准插件页填写真实仓库地址，固定提交 `1eea8f8e77a29b7dfdfdb6c3fb7ec8a7f023482c`，安装后立即启用成功；69 个安装产物与已执行用例的候选逐字节一致 |
| 设置 | 真实设置页检测 Browscreen 0.2.1，未检测安装引导、保存、刷新保持均通过；无页面异常 |
| 接口用例 | 真实输入框 `/test-plan`，本地 GET 状态 200、amount=101，原生审核后 PASS；无浏览器动作或浮窗 |
| 浏览器用例 | 真实输入框 `/test`，访问本地页面、点击按钮、核对 h1，PASS；CDP 和画面浮窗有效，观察到 23 个不同帧编号，结束后关闭 |
| 持久配置 | 运行后原始 MCP 注册不变；没有预览 `--config`、`DSH_TEST_PREVIEW_DIR` 覆盖或插件初始化文件引用 |
| 页面生命周期 | 真实插件管理页停用、重新启用、确认卸载成功；无页面异常；包依赖及 bundle 登记移除；公开插件状态查询确认 MCP 仍为 active |
| 卸载后冷启动 | 独立宿主冷启动无 `failed to import`、`Init page file does not exist` 或插件激活错误 |
| Linux CI | Ubuntu 上从公开 npm 安装开发依赖，入口检查、源码重建与已提交 `dist` 比较、177 项回归及实际 tgz 检查通过；[CI记录](https://github.com/Pegasus-Yang/DSH-Test-Plugin/actions/runs/37251626384) |

代码交付提交为 `1eea8f8e77a29b7dfdfdb6c3fb7ec8a7f023482c`；最终文档随 0.9.1 标签交付，标签解析到包含该代码和验收记录的最终提交。原始终端输出、profile、认证地址、模型引用、浏览器截图及运行结果保存在本地忽略目录，不作为公开发行文件。

## 验证范围

Git 候选来源采用实际 Git 克隆和包管理流程，不是本地 tgz。宿主是公开 npm 安装；模型沿用已配置的可用路由，MCP 使用正常的 `pnpm dlx @playwright/mcp@0.0.68`，Browscreen 使用已安装的 0.2.1 命令。验收客户端使用 Playwright 驱动真实页面，不直接调用插件执行器或伪造运行结果。

真实宿主和浏览器证据来自 macOS；Linux 的构建、回归及包检查由 CI 验证。没有宣称验证 Windows、所有宿主/MCP 版本或多对话并行。0.9.0 及以前的持久覆盖属于历史配置，按[F15](../deployment/常见问题速查与处理.md#f15-卸载后的预览配置残留)核对并恢复；新运行配置接入不替用户删除旧修改。
