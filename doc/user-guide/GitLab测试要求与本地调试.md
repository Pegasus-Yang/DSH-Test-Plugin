# GitLab 测试要求、用例体验与插件本地调试

[项目首页](../../README.md) · [文档导航](../README.md) · [GitLab 用例操作指南](GitLab复杂用例.md)

本文适用于插件 0.11.2，说明使用 GitLab 作为被测系统时需要满足的条件，以及本插件的配置、用例运行和本地调试方法。

GitLab 的安装、启动、配置及服务维护请查阅 [GitLab 官方 Docker 文档](https://docs.gitlab.com/install/docker/)。本项目不提供 GitLab 部署教程或部署模板。准备好可用的 GitLab 后，再按本文配置测试账号和用例。

## 1. 各部分负责什么

| 名称 | 在测试中的职责 |
| --- | --- |
| GitLab | 被测系统，提供登录、项目、Issue、标签、筛选和接口 |
| DSH 与测试插件 | 接收任务，展示规划、审批、进度、实际步骤、断言和报告 |
| 专用 Playwright MCP | 在 UI 测试中操作浏览器 |
| Browscreen | 按设置采集实际浏览器的实时画面和录像 |
| 插件源码中的 GitLab 脚本 | 读取私有账号配置，准备专用数据、生成用例，最后清理本轮项目 |

准备脚本的浏览器与 DSH 的测试浏览器分别运行。接口测试由插件独立发送无认证 GET，不借用 UI 登录 Cookie。准备/清理脚本的写请求只用于管理测试数据，不表示插件已经支持这些写接口的可信测试。

## 2. GitLab 与测试账号需要满足哪些条件

### 被测系统

| 条件 | 要求与原因 |
| --- | --- |
| 访问地址 | DSH 宿主、测试浏览器和准备脚本都能访问同一个 GitLab 地址；登录地址为 http(s)://主机:端口/users/sign_in |
| 登录方式 | 支持用户名和密码登录，测试账号已确认、处于可用状态，已完成首次改密或条款确认；准备脚本不处理验证码和二次认证 |
| REST API | /api/v4 可访问，相关接口返回 JSON；模型与页面操作不能代替可信接口采集 |
| 项目可见性 | 允许专用账号创建 Public 项目，且未登录请求可以读取这些项目及其 Issue；当前接口用例使用无认证 GET |
| Issue 与标签 | 专用项目能使用 Issue、评论、状态流转及项目标签；工作项列表、新建 Issue 和 Markdown 预览可用 |
| 页面版本 | 已验收基线为 GitLab CE 19.4.1；当前模板使用 /-/work_items 入口，更换版本后需核对页面和接口行为 |

本文的 `http://127.0.0.1:8929` 只是测试地址示例。使用自己实际可达的地址；浏览器与脚本处于不同机器或环境时，先确认各自可以访问它。账号配置与准备记录中的地址必须一致。

公开项目只放脚本生成的固定虚构文本，不使用业务仓库和工作资料。若实例禁止匿名读取 Public 项目，当前这套接口用例不能按原方式运行；仅让用户在 UI 登录并不能给接口采集自动增加认证。

### 专用测试用户及权限

请自行创建一个普通专用测试用户，把它的真实账号保存在本机私有配置中。运行这套样例不要求使用 GitLab 实例管理员账号。权限条件如下：

| 阶段 | 该用户需要的能力 | 脚本或用例会做什么 |
| --- | --- | --- |
| 登录 | 正常登录并读取自己的用户信息 | 准备脚本登录后通过 /api/v4/user 验证会话 |
| 准备项目 | 有自己的个人命名空间，允许创建 Public 项目；至少有两个项目的可用配额 | 每轮新建一个接口项目和一个 UI 项目；完整开发回归的创建场景另需一个项目余量 |
| 准备数据 | 在自己创建的项目中创建和管理 Issue、项目标签、评论，关闭 Issue | 为每个项目写入三条固定 Issue、两种标签和固定评论 |
| UI 运行 | 读取项目、筛选 Issue、打开详情、使用新建 Issue 编辑器及 Markdown 预览 | 两条用户 UI 用例分别检查组合筛选、草稿预览与取消；完整开发回归还会编辑、评论、关闭/重开及修改项目设置 |
| 清理 | 对本轮项目具有 Owner 级管理/删除权限，且实例策略允许执行对应删除 | 删除前核对归属、路径和标记；删除后以同一登录会话 GET 确认 404 |

本套脚本只在该账号的**个人命名空间**创建专用项目，不支持直接指定其他人或某个组的现有项目。使用自己创建的个人项目满足所需的项目归属和管理条件；单独给用户某个组的 Maintainer 权限，不能替代这些条件。GitLab 的项目删除权限见[官方角色权限表](https://docs.gitlab.com/user/permissions/)与[项目删除接口](https://docs.gitlab.com/api/projects/#delete-a-project)。

部分 GitLab 版本会先标记项目延迟删除。自动清理完整收尾还需要实例允许项目 Owner 对已标记的专用项目立即删除。实例策略或托管类型不允许时，脚本会报错并保留准备记录；交由该实例管理人员按 GitLab 规则处理，不修改本项目的归属校验来绕过限制。

准备、生成与清理配置使用同一账号、同一实例及同一准备记录，UI 运行沿用该账号；接口用例保持匿名读取。清理脚本不接受换成另一个管理员账户代替原账号；账号或实例变更后重新准备数据。建议使用英文界面以便对应 Closed、Label、Preview、Cancel 等用例文字；准备脚本的登录定位支持英文和简体中文。

## 3. 准备插件与数据脚本

需要 Node.js **22.19+**、pnpm **11.7.0**，以及已配置可用模型并启用本插件的 DSH **0.2.1-alpha.1**。UI 用例需要专用 Playwright MCP；Browscreen 只在需要预览或录像时安装。

在终端克隆包含当前用例的插件源码，进入根目录：

```sh
git clone https://github.com/Pegasus-Yang/DSH-Test-Plugin.git
cd DSH-Test-Plugin
pnpm install --frozen-lockfile
pnpm build
node scripts/install-browser.mjs
```

最后一条安装本项目准备脚本和专用 MCP 各自需要的 Chromium。安装到 DSH 的插件包提供运行功能；数据准备脚本在源码仓库中，使用这些样例仍需要源码。后续“插件根目录”指有 `package.json` 的这个目录。

本文终端命令与 600/700 文件权限按 macOS、Linux 编写，Windows 原生准备脚本流程尚未验收。运行环境不同也要保持 GitLab 地址可达。

## 4. 安装插件和配置测试浏览器

插件安装、启用及正常启动 DSH，按[README 快速开始](../../README.md#快速开始)。以下配置都属于**实际运行的同一 DSH profile**。

接口用例只需可用模型、启用的插件和 native 工具模式。UI 用例还需专用 Playwright MCP。已有名为 `playwright` 的专用 MCP 时复用，不重复注册；配置方式见[安装与运维](../deployment/安装与运维.md#配置)。示例使用：

```yaml
- id: tools
  config:
    mode: native
- id: agent-loop
  config:
    maxParallelToolCalls: 1
- id: harness-test
  config:
    workspace: /绝对路径/DSH-Test-Plugin
    outputRoot: /绝对路径/DSH-Test-Plugin/artifacts/runs
    stepTimeoutMs: 300000
- insert:
    - id: test-playwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: playwright
        transport: stdio
        command: pnpm
        args: ['dlx', '@playwright/mcp@0.0.68', '--headless', '--browser', 'chromium', '--isolated']
        toolCallTimeoutMs: 60000
        failOnStartupError: true
```

替换两个绝对路径；在 profile 的 patch 中更新已有条目，不重复插入 `harness-test`。正常停止旧 DSH 服务，再启动同一 profile 并刷新页面。浏览器测试串行执行，不在其他对话里共享操作这个 MCP 浏览器。

在 DSH 添加**插件源码根目录**为工作区，并在这个工作区里新建对话。这样 `.local/gitlab/` 中的文件和 `examples/gitlab/` 中的模板都位于同一个输入边界。文件路径由发起命令的对话决定，只改插件 `workspace` 不能把已有其他工作区的对话移过来。

先在**DSH 对话框**发送下面的简单测试，不需要账号，也不修改数据：

```text
/test 访问 http://127.0.0.1:8929/users/sign_in，断言页面存在用户名输入框、密码输入框和 Sign in 登录按钮
```

它可以检查最基本的网页操作、可信采集、进度、实际步骤、报告及自动浏览器释放。需要先审核时，把 `/test` 换成 `/test-plan`。规划说明或命令记录只是开始信号，等待最终报告才知道结果。

## 5. 把账号放到本机私有配置

在**插件根目录**执行下一组命令。

```sh
mkdir -p .local/gitlab
cp examples/gitlab/config.example.json .local/gitlab/config.json
chmod 600 .local/gitlab/config.json
git check-ignore .local/gitlab/config.json
```

已有配置时直接编辑，不覆盖它。最后一条应输出文件路径，表示不会提交。用编辑器填写：

```json
{
  "sign_in_url": "http://127.0.0.1:8929/users/sign_in",
  "username": "<自己的测试用户名>",
  "password": "<自己的测试密码>",
  "browser_channel": "chromium"
}
```

这是**准备脚本的配置**，不是测试用例。`browser_channel` 可以为 `chrome` 或 `chromium`；选择 `chromium` 时使用第 3 节安装的浏览器，不依赖系统 Chrome。登录地址和后续页面/API 必须使用同一个主机及端口，避免账号绑定、Cookie 或清理归属核验不一致。

不要把真实账号写进 README、公开模板、CSV 或命令行。UI 文档由脚本从这份配置填充；运行输入快照、手工用例和录像可能保留真实输入，都应继续放在忽略的本机目录。

## 6. 准备数据并生成用例

在插件根目录的**终端**执行：

```sh
pnpm gitlab:prepare
```

脚本读取私有配置、登录并核对会话，然后创建两个带唯一 `dsh-gitlab-时间-随机值` 标记的公开项目：一个给接口场景，一个给 UI 场景。每个项目有下面三条固定 Issue：

| 顺序 | 标题 | 初始状态 | 标签 |
| --- | --- | --- | --- |
| 1 | DSH 检索 alpha Python测试开发 | opened | dsh-smoke |
| 2 | DSH 检索 beta Agent进度 | opened | dsh-regression |
| 3 | DSH 检索 gamma 已关闭 | closed | dsh-smoke |

alpha 另有一条固定评论。预期来自这些固定种子，准备记录中的 ID/IID 只负责找到本次资源，不从当前响应反推“应该得到什么”。

准备成功后，终端打印 `.md` 执行命令和准备记录路径。每次准备是新项目和新目录，不覆盖前次；默认 `latest.json` 只是指向最近的一次。

| 本次目录中的文件 | 用途 |
| --- | --- |
| api.md | 三条只读接口用例 |
| ui.md | 两条网页用例 |
| all.md | 上面五条的合集 |
| ui_filters.md、ui_draft_cancel.md | 单独运行一个 UI 场景 |
| api_project_search.md、api_pagination.md、api_missing_project.md | 单独运行一个接口场景 |
| state.json | 本次资源身份、准备状态和清理依据；不要删除或手改归属 |

准备浏览器只负责创建数据，完成后关闭；DSH 的浏览器与它是两个独立会话。公开的 [ui-cases.md](../../examples/gitlab/ui-cases.md) 与 [api-cases.md](../../examples/gitlab/api-cases.md) 仍有占位参数，不能直接拿来执行；使用本次生成的文件。

## 7. 逐步运行 Markdown 用例

下面的命令输入 **DSH 对话框**，不是终端。用终端打印的真实目录替换“本次标记”；每次只运行一条命令，等待完成后再选下一条。

### 7.1 先做纯接口测试

```text
/test-run .local/gitlab/本次标记/api.md
```

报告应包含三个实例，检查状态码、项目身份、分页内容和预期 404。纯接口实例不调用 Playwright，没有实时浮窗、截图或录像占位。多个检查可以复用同一次 GET 响应；业务负向响应不自动代表失败，判断取决于原始预期。

### 7.2 再观察单个网页流程

```text
/test-run .local/gitlab/本次标记/ui_draft_cancel.md
```

草稿取消场景适合体验编辑器、Markdown 预览、实际操作拆分和独立接口核验。需要先审核文字计划时，使用：

```text
/test-plan --file .local/gitlab/本次标记/ui_filters.md
```

在原生审核卡片查看全文、要求修改或同意执行。批准前不会访问网页；批准后还可能出现工具审批。UI 用例会从文件中的本机输入登录，不需要在对话中再贴一次密码。

### 7.3 运行两条 UI 或完整合集

```text
/test-run .local/gitlab/本次标记/ui.md
/test-run .local/gitlab/本次标记/all.md
```

两条命令是**替代入口**，不要连着提交。先结束并清理前轮，再重新 `prepare`，选择新一轮的文件执行。复杂用例包含模型分析、审批、页面动作和检查，耗时不是固定值。

文件都在当前对话的工作区内时，相对路径与对应绝对路径均可用。复制到另一个私有测试目录后，要在那个目录的 DSH 对话运行；绝对路径也不能绕过工作区限制。格式规则及重复运行边界见[GitLab 用例操作指南](GitLab复杂用例.md)。

## 8. 体验 CSV 参数化与审核

CSV 文件的完整写法、占位符、工作区和常见错误见[CSV 参数文件使用手册](CSV参数文件使用手册.md)。

分页项目只有三条固定 Issue，因此第 1、2、3 页各一条，第 4 页为零。用这个固定规则体验 `/test-data`，不需要任何账号字段。

在**插件根目录终端**复制 CSV 示例到本轮私有目录：

```sh
cp examples/gitlab/parameters.example.csv .local/gitlab/本次标记/pagination.csv
chmod 600 .local/gitlab/本次标记/pagination.csv
```

用编辑器打开本次 `api.md`：第一条项目搜索用例的预期里已经给出本次**接口项目 ID**。将 CSV 四行中的 `<本次接口项目ID>` 全部替换为这个数字，不能使用 UI 项目 ID；地址不是 8929 时同时替换 `base_url`。保留固定的 `page` 和 `expected_count`：

```csv
base_url,project_id,page,expected_count
http://127.0.0.1:8929,<本次接口项目ID>,1,1
http://127.0.0.1:8929,<本次接口项目ID>,2,1
http://127.0.0.1:8929,<本次接口项目ID>,3,1
http://127.0.0.1:8929,<本次接口项目ID>,4,0
```

然后在**DSH 对话框**执行：

```text
/test-data .local/gitlab/本次标记/pagination.csv --file examples/gitlab/pagination-parameterized.md
```

一条模板 × 四行数据得到四个实例。先审核来源、参数、完整展开文字、步骤和预期，再批准执行；每例检查状态码和数组长度。占位值没有填写前不要提交。CSV 只做一次参数替换，字段说明及异常规则见[文件与参数化说明](使用说明.md#文件用例与-csv-参数化)。

这个分页模板补充参数化体验；不替代 `api.md` 中核对每页 IID、标题的完整业务检查。

## 9. 看进度、画面、录像和报告

| 想看什么 | 操作及成功信号 |
| --- | --- |
| 原始任务如何拆分 | 阅读当前对话的计划通报；/test-plan 在执行前展示审核卡片 |
| 现在做到哪一步 | 看输入框上方的当前操作、实例位置、已结算数量和耗时；展开完整步骤，点击条目看全文 |
| 无头浏览器画面 | 按[预览配置](浏览器实时预览一步一步配置.md)安装 Browscreen 并保存启用设置；当前页面 CDP 与有效首帧就绪后出现单个浮窗 |
| 操作录像 | 独立勾选录像开关，安装 browscreen[video]；测试结束在对应 UI 实例的“操作录像”播放或下载 |
| 实际操作和手工用例 | 报告选择实例，查看按序号保存的操作说明；下载 Markdown 手工用例，不把本轮执行结果当作下一次执行模板 |
| 为什么通过或失败 | 打开断言，核对可信实际值、原始预期、比较结果及证据；看整体状态和收尾，不能只数业务 PASS |
| 离线资料 | 复制完整运行目录，保留手工文件、账本、证据和 MP4；只复制 HTML 不能保留所有独立下载 |

Browscreen 的 Python 及视频依赖、版本范围和设置详见[录像安装说明](浏览器录像与报告.md)。不需要自己提前启动采集服务，也不用在任务中写“显示画面”或“开始录制”。录像默认关闭，隐藏浮窗不会关闭已经启用的录像。接口实例始终没有浏览器媒体区域。

业务全部通过但必要收尾失败时，整体仍可为 ERROR。按钮“已结算”也不是通过率。最近一次五条 Markdown 用例的真实结果及未验证边界见[Markdown 用户入口验收](../project/Markdown用户入口验收.md)：接口三例通过；草稿取消通过；筛选九项业务检查通过但收尾为 ERROR，最终模板与规划自动提醒仍有真实宿主复测边界。不要将文档示例理解成所有模型、所有版本都已经通过。

## 10. 修改插件后怎样本地调试

不改源码只体验功能时，跳过这一节。修改插件后，在**插件根目录终端**运行相关验证和构建：

```sh
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:integration
pnpm pack --out artifacts/package/dsh-test-plugin.tgz
```

正常停止测试用 DSH 服务，用同一 profile 的公开 CLI 更新本地包，再启动并刷新：

```sh
dsh plugin --profile web remove dsh-test-plugin
dsh plugin --profile web add /绝对路径/DSH-Test-Plugin/artifacts/package/dsh-test-plugin.tgz
dsh web
```

源码版宿主在其根目录用 `pnpm dsh` 替代 `dsh`。自定义 `DSH_HOME` 时，安装和启动保持一致；建议按[隔离开发环境](../deployment/安装与运维.md#隔离开发环境)使用独立目录和空闲端口，保留日常 profile。保留 `file:` 安装引用的 tgz；同路径同版本更新也要 remove/add，不能只凭“已经最新”判断新代码已经加载。

普通开发使用公开 SDK；只有调试未发布的宿主改动才使用 `link-host`。新包加载后，用新的准备数据重跑相关 GitLab 场景，保留原 FAIL/ERROR 和原始报告。构建、单元测试、真实网页验收是不同层面的验证。

## 11. 清理浏览器环境和本轮测试项目

### 浏览器环境

正常结束时插件自动释放浏览器，不另列“关闭浏览器”的业务步骤。停止按钮只中止本次运行，等待在途工具结算和收尾。新测试提示环境未释放时，到 **设置 → 测试插件 → 测试环境**，核对旧动作停止后按提示处置，再重新执行，见[环境恢复指南](测试环境卡住怎么办.md)。

### 专用 GitLab 项目

确认 DSH 已结束、旧页面动作停止后，在**插件根目录终端**执行：

```sh
pnpm gitlab:cleanup
```

它默认只清理最近一次。清理较早的一轮时明确指定准备记录：

```sh
pnpm gitlab:cleanup --state ".local/gitlab/本次标记/state.json"
```

脚本核对账号、命名空间、精确路径和标记，仅删除本轮专用项目，并用登录会话重新 GET 确认 404。部分版本延迟删除时，按已核验的本轮资源请求永久删除；失败会保留记录，不遍历删除其他业务项目。详细规则和残留处理见[用例清理](GitLab复杂用例.md#7-清理本次专用项目)。

清理不删除本机用例和报告。浏览器环境释放也不会删除 GitLab 项目，项目清理不会替你释放仍在运行的浏览器。

## 12. 出问题先查这里

| 现象 | 先检查什么 | 下一步 |
| --- | --- | --- |
| 登录失败 | 在普通浏览器用专用账号能否登录，是否待确认或首次改密 | 完成账号准备并更新私有配置；二次认证/验证码不属于当前准备脚本能力 |
| 配置权限过宽 | config.json 权限 | chmod 600；保持配置和生成文件在当前源码的 .local/gitlab/ 内 |
| prepare 的 403/400 | 个人命名空间、Public 策略和项目配额 | 修正本地测试账号/实例条件；失败准备记录用于清理残留 |
| 浏览器缺失 | Chrome 或 Chromium 是否安装且配置匹配 | node scripts/install-browser.mjs；本机配置选择 chromium |
| Linux 提示缺少浏览器共享库 | Playwright 启动错误中的系统依赖说明 | 按错误提示安装对应系统依赖，再启动；下载 Chromium 不等于已经安装操作系统依赖 |
| 文件找不到或越界 | 命令发起的对话工作区、错误中的真实路径 | 进入插件根目录的对话；替换“本次标记”，不要提交占位命令 |
| HTTP 返回登录页 HTML | 地址、项目可见性、是否要求认证 | 当前接口用例是无认证 GET；核对匿名可读，不借用 UI Cookie |
| 只有文字规划，进度 0/0 | 是否提交有效计划，是否在等待问题或审核 | 回答原生追问或审核；普通未提交规划有一次提醒，再次未提交会明确结束，不当作运行成功 |
| 列表标题/数量或 Markdown 预览不正确 | 是否等待页面刷新、是否定位到主内容、是否使用纯文本编辑 | 保留失败；核对实际调用及证据，再修正定位或运行方式，不改固定预期凑 PASS |
| 原测试没有结束，新测试被阻止 | 进度及测试环境设置 | 先停止并按设置释放，再清理本轮项目和准备新数据 |
| cleanup 拒绝或项目仍存在 | 账号、实例、state 归属、延迟删除和服务健康 | 保留记录，用正确的 --state 重试；不编辑标记绕过归属检查 |

其他安装、升级、预览、报告与异常环境问题见[常见问题速查](../deployment/常见问题速查与处理.md)。
