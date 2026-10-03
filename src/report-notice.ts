/** 通过宿主公开的index注入显示报告入口，不依赖聊天页面内部DOM。 */
export function reportNotice(): void {
  const boot = () => {
    if (document.getElementById("harness-test-report-notice")) return;
    const host = document.createElement("div");
    host.id = "harness-test-report-notice";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{position:fixed;right:20px;bottom:20px;z-index:1000;font:14px/1.6 system-ui,sans-serif;color:#203040;max-width:calc(100vw - 32px)}
      section{width:370px;max-width:calc(100vw - 32px);box-sizing:border-box;background:#fff;border:1px solid #cad9e3;border-top:3px solid #087c70;border-radius:10px;padding:16px;box-shadow:0 8px 32px #18334a26}
      header{display:flex;align-items:center;justify-content:space-between;gap:12px}strong{font-size:16px}p{margin:8px 0;overflow-wrap:anywhere}small{display:block;color:#647586;overflow-wrap:anywhere;font-size:11px}
      a,button{font:inherit}a{display:inline-block;background:#087c70;color:#fff;text-decoration:none;padding:7px 15px;border-radius:6px;margin:6px 0}button{border:0;background:#edf3f6;color:#304859;border-radius:6px;padding:5px 10px;cursor:pointer}button[aria-label]{background:none;font-size:18px} [hidden]{display:none!important}
    </style><section hidden aria-label="测试运行与报告"><header><strong role="status" aria-live="polite"></strong><button aria-label="收起报告提示">×</button></header><p></p><a target="_blank" rel="noopener" hidden>查看测试报告</a><small class="path"></small><small class="id"></small></section><button class="reopen" hidden>测试报告</button>`;
    document.body.append(host);
    const panel = root.querySelector("section")!,
      title = root.querySelector("strong")!,
      summary = root.querySelector("p")!,
      link = root.querySelector("a")!,
      path = root.querySelector(".path")!,
      id = root.querySelector(".id")!,
      reopen = root.querySelector<HTMLButtonElement>(".reopen")!;
    let key = "",
      collapsed = false;
    root.querySelector("button[aria-label]")!.addEventListener("click", () => {
      collapsed = true;
      panel.hidden = true;
      reopen.hidden = false;
    });
    reopen.addEventListener("click", () => {
      collapsed = false;
      panel.hidden = false;
      reopen.hidden = true;
    });
    const poll = async () => {
      try {
        const response = await fetch(
          new URL("./test-reports/status", document.baseURI),
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const state = await response.json();
        if (!state) return;
        const next = state.run_id + ":" + state.lifecycle + ":" + state.ready;
        if (next !== key) {
          key = next;
          collapsed = false;
        }
        title.textContent = state.title;
        summary.textContent = state.summary;
        path.textContent = "保存位置：" + state.path;
        id.textContent = "运行ID：" + state.run_id;
        link.hidden = !state.ready;
        link.href = new URL(state.url, document.baseURI).href;
        panel.hidden = collapsed;
        reopen.hidden = !collapsed;
      } catch {
        /* 宿主暂时断开时保留入口，下次轮询重试。 */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    window.addEventListener("pagehide", () => clearInterval(timer), {
      once: true,
    });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
