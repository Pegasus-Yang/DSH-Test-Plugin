# Agent 自动安装插件与 Playwright MCP

[项目首页](../../README.md) · [安装与运维](安装与运维.md) · [使用说明](../user-guide/使用说明.md)

本文可直接交给具备终端、文件读写及浏览器操作能力的 Agent 执行，目标是在用户实际使用的 **DSH Web profile** 中安装插件、本机 Playwright MCP 和匹配的 Chromium，并完成首条网页测试。示例命令采用 macOS／Linux shell；其他系统按实际路径和 shell 转换。

当前插件 **0.17.0** 只支持 **Playwright MCP / RunBridge MCP** 两种浏览器连接。本流程选择本机 Playwright MCP；远程环境改用[RunBridge 安装与使用](安装与运维.md#远程-runbridge-mcp-安装与使用)。Selenium MCP、Chrome DevTools MCP、Playwright CLI 及 Agent 自带浏览器不能替代本流程的运行连接。

## 可直接发送给 Agent 的任务

```text
请按本文在当前机器安装并验证 DSH Test Plugin 0.17.0、Playwright MCP 0.0.68 和 MCP 自身匹配的 Chromium。

先检测 Node.js、npm、pnpm、DSH、现有 profile、DSH_HOME、模型是否已配置以及可复用的 Playwright MCP。
安装目标是用户运行插件的 DSH profile，不是你自己的 MCP 配置。已有支持版本及模型配置应复用；缺少 DSH 时使用本文列出的精确版本，不安装 latest。
确定并记录实际工具目录、工作区、报告目录和启动命令。备份后合并配置，保留原有模型、认证、其他插件及设置，避免重复注册。
完成依赖安装、插件安装、MCP 配置、DSH 启动和本文的固定页面验收。默认不安装可选的 Browscreen，不开启预览或录像。
只把实际完成的步骤报告为成功。缺少模型凭据或 UI 操作能力时，继续完成可独立验证的安装步骤，并明确列出尚未完成的验收和需要用户提供的信息。
交付版本、安装位置、改动文件、启动方式、验收结果和报告路径；不要在回复中输出凭据或带认证信息的访问地址。
```

## 确定安装目标

1. 检查 `node --version`、`npm --version`、`pnpm --version`、`dsh --version`，以及实际可执行文件路径。Node.js 最低 **22.19**，pnpm 使用 **11.7.0**。已有 DSH 必须属于 [dsh-compatibility.json](../../dsh-compatibility.json) 的完整支持列表：当前为 `0.2.1-alpha.1`～`alpha.5`、`0.2.1-rc.1`～`rc.5`。本安装只验证目标宿主；维护项目时每轮最多测试最旧、最新两个宿主，不遍历中间版本。
2. 检测当前环境的 `DSH_HOME`、实际启动命令及 profile。未自定义时为 `~/.dsh` 和 `web`，对应 patch 是 `~/.dsh/profiles/web/cordis.patch.yml`；自定义时沿用实际值。只在发现多个实际环境、范围外宿主或无法判断用户目标时确认目标，不自行覆盖已有宿主。
3. 选定长期保留的 MCP 工具目录（如 `~/dsh-browser-tools`）与测试工作区（如 `~/DSH-Testing`）。将后文所有 `/绝对路径/…` 替换成真实绝对路径，不把 `~`、变量名或占位符直接写入 YAML 参数。已有运行资料的 `outputRoot` 保持原路径。
4. 等待原任务完成、Agent 空闲后正常停止目标 DSH，再修改插件及 profile。备份现有 patch；检查 home 级 patch 和启动 `--patch` 是否存在更高优先级覆盖。

## 安装宿主和插件

已有可用宿主及 pnpm 时跳过对应安装。缺少宿主或 pnpm 时，按需执行：

```sh
npm install --global pnpm@11.7.0
npm install --global @deepseek-ai/dsh@0.2.1-rc.5
```

Node.js 缺失时，先按 [Node.js 官方下载说明](https://nodejs.org/en/download)安装满足最低版本的运行环境，再重新检测。DSH 的安装及模型配置以[官方指南](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.5)为准。已有支持版本不强制升级；用户目录安装时确保实际 DSH 进程能找到 Node.js 和 pnpm。

在实际目标 home 下安装到同一 profile，以下默认 `web`：

```sh
dsh plugin --profile web add github:Pegasus-Yang/DSH-Test-Plugin#v0.17.0
```

标签安装需要对应标签已推送；若用户提供本地审核包，改用 `dsh plugin --profile web add /绝对路径/dsh-test-plugin-0.17.0.tgz` 并保留该包。不要在来源不可用时悄悄安装 `main` 或另一版本，也不要使用 `allow-version` 绕过支持检查。

需要更换已有插件来源时，按[安装与运维](安装与运维.md#从-github-安装与卸载)先在同一 profile 移除旧依赖再添加；停服状态下完成整个替换。插件 bundle 会注册 `harness-test`，不要额外插入第二个实例。从已构建的 DSH 源码运行时，将本文的 `dsh` 换成该环境实际使用的 `pnpm dsh`。

## 安装 MCP 和匹配浏览器

已有 **专用且兼容** 的 Playwright MCP 时，核对版本、路径和匹配浏览器后复用。否则在选定的长期目录执行：

```sh
mkdir -p /绝对路径/dsh-browser-tools
cd /绝对路径/dsh-browser-tools
npm install --save-exact @playwright/mcp@0.0.68
node node_modules/@playwright/mcp/cli.js --version
```

预期版本为 `0.0.68`。接着在同一目录运行：

```sh
node --input-type=commonjs <<'NODE'
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const mcpRequire = createRequire(require.resolve('@playwright/mcp/package.json'));
const cli = join(dirname(mcpRequire.resolve('playwright/package.json')), 'cli.js');
const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
NODE
```

此命令只借助 MCP 自身的 Playwright CLI 安装浏览器，运行测试时仍通过 MCP。不能用不带版本的 `npx playwright install` 代替。Linux 缺系统库时，把同一脚本的参数改为 `['install', '--with-deps', 'chromium']`；有实际权限限制时说明未完成的依赖。浏览器安装与 DSH 运行使用同一用户及相同的 `PLAYWRIGHT_BROWSERS_PATH`（如有设置）。

## 合并 DSH 配置并启动

将以下内容合并到目标 profile 的 `cordis.patch.yml`。已有相同 ID 的条目时更新原条目，并保留其其他配置；已有 `serverName: playwright` 的专用兼容 MCP 时复用它。DSH patch 替换目标条目的整个 `config`，所以不能用示例覆盖原有完整配置。

```yaml
- id: tools
  config:
    mode: native
- id: agent-loop
  config:
    maxParallelToolCalls: 1
- id: harness-test
  config:
    workspace: /绝对路径/DSH-Testing
    outputRoot: /绝对路径/DSH-Testing/artifacts/runs
- insert:
    - id: test-playwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: playwright
        transport: stdio
        command: node
        args: ['/绝对路径/dsh-browser-tools/node_modules/@playwright/mcp/cli.js', '--headless', '--browser', 'chromium', '--isolated']
        toolCallTimeoutMs: 60000
        failOnStartupError: true
```

`command` 可改为实际 Node.js 可执行文件的绝对路径。`serverName: playwright` 不可随意改名，插件需要 `mcp__playwright__` 前缀；配置条目 ID 则可以沿用已有值。MCP 由 DSH 启停，不需要额外启动 HTTP 服务，也不需要把上述配置写入安装 Agent 自己的 MCP 设置。

保持安装时的 `DSH_HOME`，用 `dsh web` 启动默认 profile；自定义 profile 使用 `dsh --profile <名称>`，保留用户原有端口等参数。打开宿主输出的访问地址，在 DSH 添加并进入测试工作区的对话，确认模型可用。在 **设置 → 测试插件 → 浏览器设置**选择本机 Playwright，关闭可选预览和录像并保存；工具目录应提供 `mcp__playwright__browser_navigate`、`mcp__playwright__browser_evaluate`、`mcp__playwright__browser_close` 等工具。

没有模型凭据时，引导用户在 DSH 内配置，完成后继续业务验收；不要求用户在聊天中粘贴密钥。模型未就绪、工具不可见或启动报错时，不能把“插件安装命令成功”写成完整验收通过。

## 验收安装结果

在 DSH 宿主启动一个只用于验收的固定页面服务。以下使用端口 8765；被占用时选择其他空闲端口并同步替换用例地址，不停止无关进程：

```sh
node --input-type=commonjs <<'NODE'
const http = require('node:http');
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DSH 安装验证</title><h1>DSH 安装验证</h1></html>');
}).listen(8765, '127.0.0.1');
NODE
```

让服务保持运行，然后在 **目标 DSH 对话**提交以下命令，而非在 shell 或安装 Agent 自己的浏览器中执行：

```text
/test 访问 http://127.0.0.1:8765，断言页面存在标题“DSH 安装验证”
```

核对以下结果：

- 目标 profile 中实际加载插件 **0.17.0**，专用 MCP 版本为 **0.0.68**；不能只检查下载目录或安装命令的退出码。
- DSH 展示插件计划、实际执行进度和报告，真实页面采集的标题断言通过；另一个 Agent 打开页面或普通聊天声称通过不算插件验收。
- 报告 HTML 可打开，记录及证据在约定的 `outputRoot`；浏览器已关闭，Agent 空闲、测试作用域关闭、在途工具归零。关闭本次自行启动的页面服务。

如果安装 Agent 只能使用终端，完成命令、配置和启动检查后，向用户提供上述 DSH 用例及待核对项，明确记录“网页测试尚未验证”。后续由具备 DSH UI 操作能力的 Agent 或用户继续。

## 交付安装结果

向用户列出实际 Node.js、pnpm、DSH、插件、MCP 和浏览器版本，目标 home/profile、工具目录、工作区、报告目录，配置变更及备份位置，可复用的启动命令，以及首条测试的报告路径和收尾状态。逐项区分已完成、失败和未验证；缺少的凭据、权限或操作能力对应到具体剩余步骤。

环境就绪后，可继续使用 `/test-plan` 审核任务，或将 TXT／Markdown 用例和 CSV 参数放入当前对话工作区，再按[使用说明](../user-guide/使用说明.md)运行。需要画面或录像时，另按[预览配置](../user-guide/浏览器实时预览一步一步配置.md)安装 Browscreen。
