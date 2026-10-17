# DSH多版本验证

[安装与运维](安装与运维.md) · [方案](../design/DSH多版本兼容方案.md) · [0.13.0 验收](../project/0.13.0多版本兼容验收.md)

插件 0.13.0 候选的同一个包声明支持 DSH `0.2.1-alpha.1`、`0.2.1-alpha.2`、`0.2.1-alpha.3`。开发与构建 SDK 固定 alpha.3。Node.js 最低 22.19，Web、native 工具模式、单批并发 1；其他 alpha、rc、正式版不自动纳入。

当前必要真实验收受模型额度限制，尚未创建正式标签；已通过项目和剩余工作见[验收状态](../project/0.13.0多版本兼容验收.md)。

## 维护支持集合

`dsh-compatibility.json` 保存 `buildSdk` 与 `supportedHosts`。全部 22 个 DSH peer 使用精确版本的联合范围，optional 属性保留；CI 从同一策略输出矩阵。不能以升级开发 SDK 为理由自动删掉旧宿主。

```sh
pnpm compat:check
# 修改策略后显式同步 peer，再核对开发 SDK 与锁文件。
pnpm compat:sync
pnpm verify:package
```

构建与检查不静默改写清单。策略随包发行，解包后仍可核对支持集合。三个宿主的门禁读取 peer，不能仅设置 `engines.dsh`。此策略文件也不是 profile 内的 `compatibility.json`：后者用于版本豁免，正式验收禁止存在该文件。

## 确定性宿主矩阵

`.github/workflows/ci.yml` 在干净公开依赖下完成冻结安装、类型、回归、重建 `dist` 一致性及真实入口导入，只打包一次。三个宿主作业下载同一候选文件及 SHA-256，最终汇总门禁要求构建和全部宿主成功。

本机复用同一驱动。准备官方源码仓库及三个 `dsh-v0.2.1-alpha.N` 标签；驱动只用 `git show` 读取发布清单，不构建或链接宿主源码。先安装验证脚本与 MCP 各自匹配的 Chromium：

```sh
pnpm install --frozen-lockfile
node scripts/install-browser.mjs
pnpm build
pnpm pack --out artifacts/package/dsh-test-plugin.tgz
export DSH_CANDIDATE_SHA256=$(shasum -a 256 artifacts/package/dsh-test-plugin.tgz | cut -d ' ' -f 1)
pnpm compat:host 0.2.1-alpha.1 artifacts/package/dsh-test-plugin.tgz /绝对路径/deepseek-harness /绝对路径/新目录/alpha1
pnpm compat:host 0.2.1-alpha.2 artifacts/package/dsh-test-plugin.tgz /绝对路径/deepseek-harness /绝对路径/新目录/alpha2
pnpm compat:host 0.2.1-alpha.3 artifacts/package/dsh-test-plugin.tgz /绝对路径/deepseek-harness /绝对路径/新目录/alpha3
```

每个输出目录必须不存在。驱动为每版建立两个独立公开 npm 安装：

- `public/` 保留普通 `npm install @deepseek-ai/dsh@精确版本` 的实际解析，不使用 overrides；用实际 CLI 安装 tgz、启动 Web 并验证插件页和认证。
- `cohort/` 从官方发布标签提取公开包版本，约束为同批 SDK 及 Cordis／Schemastery；核对真实依赖后运行目标 SDK 的类型和完整回归，验证 CLI 安装、真实 Web 偏好保存、停服后编辑 MCP profile 配置、重启回读、停用／启用和卸载。

二者都有独立 `DSH_HOME` 与 profile；通过实际 `dsh plugin --profile web add <tgz> --ignore-scripts` 安装。profile 不得包含 DSH SDK 副本和版本豁免。门禁直接调用目标宿主的 `evaluatePluginCompatibility`，验证支持集合、范围外版本及畸形数据；另验证缺 SDK 的入口导入失败。缺宿主、标签、浏览器、用例或配置时失败，不输出绿色跳过。

完整回归中的 Agent 生命周期替身覆盖审核关闭、在途结算、未知隔离、重启恢复和释放约束；这层不能替代真实模型验收。`summary.json`、SDK 清单、两种安装锁文件、回归 JSON、Web 截图及停止证明分别保留。偏好通过实际设置页保存；MCP 的联合类型配置没有 Settings 表单，按用户指南停服编辑 profile，再通过 ConfigEditor 的实际运行值核对重启回读。`state.json` 和宿主日志可能含认证 URL，只保存在私有或忽略目录，CI 不上传它们。

## 受控真实模型与 GitLab

扩展支持集合和正式交付前，给三个宿主的同一命令提供本机配置。模型 patch 只读取 `llm-pi-ai`、`agent-default-model`；凭据复制到独立 home，均不进入包和 Git：

```sh
export DSH_MODEL_PATCH=/绝对路径/不提交的模型配置.yml
export DSH_MODEL_CREDENTIALS=/绝对路径/不提交的.credentials.yaml
# 使用上面的同一 tgz 和摘要，输出到新的三个目录。
```

受控模型验收统一使用步骤 600000 ms、收尾 180000 ms、取消宽限 500 ms，容纳多轮模型响应时延；生产默认预算不变，超时仍保留错误和隔离，不改判通过。驱动额外启动本地固定页面／JSON 夹具，使用真实模型和 Playwright MCP 完成 Markdown UI、关闭审核后修改与重新批准、同会话接口正向、新会话固定反例、CSV 多实例、普通聊天恢复、审核取消及接口在途停止。实际值由夹具固定为 101；反例和 CSV 的错误预期固定为 100，不根据响应改写预期。每轮检查认证 HTML、账本重放、证据 SHA、原会话清理；继续前等待实际 Agent 空闲、测试作用域关闭、在途工具归零。只读探针仅加载在独立验收 profile，不进入发行包。

GitLab 正式回归继续使用[既有流程](../user-guide/GitLab复杂用例.md)，从 `.local/gitlab/config.json` 准备本轮专用项目，执行生成的 Markdown UI 和接口文件，固定业务预期，保留私有原始输入并清理本轮项目。可在每版运行前执行 `pnpm gitlab:prepare`，将生成的 `state.json` 完整路径设为 `DSH_GITLAB_STATE` 后运行矩阵驱动，驱动会复制私有 Markdown 并检查 3 条接口和 2 条 UI 用例；每版必须使用独立准备记录，完成后按原记录 `pnpm gitlab:cleanup --state <路径>` 清理并核对 404。这里的本地夹具不能代替 GitLab、RunBridge 实机或 Browscreen 录像的对应验收。

## 旧宿主用户

alpha.1～3 使用同一个 `v0.13.0` 包、安装地址及配置。维护者审核并手动推送本地标签后：

```sh
dsh plugin --profile web add github:Pegasus-Yang/DSH-Test-Plugin#v0.13.0
```

推送前使用本地 tgz；更换来源前正常停服、移除旧依赖后添加，保留工作区、输出和偏好。重启同一 profile 并刷新浏览器，核对实际版本。不需要版本豁免或专门的 alpha.1／alpha.2 插件变体。

不在支持集合内的宿主使用原已验证组合，或先完成新基线验证。历史 `v0.12.1` 声明 alpha.1，`v0.12.2`／`v0.12.3` 声明 alpha.3；这三个历史标签均未声明 alpha.2。未来提高下限时，须记录受影响接口、最后兼容标签与迁移方式，并经用户审核。插件 latest 和宿主 latest 分别维护，不能据此推测二者匹配。

本地提交和附注标签验收完成后不自动推送；GitHub Actions 实际运行、远端标签目标及固定 Git 标签安装在用户推送后另行核对。
