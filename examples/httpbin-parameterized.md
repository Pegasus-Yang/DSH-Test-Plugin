# 参数化 HTTP 查询验证

每条用例只发送一次 GET 请求，基于同一响应核对检查点。

- 查询 keyword

  请求 `https://httpbin.org/get?keyword=${keyword}`。

  - 验证状态码为200。
  - 验证返回keyword为${keyword}。

- 查询 client

  向 `https://httpbin.org/get` 发送 GET，查询参数为：

  ```json
  {"client": "${client}"}
  ```

  验证状态码为200，返回client为${client}。
