# 在自己的电脑上搭建 GitLab，体验测试与本地调试

[项目首页](../../README.md) · [文档导航](../README.md) · [GitLab 用例操作指南](../user-guide/GitLab复杂用例.md)

本文适用于插件 0.11.2。按顺序完成后，你会有一个只供本机测试的 GitLab，以及可以复制到 DSH 对话运行的 Markdown 用例。所有账号、展开后的用例、服务数据和报告都留在本机，不需要提交到 Git。

已有可用 GitLab 的读者，可以从[准备测试账号](#4-准备一个专用测试账号)开始；已有账号和本地配置的读者，可以直接看[准备数据并生成用例](#7-准备数据并生成用例)。

## 1. 先认识这套环境

| 名称 | 把它理解成什么 | 本次负责什么 |
| --- | --- | --- |
| GitLab | 被测网站 | 提供登录、项目、Issue、筛选和接口 |
| DSH | 与模型对话的应用 | 接收测试命令，展示计划、工具调用、审批和结果 |
| DSH Test Plugin | DSH 中的测试功能 | 保存用例、执行检查、显示进度、生成报告和手工用例 |
| 专用 Playwright MCP | 测试浏览器的操作者 | 按当前对话的分析打开网页、点击和输入 |
| Browscreen | 浏览器画面的采集器 | 可选的实时浮窗和 MP4 录像 |
| 插件源码中的 GitLab 脚本 | 测试数据的准备员 | 读本机账号，创建专用项目，生成用例，最后清理 |

GitLab 的 Docker 镜像已经包含数据库、缓存和仓库服务。这套 Issue 测试不需要另外启动数据库、GitLab Runner、流水线或邮件服务。DSH、MCP、Browscreen 和准备脚本都在宿主机运行；本文中的 `127.0.0.1` 指这台电脑。若把它们放进不同容器或远程机器，应先统一可达地址，不能直接照抄本机地址。

### 用例可以体验哪些功能

五条用户用例由两个 Markdown 模板生成。每条都写有名称、原始任务、前置条件、操作/预期表格及收尾；通过 `/test-run` 让当前模型结合实际页面执行。

| 场景 | 实际操作与检查 | 适合观察的插件功能 |
| --- | --- | --- |
| UI：组合筛选 | 登录，选择 Closed 和 dsh-smoke，确认唯一结果，打开详情，再独立 GET 核对身份、状态和标签 | 页面分析、多步操作、DOM 与接口交叉检查、实际步骤 |
| UI：草稿预览取消 | 输入 Markdown 草稿，看预览，取消并返回列表，通过接口确认草稿没有创建 | 中文输入、编辑器切换、异步渲染、取消与持久化核对 |
| 接口：项目搜索 | 按本次专用名称查询，检查数量、ID、路径及 public 可见性 | 一个响应复用多个检查、实际值与固定预期 |
| 接口：分页 | 按创建顺序逐页读取 alpha、beta、gamma，第四页为空 | 多请求、数组字段、顺序与边界 |
| 接口：不存在的项目 | GET 本次标记下未创建的项目 | 404 负向业务检查；预期 404 时可以正常通过 |

完整开发回归另包含创建项目、Issue 编辑、评论、关闭/重开、详情、搜索、标签和错误响应等场景，见[开发者回归说明](../reference/开发者JSON用例与调试.md#gitlab-完整开发回归场景)。它与五条用户用例共用准备脚本，但不是同一批运行，也不代表这些场景都在最近一次验收中通过。

## 2. 准备电脑和源码

需要 Docker Engine 与 Docker Compose，或已经启动的 Docker Desktop；需要 Node.js **22.19+**、pnpm **11.7.0**。DSH 需已安装、配置可用模型，并启用本插件；适配版本为 DSH **0.2.1-alpha.1**。Browscreen 只在需要预览或录像时安装。

本文终端命令与 600/700 文件权限按 macOS、Linux 编写，Windows 原生准备脚本流程尚未验收。使用 WSL 等环境时，DSH、浏览器和准备脚本保持在同一环境内，并重新核对 GitLab 地址是否可达。

GitLab 比普通演示网站更占资源。官方单节点基线是 8 vCPU、16 GB 内存；受限环境的说明从至少 8 GB 开始。Docker Desktop 分配的内存也要足够，同时给 DSH 和浏览器留出空间。磁盘空间及调优方法见 [GitLab 硬件要求](https://docs.gitlab.com/install/requirements/)。

打开**终端**，执行：

```sh
docker version
docker compose version
node --version
pnpm --version
```

`docker version` 应能显示服务端信息。只有客户端版本或出现“无法连接 Docker daemon”时，先打开 Docker Desktop，等待它完成启动。

克隆**包含当前用例的插件源码**，进入根目录：

```sh
git clone https://github.com/Pegasus-Yang/DSH-Test-Plugin.git
cd DSH-Test-Plugin
pnpm install --frozen-lockfile
pnpm build
node scripts/install-browser.mjs
```

最后一条安装本项目准备脚本和专用 MCP 各自需要的 Chromium。安装到 DSH 的插件包只提供运行功能；`gitlab:prepare` 等数据脚本在源码仓库中，所以体验这套样例仍需要源码。后续标注“插件根目录”的命令，均在有 `package.json` 的这个目录执行。

## 3. 启动本机 GitLab

### 3.1 放好配置

仓库提供[Docker Compose 模板](../../examples/gitlab/docker-compose.yml)，固定为本地用例基线 `gitlab/gitlab-ce:19.4.1-ce.0`。不要使用 `latest` 做可重复验收；更换 GitLab 版本后需重新核对页面入口、筛选和编辑器行为。安装方式参考 [GitLab 官方 Docker 指南](https://docs.gitlab.com/install/docker/installation/)。

**首次搭建**时，在插件根目录执行：

```sh
mkdir -p .local/gitlab/server/config .local/gitlab/server/logs
chmod 700 .local/gitlab .local/gitlab/server
cp examples/gitlab/docker-compose.yml .local/gitlab/server/compose.yaml
cd .local/gitlab/server
docker compose config --quiet
docker compose up -d
```

如果 `compose.yaml` 已经存在，不重复复制覆盖；编辑现有文件，然后从该目录运行 Compose。首次启动会下载镜像并初始化数据，登录页暂时出现 502 不一定是插件故障。

模板的关键配置：

| 配置 | 值及用途 |
| --- | --- |
| 项目名 | dsh-gitlab-demo，区分其他 Compose 项目 |
| 网页 | http://127.0.0.1:8929，只映射到本机回环地址 |
| SSH | 127.0.0.1:2424 → 容器 22；这些 UI/GET 用例不使用 SSH |
| external_url | http://127.0.0.1:8929，与浏览器及本机配置保持一致 |
| 共享内存 | 256m |
| 配置/日志 | 当前目录的 config/、logs/，整个目录位于被忽略的 .local/ |
| 业务数据 | Docker 命名卷 gitlab-data，Compose 通常命名为 dsh-gitlab-demo_gitlab-data |

macOS 上不要把 `/var/opt/gitlab` 改成 `./data` 的目录挂载。本地曾遇到 Gitaly 要求的 Linux 权限无法保留、容器反复重启；数据卷方式已解决该问题。配置和日志仍可通过本机目录管理。

若 8929 已占用，先确定是不是已经启动了 GitLab：可用时复用；另搭一套时，同时修改 `external_url`、网页映射的宿主和容器端口、后面的 `sign_in_url` 及示例地址。Compose 项目名和 2424 端口也要避免冲突。不要只改端口映射。

### 3.2 等它真正就绪

仍在 `.local/gitlab/server` 目录执行：

```sh
docker compose ps
docker compose logs --tail 80 gitlab
docker compose exec gitlab curl -fsS 'http://127.0.0.1:8929/-/readiness?all=1'
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8929/users/sign_in
```

应看到容器健康、readiness 各依赖检查为 `ok`，登录页返回 `200`。readiness 请求放在容器内部执行，避免本机健康端点的 IP 白名单影响判断；`all=1` 会检查数据库、Redis、Gitaly 等依赖，见[官方健康检查说明](https://docs.gitlab.com/administration/monitoring/health_check/#readiness)。

再用普通浏览器打开 <http://127.0.0.1:8929/users/sign_in>。能看到用户名、密码输入框和 Sign in 按钮，才继续。端口在监听并不等于 Rails、数据库和仓库服务已经可用。

## 4. 准备一个专用测试账号

首次启动时，在 GitLab 服务目录查看随机生成的管理员密码：

```sh
docker compose exec gitlab grep 'Password:' /etc/gitlab/initial_root_password
```

管理员用户名是 `root`。在本机登录并修改初始密码；这个文件会在超过 24 小时后的首次容器重启中删除。没有该文件但以前已经登录过时，使用自己保存的新密码，不重新初始化已有数据卷。

用管理员进入 **Admin → Overview → Users**，创建一个普通专用测试用户，例如 `dsh_demo_user`；填写测试邮箱，按本机管理界面完成确认、设定密码和首次登录。无邮件服务时，由管理员确认账号并设置密码，不依赖邮件中的链接。菜单及账号操作参考 [GitLab 用户管理](https://docs.gitlab.com/administration/admin_area/#administering-users)。

然后退出管理员，用**测试账号**手工登录一次，检查：

1. 能正常进入 GitLab，已经完成首次改密或条款确认。
2. 个人命名空间中能新建项目，项目配额至少允许本轮的两个专用项目；开发创建场景还需要一个余量。
3. 实例允许该账号创建 **Public** 项目，允许未登录用户读取这些项目的项目/Issue 接口。
4. 登录不要求脚本无法处理的二次认证或验证码；使用本地专用测试账号，不为运行样例改变其他用户的认证方式。
5. 建议界面语言选 English，以便对应 Closed、Label、Preview、Cancel 等示例文字；草稿仍会测试中文输入。Markdown 预览时选择纯文本编辑模式。入口见[个人偏好](https://docs.gitlab.com/user/profile/preferences/)。

项目公开是为了当前无认证 GET 的可信接口采集。准备内容只使用固定的虚构文本；不要把业务仓库或真实工作资料放入这两个测试项目。准备脚本通过登录 Cookie 和 CSRF 管理自己的测试数据，不需要把 `root` 密码或个人访问令牌交给插件。

## 5. 安装插件和配置测试浏览器

插件安装、启用及正常启动 DSH，按[README 快速开始](../../README.md#快速开始)。以下配置都属于**实际运行的同一 DSH profile**。

接口用例只需可用模型、启用的插件和 native 工具模式。UI 用例还需专用 Playwright MCP。已有名为 `playwright` 的专用 MCP 时复用，不重复注册；配置方式见[安装与运维](安装与运维.md#配置)。示例使用：

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

## 6. 把账号放到本机私有配置

回到**插件根目录**。不要在 `.local/gitlab/server` 中执行下一组命令。

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

这是**准备脚本的配置**，不是测试用例。`browser_channel` 可以为 `chrome` 或 `chromium`；选择 `chromium` 时使用第 2 节安装的浏览器，不依赖系统 Chrome。登录地址和后续页面/API 必须使用同一个主机及端口，避免账号绑定、Cookie 或清理归属核验不一致。

不要把真实账号写进 README、公开模板、CSV 或命令行。UI 文档由脚本从这份配置填充；运行输入快照、手工用例和录像可能保留真实输入，都应继续放在忽略的本机目录。

## 7. 准备数据并生成用例

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

## 8. 逐步运行 Markdown 用例

下面的命令输入 **DSH 对话框**，不是终端。用终端打印的真实目录替换“本次标记”；每次只运行一条命令，等待完成后再选下一条。

### 8.1 先做纯接口测试

```text
/test-run .local/gitlab/本次标记/api.md
```

报告应包含三个实例，检查状态码、项目身份、分页内容和预期 404。纯接口实例不调用 Playwright，没有实时浮窗、截图或录像占位。多个检查可以复用同一次 GET 响应；业务负向响应不自动代表失败，判断取决于原始预期。

### 8.2 再观察单个网页流程

```text
/test-run .local/gitlab/本次标记/ui_draft_cancel.md
```

草稿取消场景适合体验编辑器、Markdown 预览、实际操作拆分和独立接口核验。需要先审核文字计划时，使用：

```text
/test-plan --file .local/gitlab/本次标记/ui_filters.md
```

在原生审核卡片查看全文、要求修改或同意执行。批准前不会访问网页；批准后还可能出现工具审批。UI 用例会从文件中的本机输入登录，不需要在对话中再贴一次密码。

### 8.3 运行两条 UI 或完整合集

```text
/test-run .local/gitlab/本次标记/ui.md
/test-run .local/gitlab/本次标记/all.md
```

两条命令是**替代入口**，不要连着提交。先结束并清理前轮，再重新 `prepare`，选择新一轮的文件执行。复杂用例包含模型分析、审批、页面动作和检查，耗时不是固定值。

文件都在当前对话的工作区内时，相对路径与对应绝对路径均可用。复制到另一个私有测试目录后，要在那个目录的 DSH 对话运行；绝对路径也不能绕过工作区限制。格式规则及重复运行边界见[GitLab 用例操作指南](../user-guide/GitLab复杂用例.md)。

## 9. 体验 CSV 参数化与审核

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

一条模板 × 四行数据得到四个实例。先审核来源、参数、完整展开文字、步骤和预期，再批准执行；每例检查状态码和数组长度。占位值没有填写前不要提交。CSV 只做一次参数替换，字段说明及异常规则见[文件与参数化说明](../user-guide/使用说明.md#文件用例与-csv-参数化)。

这个分页模板补充参数化体验；不替代 `api.md` 中核对每页 IID、标题的完整业务检查。

## 10. 看进度、画面、录像和报告

| 想看什么 | 操作及成功信号 |
| --- | --- |
| 原始任务如何拆分 | 阅读当前对话的计划通报；/test-plan 在执行前展示审核卡片 |
| 现在做到哪一步 | 看输入框上方的当前操作、实例位置、已结算数量和耗时；展开完整步骤，点击条目看全文 |
| 无头浏览器画面 | 按[预览配置](../user-guide/浏览器实时预览一步一步配置.md)安装 Browscreen 并保存启用设置；当前页面 CDP 与有效首帧就绪后出现单个浮窗 |
| 操作录像 | 独立勾选录像开关，安装 browscreen[video]；测试结束在对应 UI 实例的“操作录像”播放或下载 |
| 实际操作和手工用例 | 报告选择实例，查看按序号保存的操作说明；下载 Markdown 手工用例，不把本轮执行结果当作下一次执行模板 |
| 为什么通过或失败 | 打开断言，核对可信实际值、原始预期、比较结果及证据；看整体状态和收尾，不能只数业务 PASS |
| 离线资料 | 复制完整运行目录，保留手工文件、账本、证据和 MP4；只复制 HTML 不能保留所有独立下载 |

Browscreen 的 Python 及视频依赖、版本范围和设置详见[录像安装说明](../user-guide/浏览器录像与报告.md)。不需要自己提前启动采集服务，也不用在任务中写“显示画面”或“开始录制”。录像默认关闭，隐藏浮窗不会关闭已经启用的录像。接口实例始终没有浏览器媒体区域。

业务全部通过但必要收尾失败时，整体仍可为 ERROR。按钮“已结算”也不是通过率。最近一次五条 Markdown 用例的真实结果及未验证边界见[Markdown 用户入口验收](../project/Markdown用户入口验收.md)：接口三例通过；草稿取消通过；筛选九项业务检查通过但收尾为 ERROR，最终模板与规划自动提醒仍有真实宿主复测边界。不要将文档示例理解成所有模型、所有版本都已经通过。

## 11. 修改插件后怎样本地调试

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

源码版宿主在其根目录用 `pnpm dsh` 替代 `dsh`。自定义 `DSH_HOME` 时，安装和启动保持一致；建议按[隔离开发环境](安装与运维.md#隔离开发环境)使用独立目录和空闲端口，保留日常 profile。保留 `file:` 安装引用的 tgz；同路径同版本更新也要 remove/add，不能只凭“已经最新”判断新代码已经加载。

普通开发使用公开 SDK；只有调试未发布的宿主改动才使用 `link-host`。新包加载后，用新的准备数据重跑相关 GitLab 场景，保留原 FAIL/ERROR 和原始报告。构建、单元测试、真实网页验收是不同层面的验证。

## 12. 分别清理浏览器、测试项目和服务

### 浏览器环境

正常结束时插件自动释放浏览器，不另列“关闭浏览器”的业务步骤。停止按钮只中止本次运行，等待在途工具结算和收尾。新测试提示环境未释放时，到 **设置 → 测试插件 → 测试环境**，核对旧动作停止后按提示处置，再重新执行，见[环境恢复指南](../user-guide/测试环境卡住怎么办.md)。

### 专用 GitLab 项目

确认 DSH 已结束、旧页面动作停止后，在**插件根目录终端**执行：

```sh
pnpm gitlab:cleanup
```

它默认只清理最近一次。清理较早的一轮时明确指定准备记录：

```sh
pnpm gitlab:cleanup --state ".local/gitlab/本次标记/state.json"
```

脚本核对账号、命名空间、精确路径和标记，仅删除本轮专用项目，并用登录会话重新 GET 确认 404。部分版本延迟删除时，按已核验的本轮资源请求永久删除；失败会保留记录，不遍历删除其他业务项目。详细规则和残留处理见[用例清理](../user-guide/GitLab复杂用例.md#7-清理本次专用项目)。

清理不删除本机用例和报告。浏览器环境释放也不会删除 GitLab 项目，项目清理不会替你释放仍在运行的浏览器。

### GitLab 服务

不再使用时，在 `.local/gitlab/server` 目录执行：

```sh
docker compose stop
```

下次 `docker compose up -d` 会继续使用数据。`docker compose down -v` 会删除业务数据卷，不能当作普通停机或单轮用例清理命令。需要备份时，同时保留配置、数据和恢复方法，按[官方备份说明](https://docs.gitlab.com/install/docker/backup/)处理；复制 Compose 文件并不等于备份项目数据。

## 13. 出问题先查这里

| 现象 | 先检查什么 | 下一步 |
| --- | --- | --- |
| Docker daemon 无法连接 | Docker Desktop 是否启动 | 等待 Docker 可用后再执行 Compose |
| 端口被占用 | 已有 GitLab 或其他进程是否使用 8929/2424 | 复用已有实例，或同步修改 Compose 和本机登录地址 |
| 启动后 502、页面很慢 | 日志、readiness、Docker CPU/内存/磁盘 | 等待初始化；若反复重启，处理资源或明确日志错误，不只反复重发测试 |
| Gitaly 要求 2770 权限 | /var/opt/gitlab 是否被改成本机目录挂载 | 使用模板的数据卷；已有数据先备份迁移，不直接删除数据目录 |
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

其他安装、升级、预览、报告与异常环境问题见[常见问题速查](常见问题速查与处理.md)。
