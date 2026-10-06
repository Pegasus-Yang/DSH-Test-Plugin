# GitLab 复杂用例：配置、准备、运行与清理

这套用例用于在真实 GitLab 上检查插件的规划执行、真实操作记录、可信断言、报告和浏览器媒体，UI 场景按 GitLab 19.4.1 的 Work items 页面组织。共 17 条场景：4 条 UI、13 条纯接口，合计 100 个必需检查点。[场景表](../../examples/gitlab/README.md)列出了每条用例的动作和预期。

## 1. 先分清三个地方

| 地方 | 用途 |
| --- | --- |
| GitLab | 被测系统，需要已经启动，测试账号能够登录并在个人命名空间创建公开项目 |
| 插件源码项目的终端 | 读取本地配置、准备数据、生成 JSON 用例、清理专用项目 |
| 安装了插件的 DSH 对话 | 输入 /test-run，执行测试，查看进度、实际操作、断言和报告 |

准备脚本的 Playwright 只负责登录并准备/清理数据；它会自行关闭浏览器，不替代 DSH 的测试执行。UI 用例由当前 DSH 对话的 Playwright MCP 真正操作页面。接口检查由插件独立发送 GET，不借用准备脚本或 UI 的登录会话。

## 2. 安装准备脚本需要的依赖

打开终端，进入你克隆的插件源码项目根目录，执行：

```sh
pnpm install --frozen-lockfile
```

默认准备脚本使用本机 Chrome。没有 Chrome 时，可以安装 Playwright Chromium：

```sh
pnpm exec playwright install chromium
```

然后将下一节配置中的 browser_channel 改成 chromium。依赖未安装、浏览器缺失、配置缺失或账号登录失败时，脚本会提示对应的检查方式，不输出填表实参。

## 3. 把账号放进不会提交的本地配置

仍在项目根目录执行：

```sh
mkdir -p .local/gitlab
cp examples/gitlab/config.example.json .local/gitlab/config.json
chmod 600 .local/gitlab/config.json
```

如果配置已经存在，直接编辑原文件，避免覆盖自己的账号。用编辑器打开 .local/gitlab/config.json，把占位内容替换成你本机的实际账号：

```json
{
  "sign_in_url": "http://localhost:8929/users/sign_in",
  "username": "<你自己的测试用户名>",
  "password": "<你自己的测试密码>",
  "browser_channel": "chrome"
}
```

不要把真实账号写进 examples、README、CSV 或命令行。仓库已经忽略整个 .local/；可以自行核对：

```sh
git check-ignore .local/gitlab/config.json
```

应输出该配置文件路径。脚本要求配置和生成文件都在当前项目的 .local/gitlab/ 内，并拒绝宽于 600 的配置权限。配置不接受带账号、查询参数或片段的登录 URL。

## 4. 一次准备生成一套新数据

执行：

```sh
pnpm gitlab:prepare
```

脚本依次进行：

1. 从私有配置读账号密码，通过登录页登录，并验证登录会话。
2. 在当前账号个人命名空间新建两个公开专用项目，名称带 dsh-gitlab-时间-随机值 标记。
3. 为两个项目分别创建固定 Issue、标签、状态及评论。
4. 核对项目确实能匿名读取。
5. 在 .local/gitlab/本次标记/ 下保存准备记录和生成用例，文件权限 600。
6. 关闭准备浏览器，在终端打印可复制到 DSH 的命令。

