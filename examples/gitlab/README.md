# GitLab 复杂测试用例

这些用例让 DSH 插件在真实 GitLab 上验证跨页面操作、数据持久化、多条件检索、分页和错误响应。账号通过本机配置读取，不存在于本目录。详细步骤见[GitLab复杂用例](../../doc/user-guide/GitLab复杂用例.md)。

## UI 场景

| 用例 ID | 做什么 | 怎样判断成功 |
| --- | --- | --- |
| ui_issue_lifecycle | 登录，编辑 Issue 标题与多行正文，评论，关闭，重新打开 | UI 重新读取标题；独立 GET 核对标题、正文、评论数量和文本、关闭及重新打开状态 |
| ui_filters | 登录，在页面组合选择 Closed 与 dsh-smoke 标签，再打开唯一结果 | UI 标题精确匹配 gamma；接口返回唯一记录，IID、状态、标签准确 |
| ui_draft_cancel | 登录，填写中文草稿，预览 Markdown，取消并处理丢弃确认 | 预览文本准确，返回列表；接口搜索草稿标题返回空数组 |
| ui_project_create | 登录，通过表单创建公开空白项目，在设置页保存描述，再创建中文、多行正文 Issue | 项目路径与属性准确；UI 刷新后的标题、接口重新读取的正文和状态准确 |

UI 场景包含独立接口检查，因此 UI 集合会同时记录浏览器操作与 GET。登录是前置步骤，插件在每个实例前后自动复位和关闭浏览器。业务数据通过下方清理命令删除，不把浏览器关闭当作项目清理。

## 纯接口场景

| 用例 ID | 检查内容 |
| --- | --- |
| project_search | 精确项目搜索、数量、ID、路径、public 可见性 |
| project_by_path | 编码的命名空间路径、项目身份与固定描述 |
| pagination | per_page=1，前三页分别是 alpha/beta/gamma，第四页是空数组 |
| filter_opened | 两条 opened Issue，顺序、IID、标题与状态 |
| filter_closed | 唯一 closed Issue |
| filter_label | dsh-smoke 与 opened 组合筛选 |
| filter_search | 中文 Python测试开发 搜索 |
| issue_detail | 精确标题、多行正文、标签、状态、评论数量与所属项目 |
| issue_comments_access | 公开 Issue 的评论 REST 接口仍要求认证，匿名请求返回 401 |
| empty_search | 无匹配结果是 200 和空数组 |
| missing_project | 不存在项目是 404 与固定 JSON 错误 |
| missing_issue | 已有项目中不存在 Issue 是 404 与固定 JSON 错误 |
| anonymous_user | 无认证访问 /user 是 401 与固定 JSON 错误 |

13 条纯接口场景包含 16 次 GET 和 64 个检查点，不登录、不操作浏览器、不产生浏览器截图或录像。当前可信 HTTP 采集支持无认证 GET JSON；所以准备的是只含虚构验收数据的公开项目。GitLab 的[项目 API](https://docs.gitlab.com/api/projects/)和[Issue API](https://docs.gitlab.com/api/issues/)说明了公开读取与过滤能力。[Notes 源码](https://gitlab.com/gitlab-org/gitlab/-/blob/v19.4.1-ee/lib/api/notes.rb)要求认证，因此评论正文通过 UI 刷新核对，公开 Issue 详情用于独立核对评论数量。

## 固定数据

准备脚本创建两个独立项目：一个用于接口基线，一个用于 UI 操作。每个项目包含两条 opened Issue、一条 closed Issue、dsh-smoke 与 dsh-regression 两个标签，以及 alpha Issue 上的一条固定评论。

标题、正文、标签和状态在 scripts/gitlab/plans.mjs 中固定；服务器返回的项目 ID 和 Issue IID 只用于定位刚创建的资源，不用于倒推业务预期。

## 最短使用路径

在插件源码根目录：

```sh
pnpm install --frozen-lockfile
mkdir -p .local/gitlab
cp examples/gitlab/config.example.json .local/gitlab/config.json
chmod 600 .local/gitlab/config.json
# 用编辑器填写配置，不在命令行里输入密码。
pnpm gitlab:prepare
```

prepare 会打印可以直接复制到 DSH 的 /test-run 命令。运行 UI 前请开启 Playwright MCP；纯接口集合不需要浏览器。DSH 插件工作区需要包含生成文件所在的项目。

测试结束后，在终端执行：

```sh
pnpm gitlab:cleanup
```

每次 UI 回归使用新的 prepare 数据。cleanup 默认只处理最近一次准备；较早记录用 --state 明确指定。不要并行运行多个集合，当前插件的共享浏览器执行仍然串行。
