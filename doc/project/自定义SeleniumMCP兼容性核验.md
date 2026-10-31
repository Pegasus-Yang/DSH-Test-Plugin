# 自定义 Selenium MCP 兼容性核验

核验日期：2026-10-31。对象为已交付的插件 **0.17.0** 和公开 DSH **0.2.1-rc.5**。本轮新增测试服务和复现脚本，未修改插件运行代码、浏览器设置或发行包。

## 结论

当前插件不能直接把任意 Selenium MCP 当作完整的 UI 测试后端。DSH 能加载该 MCP、向模型提供工具，不代表插件的操作记录、可信采集和浏览器收尾能自动适配它。

如果自建服务以 Selenium 执行浏览器操作，同时实现插件当前依赖的 Playwright 工具约定，本轮场景可以执行并生成通过报告；不需要启动 `@playwright/mcp` 或配置 RunBridge。这是针对已实现工具子集的协议兼容验证，不等于新增了通用 Selenium 后端。

| 验证对象                                          | 实际结果                                                                                         | 报告与证据                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 独立 Selenium MCP                                 | PASS：真实导航、读取 0、点击、读取 1、执行只读脚本、PNG 截图和退出 WebDriver                     | `standalone/standalone.json`、WebDriver 会话与工具审计                          |
| 原生命名 `mcp__selenium__browser_*`，固定内部计划 | ERROR：初始化所需的 Playwright 关闭工具不存在，Selenium 同名关闭工具被后端守卫拒绝；业务点击为 0 | ERROR HTML、实际步骤 JSON、手工 Markdown 均生成；保留隔离，不能视为 UI 执行通过 |
| Selenium 实现现有工具约定，固定内部计划           | PASS：点击请求为 1，程序断言实际计数 1 等于固定预期 1                                            | HTML、PNG、实际步骤 JSON、手工 Markdown、账本重放均通过                         |
| 同一兼容模式，Markdown 用户入口                   | PASS：从文字用例规划、执行到数值检查及收尾                                                       | 独立运行、HTML、PNG、手工 Markdown 及账本重放                                   |

全部宿主运行均检查测试作用域已关闭、Agent 空闲、`whenIdle()` 已完成、在途工具为 0，之后停止本轮宿主。原生模式的隔离来自插件未取得浏览器释放证据；该服务实际没有创建 WebDriver 会话。

## 场景与环境

固定业务规则：每次打开本地计数页，初始值为 0；点击“增加 1”一次后，`#counter` 的数值应等于 1。预期在执行前固定，不从实际结果反推。计数页还向夹具服务发送点击请求，以交叉核对真实交互次数。

| 项目               | 本轮基线                                                               |
| ------------------ | ---------------------------------------------------------------------- |
| 插件代码           | `75fac65a56872f3902c263e30bcb7b62807114ee`，`v0.17.0`                  |
| 同一候选包 SHA-256 | `a9653e3b121e0e2567077bb9990770d4970b4a71da9fa94224e7e43b66253acb`     |
| DSH                | 公开 npm `@deepseek-ai/dsh@0.2.1-rc.5`，独立 home、profile、工作区     |
| Node.js / pnpm     | 22.22.3 / 11.7.0                                                       |
| Selenium / MCP SDK | `selenium-webdriver@4.51.0` / `@modelcontextprotocol/server@2.4.0`     |
| 浏览器             | 真实 Chrome 156.0.8078.80，通过 ChromeDriver 执行                      |
| 浏览器参数         | headless、独立临时用户目录、1440 × 900 窗口参数                        |
| 模型               | 本机受控真实模型配置；只读取模型与默认模型两项补丁，凭据由本机环境提供 |

本轮宿主的工具目录没有 RunBridge 工具，独立宿主没有安装 `@playwright/mcp`。兼容模式仅通过 MCP 客户端的 `serverName: playwright` 生成插件需要的前缀；服务内部始终调用 Selenium WebDriver。项目已有 Playwright 只用于操作 **DSH 本身的 Web 界面**、输入命令和查看报告，不参与被测计数页的导航、点击、DOM 采集或截图。

## 原生接入为何失败

本轮原生服务提供七个合法 MCP 工具，直接 MCP 自检全部通过。接入插件后，执行记录保留以下失败：

1. 插件在浏览器初始化阶段先通过 `test_capture` 执行复位；默认调用 `mcp__playwright__browser_close`，宿主返回 `UNKNOWN_TOOL`。
2. 模型尝试 `mcp__selenium__browser_close` 时，插件返回“本次测试只允许所选浏览器后端，不能切换浏览器”。
3. 后续重试仍未取得关闭证据；运行封存为 ERROR，停止原因是“浏览器释放失败，禁止后续业务”。模型尝试的 shell 调用也被释放阶段守卫拒绝，未作为绕行方式执行。

对应实现入口：

| 约束                                             | 当前源码                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 后端配置仅有 `playwright` 与 `runbridge`         | [`browser-preferences.ts`](../../src/browser-preferences.ts)、[`config.ts`](../../src/config.ts)  |
| 默认前缀、初始化／关闭工具、选中后端守卫         | [`native-test.ts`](../../src/native-test.ts) 的 `browserPrefix`、`closeTool`、工具执行守卫        |
| 实际操作支持名单固定为现有两个后端               | [`actual-operations.ts`](../../src/actual-operations.ts) 的 `operationToolNames`、`operationTool` |
| 默认 DOM、截图和释放采集固定调用 Playwright 工具 | [`adapters.ts`](../../src/adapters.ts) 的 `captureStep`                                           |
| 默认 DOM 响应只解析文本中的 `### Result` JSON 段 | [`adapters.ts`](../../src/adapters.ts) 的 `mcpResult`                                             |

