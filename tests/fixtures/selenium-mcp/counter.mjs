/** 本轮固定种子：每次打开均为 0，点击一次为 1，同时保留实际点击请求。 */
import { createServer } from "node:http";
import { appendFile } from "node:fs/promises";

export async function createCounterFixture({ traceFile }) {
  const clicks = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/clicked" && req.method === "POST") {
      const event = {
        at: new Date().toISOString(),
        scenario: url.searchParams.get("scenario"),
      };
      clicks.push(event);
      void appendFile(traceFile, JSON.stringify(event) + "\n");
      res.writeHead(204);
      res.end();
      return;
    }
    if (url.pathname !== "/counter") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Selenium 计数器</title>
<style>body{font:20px system-ui;margin:80px;background:#f5f7fa;color:#17243a}main{max-width:520px;background:white;padding:40px;border-radius:12px}button{font:inherit;padding:12px 24px;background:#147b83;color:white;border:0;border-radius:6px}output{font-size:48px;display:block;margin:24px 0}</style>
<script>window.addEventListener('error',e=>document.documentElement.dataset.error=e.message);window.addEventListener('unhandledrejection',e=>document.documentElement.dataset.rejection=String(e.reason))</script>
<main><h1>Selenium 计数器</h1><p>点击一次按钮，计数应由 0 变为 1。</p><output id="counter" aria-label="当前计数">0</output><button id="increment" onclick="counter.textContent=String(Number(counter.textContent)+1);fetch('/clicked?scenario='+encodeURIComponent(new window.URL(window.location.href).searchParams.get('scenario')||''),{method:'POST'})">增加 1</button></main></html>`);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    clicks,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}
