# GitLab 用户用例

通过 Markdown 文档模拟用户的网页和接口测试。账号从不提交的本机配置读取，公开模板只保存占位参数。完整配置、准备、运行及清理见[使用指南](../../doc/user-guide/GitLab复杂用例.md)。

第一次使用先看[GitLab 本地搭建与测试调试](../../doc/deployment/GitLab本地搭建与测试调试.md)：从 Docker 启动和测试账号到 DSH 配置、Markdown/CSV、画面与录像、报告及清理。

| 入门文件 | 用途 |
| --- | --- |
| [docker-compose.yml](docker-compose.yml) | 复制到私有目录，搭建本机 GitLab；业务数据使用 Docker 数据卷 |
| [config.example.json](config.example.json) | 准备脚本的占位配置；真实账号只填在 .local/gitlab/config.json |
| [login-page.txt](login-page.txt) | 服务启动后即可运行的登录页检查，不需要账号 |
| [pagination-parameterized.md](pagination-parameterized.md) | 分页参数模板；通过 /test-data 展开并审核 |
| [parameters.example.csv](parameters.example.csv) | 复制到本轮私有目录后，填写实际地址和接口项目 ID，不填账号 |

| 模板 | 场景 | 固定预期 |
| --- | --- | --- |
| [ui-cases.md](ui-cases.md) | Closed 状态与 dsh-smoke 标签组合筛选 | gamma 唯一匹配，详情标题与独立接口身份一致 |
| [ui-cases.md](ui-cases.md) | Markdown 草稿预览后取消 | 预览文字准确，返回列表，接口搜索草稿为空 |
| [api-cases.md](api-cases.md) | 按专用项目名称搜索 | 数量、ID、路径及 public 可见性准确 |
| [api-cases.md](api-cases.md) | 逐页读取 Issue | 前三页 alpha/beta/gamma，第四页为空数组 |
| [api-cases.md](api-cases.md) | 不存在的项目 | HTTP 404，错误信息为 404 Project Not Found |

接口用例只发送无认证 GET，不登录、不打开浏览器。标题、状态和标签沿用固定种子；准备记录的项目 ID、Issue IID 只用于定位资源。

## 最短使用路径

在插件源码目录安装依赖，将 config.example.json 复制到 .local/gitlab/config.json，用编辑器填写账号并设置 600 权限，然后运行：

    pnpm gitlab:prepare

脚本创建两个专用项目，生成 2 条 UI、3 条接口用例，打印以下 Markdown 命令：

    /test-run .local/gitlab/本次标记/api.md
    /test-run .local/gitlab/本次标记/ui.md
    /test-run .local/gitlab/本次标记/all.md

选择一条执行，将生成目录放在当前 DSH 对话工作区内。单独用例也有 ui_filters.md、api_pagination.md 等文件。需要先审核规划时使用 /test-plan --file 文件路径。账号已经填好的文档和运行资料均留在本机私有目录。

完成后清理本次专用项目：

    pnpm gitlab:cleanup --state ".local/gitlab/本次标记/state.json"

每轮 UI 使用新的准备数据，原始用例和失败报告保留。共享浏览器运行串行。完整开发回归场景及内部资料见[开发者说明](../../doc/reference/开发者JSON用例与调试.md)。