因此，仅改 MCP 服务名也不充分：参数如 `ref`、`function`、`type`、`fullPage` 及 DOM 返回的 JSON 形状仍须符合插件预期。普通 MCP 的 `structuredContent` 或纯 JSON 文本不会自动替代现有解析器。

报告生成与浏览器驱动分离，所以原生接入失败仍有错误报告。没有成功执行的动作不会成为可再次执行的手工步骤，报告存在也不表示测试通过。

## 测试服务与复现

夹具源码在 [`tests/fixtures/selenium-mcp/`](../../tests/fixtures/selenium-mcp/)，依赖使用独立清单和锁文件，不进入插件发行包，也不改变根目录依赖。

| 文件                  | 用途                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| `server.mjs`          | stdio MCP 服务；`native` 和 `playwright-contract` 两种接口均使用真实 Selenium    |
| `counter.mjs`         | 本地固定计数页与实际点击请求记录                                                 |
| `smoke.mjs`           | 独立 MCP 自检，不依赖 DSH 或模型                                                 |
| `host-probe.mjs`      | 安装同一候选包，创建独立 DSH profile，通过原生命令运行用例并核对报告、审计及停止 |
| `host-diagnostic.mjs` | 独立验收宿主的认证只读探针，观察工具目录、测试作用域和 Agent 空闲状态            |

先安装项目开发依赖及测试服务依赖，准备本机 Chrome、可用的真实模型补丁和已构建候选包。模型补丁的结构沿用[多版本验证](../deployment/DSH多版本验证.md#受控真实模型与-gitlab)，本脚本使用 `apiKeyEnv` 环境凭据。

```sh
pnpm install --frozen-lockfile
pnpm --dir tests/fixtures/selenium-mcp install --ignore-workspace --frozen-lockfile

probe_root="$(mktemp -d /tmp/dsh-selenium-probe-XXXXXX)"
mkdir "$probe_root/host"
npm install --prefix "$probe_root/host" --cache "$probe_root/npm-cache" --no-audit --no-fund @deepseek-ai/dsh@0.2.1-rc.5

export SELENIUM_PROBE_DSH_ROOT="$probe_root/host"
export SELENIUM_PROBE_MODEL_PATCH=/绝对路径/不提交的模型配置.yml
export SELENIUM_PROBE_ARCHIVE="$PWD/artifacts/package/dsh-test-plugin-0.17.0.tgz"
export SELENIUM_BROWSER_BINARY='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export SE_CACHE_PATH="$probe_root/selenium-cache"

node tests/fixtures/selenium-mcp/smoke.mjs "$probe_root/standalone"
node tests/fixtures/selenium-mcp/host-probe.mjs "$probe_root/fixed-plan" all json
node tests/fixtures/selenium-mcp/host-probe.mjs "$probe_root/markdown" playwright-contract markdown
```

`host-probe.mjs` 第三个参数选择 `all`、`native` 或 `playwright-contract`，第四个参数选择内部 `json` 或用户 `markdown` 入口。每个输出目录只运行一次，复验使用新的目录。JSON 计划仅用于排除规划差异、精确验证执行边界，用户入口仍采用 Markdown。

脚本会写入私有的宿主补丁、认证启动信息与日志，并在退出时停止自己启动的宿主和夹具服务。运行资料留在本机忽略目录或临时目录，不提交到 Git。独立使用 `server.mjs` 时需提供 `SELENIUM_MCP_ORIGIN`、`SELENIUM_MCP_OUTPUT`；导航只允许本轮来源，`SELENIUM_MCP_MODE` 默认为 `native`。

## 证据与验证边界

本机归档位置为 `artifacts/selenium-mcp-probe/2026-10-31/`：保留独立自检、原生失败、内部计划兼容通过、Markdown 兼容通过四组摘要、报告和服务审计。宿主认证 URL、模型配置及完整宿主日志不纳入该归档或 Git。

本轮 `agent-state-before-idle.json` 是报告封存时的状态快照；最终空闲检查结果在 `summary.json` 中，不能把较早快照视为最终状态。复现脚本另存最终核对的 `idle-state.json`，便于后续复验直接查看。

补充检查：五个新增 JavaScript 模块的 `node --check`、新增文件的 Prettier 检查、`git diff --check` 均通过；现有 `adapters.test.ts` 与 `actual-operations.test.ts` 共 18 项回归通过。未重新运行十宿主发行矩阵，本轮没有修改插件代码或支持集合。

首次夹具调试发现浏览器内联事件中的 `URL` 被文档命名属性遮蔽，已改为 `window.URL` 后重新通过独立自检。另一次预检把三个最外层 Markdown 列表项解析成三个用例，并触发规划超时；该轮仅作为入口准备问题留在临时目录，不计入上述单用例结果。最终固定计划与 Markdown 单用例均独立运行。

本轮覆盖本地单页导航、元素读取、原子点击、DOM 数值检查、截图、关闭、实际操作记录、手工文件和账本报告。兼容服务只实现本场景所需的六个工具；`browser_take_screenshot` 返回视口截图并标明 `scope: viewport`，未实现长页全屏截图。未验收登录、上传、多标签、复杂控件、录像、持续预览、远程 Grid、并发或 Selenium 全量 API；不能据此扩大正式后端支持声明。

若后续需要原生 Selenium 工具直接接入，应单独设计工具映射、操作识别、可信采集、生命周期与恢复适配，并验证其返回合同。该产品改造不属于本轮测试交付。

实现参考：[MCP stdio 服务文档](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio)、[Selenium JavaScript API](https://www.selenium.dev/selenium/docs/api/javascript/)、[Selenium Manager](https://www.selenium.dev/documentation/selenium_manager/)。
