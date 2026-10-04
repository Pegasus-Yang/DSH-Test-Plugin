# HTTP 查询参数回显

每条用例只需发出一次 GET 请求，复用响应完成检查。

- 验证 keyword 参数

  请求 `https://httpbin.org/get?keyword=agent`。

  - 验证 HTTP 状态码为 200。
  - 验证返回 keyword 为 agent。

- 验证结构化查询参数

  向 `https://httpbin.org/get` 发送 GET，查询参数如下：

  ```json
  {"client": "dsh", "code": "001"}
  ```

  验证状态码为200，返回client为dsh、code为字符串001。