两个公开项目只包含固定的虚构测试文本。需要公开读取，是因为当前插件可信 HTTP 采集支持无认证 GET JSON；用户名密码用于 UI 登录和准备脚本，不作为 GET 的认证方式。GitLab [项目 API](https://docs.gitlab.com/api/projects/)及[认证说明](https://docs.gitlab.com/api/rest/authentication/)可查阅相关规则。公开项目列表是否允许读取，也会受到本机实例策略影响。

本次目录包含：

| 文件 | 用途 |
| --- | --- |
| state.json | 刚创建的项目 ID、Issue IID、归属及清理标记 |
| api.json | 13 条纯接口场景 |
| ui.json | 4 条 UI 场景，包含独立接口核验 |
| all.json | UI 后接口的完整集合 |
| ui_issue_lifecycle.json | 单独执行 Issue 编辑、评论与状态流转 |
| ui_filters.json | 单独执行界面筛选 |
| ui_draft_cancel.json | 单独执行草稿预览和取消 |
| ui_project_create.json | 单独执行项目与 Issue 创建 |

展开的 UI JSON 内含实际登录输入，因此同样必须留在被忽略的私有目录。接口 JSON 不带密码；为保护响应中的账号身份，它登记账号为已知敏感值。插件在保存的计划、事件、操作输入、报告和手工用例文本中替换这些敏感值。执行输入会传给当前 Agent 与原生工具，原生会话记录也按含敏感输入的资料保管。浏览器截图和视频可能显示账号头像、名称或其他页面信息，原始媒体应保留本地，不直接提交或分享。

## 5. 到 DSH 对话执行

先确保 DSH 已安装并启用本插件，工具模式为 native；UI 测试还要启用命名为 playwright 的 Playwright MCP。

0.11.1 的文件命令使用发起对话的工作区。把生成文件所在目录添加到 DSH，在该工作区内新建或打开对话，再发送命令。若生成文件保存在插件项目的 .local/gitlab/ 下，选择插件项目根目录即可；复制到其他私有测试目录后，选择该目录的对话。绝对路径也不能越过当前对话的工作区边界。无 cwd 的历史会话才使用插件配置的 workspace。

终端打印的完整命令可以直接复制到 DSH 对话。形式如下（替换本次标记）：

```text
/test-run .local/gitlab/本次标记/api.json
/test-run .local/gitlab/本次标记/ui.json
/test-run .local/gitlab/本次标记/all.json
```

三条是不同运行入口，选择其中一条执行，不要同时发送。首次建议先执行 api.json 验证服务与报告，再用新数据执行 all.json。JSON 已冻结用例与预期，不需要模型重新设计集合；执行时仍参与当前对话的模型循环，按原生工具审批逐步执行。

要先观察一个复杂流程，可以只运行：

```text
/test-run .local/gitlab/本次标记/ui_issue_lifecycle.json
```

进度区会显示当前步骤、已结算步骤数和耗时；报告保存业务预期、可信实际值、操作说明及编号。浏览器实时预览和录像沿用独立设置：仅实际浏览器/CDP 就绪后出现；纯接口实例不产生浏览器调用，也不会显示空的媒体区域。配置见[浏览器录像与报告](浏览器录像与报告.md)。

UI 场景包含多个页面操作，如果原有每步预算太短，可在插件设置调整 stepTimeoutMs，例如 300000（5 分钟）。审批等待也计入实际耗时；增加预算不代表忽略卡住或失败。

## 6. 怎样重复运行

纯接口 api.json 只读，可以在保留基线项目时重复运行。UI 会编辑标题、增加评论、新建项目和 Issue，所以同一份 UI 用例用于一次回归；完整或部分运行后都先清理，再重新 prepare。

如果只改了本地账号配置、需要重建尚未执行的数据绑定：

```sh
pnpm gitlab:generate --state ".local/gitlab/本次标记/state.json"
```

generate 只重新读取配置和准备记录、生成文件，不登录，不修复 GitLab 业务数据，不从当前响应修改业务预期。换账号时不能继续使用原账号的专用项目，请重新准备。

每次 prepare 都创建新目录，旧记录保留。latest.json 只是“最近一次”的指针，不会让旧记录消失。

## 7. 清理本次专用项目

确认 DSH 运行已结束或停止、浏览器环境已释放，再在终端执行：

```sh
pnpm gitlab:cleanup
```

默认清理最近一次准备。清理较早的一次时，明确传入它的准备记录：

```sh
pnpm gitlab:cleanup --state ".local/gitlab/本次标记/state.json"
```

清理只处理本次两个专用项目，以及 UI 场景约定创建的那个项目。创建响应丢失时，仍按本次精确路径查找，找到后先保存 ID；删除前逐个核对账号、个人命名空间、路径和标记，不遍历删除已有业务项目。UI 创建中途失败、还没有设置描述时，只允许清理本次精确预留名称的空描述项目。检查与删除核对都使用登录会话，避免把“匿名不可见”误判成“不存在”；删除受理后重新 GET 确认 404。未确认删除时保留记录并报错，不把“点击删除”算作完成。本地用例、日志和报告不会被删除。

GitLab Self-Managed 新版本会先标记项目延迟删除。脚本检测到标记后再次核对本次归属和路径，使用 permanently_remove 与完整路径立即删除这些专用测试项目，再确认 GET 404；不修改整个实例的删除策略。GitLab.com 或 Dedicated 等不允许永久删除的环境会返回错误，记录保留，等待保留期结束后再次 cleanup 核对。规则见[项目删除接口](https://docs.gitlab.com/api/projects/#delete-a-project)。

## 8. 常见问题

| 现象 | 处理 |
| --- | --- |
| 缺少私有配置 | 按第 3 节复制占位配置，填写真实账号并 chmod 600 |
| 缺少 Playwright 或无法启动浏览器 | pnpm install；安装 Chrome，或安装 Chromium 并修改 browser_channel |
| 登录失败 | 手动验证登录页可访问、账号能登录、账号没有需要人工输入的二次认证 |
| 创建项目返回 403/400 | 核对创建项目权限、公开可见性策略、项目数量限制；脚本会保留已经创建资源的记录 |
| 准备一半失败 | 使用提示中的 --state cleanup 清理该次残留，再重新 prepare |
| 参数文件找不到或不在工作区 | 核对发起命令的对话所属工作区和错误中的实际查找路径；仅无 cwd 的历史会话核对插件 workspace |
| 评论数量、初始状态或项目创建断言失败 | 检查是否重复使用已执行的 UI 数据；清理并重新 prepare，不改预期掩盖污染 |
| 标题采成 Primary navigation，或预览正文采成空字符串 | 在实际步骤和调用详情中核对定位；标题应来自主内容区的 Issue，预览要等待渲染并确认可见正文。不要取全页面首个 h1，或并列多个候选后取首个空节点；新版样例已补充说明。完整/部分运行后的回归仍需新数据，不能修改预期或覆盖原 FAIL |
| 接口是登录 HTML 或非 JSON | 检查目标地址、项目是否公开、代理与实例认证策略；当前 GET 不带 UI Cookie |
| 新运行提示环境未释放 | 先按[常见问题速查](../deployment/常见问题速查与处理.md)在设置页释放；停止旧运行后再清理业务项目 |
| cleanup 拒绝归属核验 | 不删除、不更改标记绕过检查；人工核对该次 state 与账号是否匹配 |

当前不包含带认证头的 API、POST/PUT/DELETE 可信测试步骤、仓库提交、流水线、合并请求和权限角色矩阵。准备/清理脚本确实使用写接口管理自己的测试数据，但这些写请求不计作 DSH 接口测试已通过。
