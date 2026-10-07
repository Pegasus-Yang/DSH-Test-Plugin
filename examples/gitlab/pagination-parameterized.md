# GitLab 分页参数化模板

先准备专用数据，再复制 parameters.example.csv 到本机私有目录，填写当前 GitLab 地址及本次接口项目 ID。通过 /test-data 使用这个模板；每条数据展开成一个独立实例，只发送无认证 GET，不打开浏览器。

1. **用例名称：读取第 ${page} 页 Issue**

   **原始用例**：按创建时间升序，每页读取一条 Issue，检查第 ${page} 页的响应数量。

   **前置条件**：本次公开接口项目 ${project_id} 已准备好固定的 alpha、beta、gamma 三条 Issue，尚未清理或修改。

   | 序号 | 操作步骤 | 预期结果 |
   | --- | --- | --- |
   | 1 | 发送 GET 到 ${base_url}/api/v4/projects/${project_id}/issues?order_by=created_at&sort=asc&per_page=1&page=${page} | HTTP 状态码等于 200；响应数组长度等于 ${expected_count} |

   **收尾**：无；不修改项目或 Issue。
