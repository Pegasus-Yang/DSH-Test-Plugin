# 开发者 JSON 用例与调试

本页用于插件开发、调试和程序生成回归资料。用户用例以 TXT、Markdown 和 CSV 参数化为入口；命令菜单、README 和用户指南不推荐编写 JSON 用例。JSON 执行能力继续保留，运行时仍复用当前对话的模型和工具。

[English](开发者JSON用例与调试.en.md) · [当前架构](../architecture/当前实现.md) · [用户文件用例](../user-guide/使用说明.md)

## 内部执行文件

/test-run 仍可读取工作区内的完整 JSON TestSuite，使用 parsePlan(input) 校验。顶层必需字段为 schema_version（固定字符串“1”）、suite_id、name、source_refs、cases；每个用例声明 datasets、preconditions、steps、cleanup。动作使用 action，断言使用 assertion。完整样例见[网页集合](../../examples/ceshiren-agent.json)、[接口集合](../../examples/httpbin-get.json)。

planning 为可选资料；提供用户原文时同时填写 original_task 和 rationale。没有独立原文时，手工用例的原始用例为空，不用集合名称代替。

观察路径以点分隔，数组使用数字段，例如 request.response.body.0.iid。文字检查绑定拒绝 body[0] 语法。完整 HTTP 响应固定为对象；检查状态码应引用 response.status，不能将完整对象与数字比较。正文子字段仍按业务观察计算结果，不从当前实际值生成预期。

普通 /test、/test-plan 和文字文件入口保存的 plan.json 含 intent 文字步骤，批量入口还含 planning.input 快照。该文件用于记录已审规划，不能直接用于 JSON 执行入口：parsePlan 默认不允许 intent 或文字输入快照。运行分析定义位于实例的 effective_steps；actual-steps.json 是运行记录，也不是执行计划。当前没有通用的文字运行到完整 JSON 执行集合导出。

## 怎样生成和运行

开发者可复制样例，修改目标、输入、采集与独立预期，保存到本机工作区，再在对应 DSH 对话输入 /test-run 文件.json。账号由私有配置或生成过程注入，不写入公开模板。已脱敏的计划不能恢复原凭据。

GitLab 的 scripts/gitlab/plans.mjs 继续生成 4 条 UI、13 条接口场景的完整开发集合，共 100 个必需业务检查点。prepare 或 generate 同时在私有目录保存 api.json、ui.json、all.json 及单 UI 文件；生成器默认仅打印 Markdown 用户命令。开发者按需要显式执行 /test-run .local/gitlab/本次标记/api.json 等文件。该集合和 Markdown 用户集合共用固定种子、准备记录及清理流程；UI 会改变数据，开发集合和用户集合分别使用新 prepare 数据。

开发集合的场景见 scripts/gitlab/plans.mjs；用户 Markdown 模板见 examples/gitlab/ui-cases.md 和 api-cases.md，绑定逻辑见 scripts/gitlab/markdown.mjs。业务预期来自固定种子，服务器返回的资源 ID 只用于定位，不能从当前响应反推预期。

## 调试与记录边界

计划、调用、状态、检查点和事件账本用于开发分析；必要写入失败停止新派发。手工用例通过独立 manual-source.json 保存真实资料，Markdown 导出不脱敏，原始资料不开放报告访问。运行审计继续按现有规则处理；文字输入快照可能包含原始文字，应与手工资料及媒体一起保存在私有运行目录，不将真实账号提交到代码或文档。

清理步骤必须提供 run_if；resource_exists 还须有 resource_ref。每例至少有一个必需业务断言，规则来源必须存在，预期来源恰选一种。模型可以调整页面定位，不能将当前实际值改为通过预期。

构建和回归命令见[安装与运维](../deployment/安装与运维.md#构建与打包)。本页描述当前行为，历史设计和验收保留原始记录。


## JSON计划

完整示例见 `examples/ceshiren-agent.json`。一个 suite 含多个 case，每个 case 的 datasets 各自展开；例如两例分别2行和3行得到5个实例。空 datasets 自动产生 default 行。

准备、业务和清理复用 Step 结构；ID在同一用例跨阶段唯一，不得使用内部保留前缀 `__`。依赖只能指向前序；必需步骤不能引用可选输出。每例至少有一个必需业务断言。

动作必须声明目标URL、目标描述、输入、输出JSON Schema和必要输出。这些详细字段仅用于JSON执行计划；自然语言文字规划不需要填写。JSON默认使用固定capture，也可显式设置 `capture_mode: "runtime"`。输入支持 `{"input_ref":"data.inputs.key"}`、`{"resource_ref":"browser_context"}`、`{"literal":值}` 或直接JSON值。当前资源登记只支持独占的浏览器上下文。

`capture` 按输出名称定义可信采集：

| kind | 字段 | 行为 |
| --- | --- | --- |
| dom | selector、mode、可选index/attribute/field | 固定只读DOM函数；除显式index外必须唯一匹配 |
| http | url、field | 原生工具管线内执行HTTP GET并读取JSON，如 `body.amount` |
| browser_close | 无 | 通过Playwright MCP关闭上下文，以成功响应生成released=true |

DOM mode支持text、number、count、visible、url、attribute、value；url默认完整网址，field=pathname只取路径；index从0开始，用于明确的第几条结果。number只接受明确十进制文本，不把缺失/空白转换成0。缺少必要输出是ERROR；声明为非必要的输出缺失导致对应断言INCONCLUSIVE。观察槽只绑定一次，重复采集不覆盖旧值。运行时绑定调用 `test_capture({capture: {输出名: 采集定义}, reason: "当前页面依据或调整原因"})`；定位失败可调整后只补采缺失输出，不能更改输出含义、类型、目标范围或断言预期。

断言支持eq、neq、contains、range、exists、text、visible。预期在literal、data.expected引用、另一观察引用中恰选一种，规则必须有source_refs来源。neq保留类型要求，字符串"1"不会冒充数字1。range必须给单位、容差和两个数值边界。


## GitLab 完整开发回归场景

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
