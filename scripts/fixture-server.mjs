/** 验收专用本地页面与API，无真实账户或业务数据。 */
import { createServer } from "node:http";
const html = `<!doctype html><meta charset="utf-8"><title>测试夹具</title><style>body{font:18px sans-serif;max-width:650px;margin:80px auto}label{display:block;margin:20px 0}input,button{padding:10px;font:inherit}</style><h1>登录测试夹具</h1><form id="login"><label>账号<input id="username"></label><label>密码<input id="password" type="password"></label><button type="submit">登录</button></form><p id="auth-result" data-auth="unknown">尚未登录</p><p>UI金额 <span id="amount">100</span></p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/login',{method:'POST',body:JSON.stringify({username:document.querySelector('#username').value,password:document.querySelector('#password').value})});const data=await r.json();const el=document.querySelector('#auth-result');el.dataset.auth=String(data.authenticated);el.textContent=data.authenticated?'登录成功':'登录失败';};</script>`;
const server = createServer((req, res) => {
  if (req.url === "/api/amount") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ amount: 101 }));
    return;
  }
  if (req.url === "/api/login") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let value = {};
      try {
        value = JSON.parse(body);
      } catch {}
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          authenticated:
            value.username === "tester" && value.password === "fixture-only",
        }),
      );
    });
    return;
  }
  res.setHeader("content-type", "text/html;charset=utf-8");
  res.end(html);
});
server.listen(18081, "127.0.0.1", () =>
  console.log("验收夹具：http://127.0.0.1:18081"),
);
process.on("SIGTERM", () => server.close());
