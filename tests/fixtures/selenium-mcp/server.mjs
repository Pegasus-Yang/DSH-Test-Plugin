/** 仅用于兼容性验证的真实 Selenium MCP；不进入插件发行包。 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Builder, By } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import * as z from "zod/v4";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const mode = process.env.SELENIUM_MCP_MODE ?? "native";
if (
  !["native", "renamed", "minimal", "managed", "playwright-contract"].includes(
    mode,
  )
)
  throw new Error("SELENIUM_MCP_MODE 不支持该测试模式");
if (!process.env.SELENIUM_MCP_ORIGIN || !process.env.SELENIUM_MCP_OUTPUT)
  throw new Error("必须提供本轮计数页的 origin 和独立输出目录");
const origin = new URL(process.env.SELENIUM_MCP_ORIGIN).origin;
const output = resolve(process.env.SELENIUM_MCP_OUTPUT);
await mkdir(output, { recursive: true });
const compatible = mode === "playwright-contract";
let driver, profile, identity;
let sequence = 0;
const refs = new Map();
const audit = (event) =>
  appendFile(
    join(output, "selenium.jsonl"),
    JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      mode,
      engine: "selenium-webdriver",
      ...identity,
      ...event,
    }) + "\n",
  );

async function browser() {
  if (!driver) {
    profile = await mkdtemp(join(output, "chrome-"));
    const options = new chrome.Options().addArguments(
      "--headless=new",
      "--no-sandbox",
      "--no-first-run",
      "--window-size=1440,900",
      `--user-data-dir=${profile}`,
    );
    if (process.env.SELENIUM_BROWSER_BINARY)
      options.setChromeBinaryPath(process.env.SELENIUM_BROWSER_BINARY);
    driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();
    await driver.manage().setTimeouts({ pageLoad: 20000, script: 10000 });
    const capabilities = await driver.getCapabilities();
    identity = {
      session_id: (await driver.getSession()).getId(),
      page_id: await driver.getWindowHandle(),
      browser: capabilities.get("browserName"),
      browser_version: capabilities.get("browserVersion"),
    };
    await audit({ event: "session_opened" });
  }
  return driver;
}

async function closeBrowser() {
  const existed = !!driver;
  if (driver) {
    await driver.quit();
    driver = undefined;
    refs.clear();
    await audit({ event: "session_closed", released: true });
    await rm(profile, { recursive: true, force: true });
    profile = undefined;
  }
  return { released: true, had_session: existed };
}

async function pageState() {
  const page = await browser();
  const state = await page.executeScript(() => ({
    url: location.href,
    title: document.title,
    text: document.body.innerText,
    elements: [...document.querySelectorAll("button,input,a")].map((el) => ({
      tag: el.tagName.toLowerCase(),
      name: el.getAttribute("aria-label") || el.textContent?.trim() || el.id,
      selector: el.id ? "#" + CSS.escape(el.id) : null,
    })),
  }));
  refs.clear();
  for (const [index, element] of state.elements.entries()) {
    element.ref = "e" + (index + 1);
    if (element.selector) refs.set(element.ref, element.selector);
  }
  return state;
}

function response(value, state, image) {
  const data = {
    ...(value && typeof value === "object" ? value : { value }),
    ...(identity ? { identity } : {}),
  };
  const snapshot = state
    ? `${state.title}\n${state.text}\n${state.elements.map((el) => `- ${el.tag} "${el.name}" [ref=${el.ref}]`).join("\n")}`
    : "";
  return {
    content: [
      {
        type: "text",
        text: compatible
          ? `### Result\n${JSON.stringify(data)}${snapshot ? "\n### Snapshot\n" + snapshot : ""}`
          : JSON.stringify(data),
      },
      ...(image ? [{ type: "image", mimeType: "image/png", data: image }] : []),
    ],
    structuredContent: data,
  };
}

serveStdio(() => {
  const server = new McpServer({ name: "selenium-fixture", version: "1.0.0" });
  function tool(name, description, inputSchema, handler) {
    if (
      (mode === "minimal" &&
        ["browser_close", "browser_take_screenshot"].includes(name)) ||
      (mode === "managed" && name === "browser_close")
    )
      return;
    const aliases = {
      browser_navigate: "go_to",
      browser_snapshot: "inspect_page",
      browser_click: "click_element",
      browser_evaluate: "evaluate_readonly",
      browser_read: "get_text",
      browser_take_screenshot: "photo",
      browser_close: "dispose",
    };
    const publicName = mode === "renamed" ? (aliases[name] ?? name) : name;
    let normalize = (args) => args;
    if (mode === "renamed" && name === "browser_navigate") {
      inputSchema = z.object({ address: z.string() });
      normalize = (args) => ({ url: args.address });
    }
    if (
      mode === "renamed" &&
      ["browser_click", "browser_read"].includes(name)
    ) {
      inputSchema = z.object({ css: z.string() });
      normalize = (args) => ({ selector: args.css });
    }
    if (mode === "renamed" && name === "browser_evaluate") {
      inputSchema = z.object({ source: z.string() });
      normalize = (args) => ({ script: args.source });
    }
    server.registerTool(
      publicName,
      { description, inputSchema },
      async (args) => {
        await audit({
          event: "tool_started",
          tool: publicName,
          operation: name,
          args,
        });
        try {
          const result = await handler(normalize(args));
          await audit({
            event: "tool_finished",
            tool: publicName,
            operation: name,
            ok: true,
          });
          return result;
        } catch (error) {
          await audit({
            event: "tool_finished",
            tool: publicName,
            operation: name,
            ok: false,
            error: error.message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: error.message }],
          };
        }
      },
    );
  }
  tool(
    "browser_navigate",
    "使用 Selenium 打开本轮本地计数页面。返回 structuredContent:{url,title}，content[0] 为同一对象的 JSON 文本。",
    z.object({ url: z.string() }),
    async ({ url }) => {
      if (new URL(url).origin !== origin)
        throw new Error("仅允许本轮计数页来源");
      await (await browser()).get(url);
      const state = await pageState();
      return response({ url: state.url, title: state.title }, state);
    },
  );
  tool(
    "browser_snapshot",
    "读取当前页面文字和可操作元素；返回元素 ref。",
    z.object({}),
    async () => {
      const state = await pageState();
      return response(state, state);
    },
  );
  tool(
    "browser_click",
    "使用 Selenium 点击一个实际元素。",
    compatible
      ? z.object({ ref: z.string(), element: z.string().optional() })
      : z.object({ selector: z.string() }),
    async (args) => {
      const selector = compatible ? refs.get(args.ref) : args.selector;
      if (!selector) throw new Error("元素 ref 不存在，请先读取当前页面");
      await (await browser()).findElement(By.css(selector)).click();
      const state = await pageState();
      return response({ clicked: true, selector }, state);
    },
  );
  tool(
    "browser_evaluate",
    "在当前本地页面执行 Selenium JavaScript 观察，脚本需要 return。返回对象直接放入 structuredContent；标量返回 structuredContent:{value:标量}，content[0] 为同一对象的 JSON 文本。",
    compatible
      ? z.object({ function: z.string() })
      : z.object({ script: z.string() }),
    async (args) => {
      const page = await browser();
      if (new URL(await page.getCurrentUrl()).origin !== origin)
        throw new Error("页面不在本轮来源内");
      return response(
        await page.executeScript(
          compatible ? `return (${args.function})();` : args.script,
        ),
      );
    },
  );
  if (!compatible)
    tool(
      "browser_read",
      "使用 Selenium 读取指定 CSS 元素的文字。返回 structuredContent:{text:字符串}，content[0] 为同一对象的 JSON 文本。",
      z.object({ selector: z.string() }),
      async ({ selector }) =>
        response({
          text: await (await browser()).findElement(By.css(selector)).getText(),
        }),
    );
  tool(
    "browser_take_screenshot",
    "使用 Selenium 在已打开的当前页面获取真实 PNG 截图；只读且可重复调用，每次实际采集图片，保持原 session/page，不另建浏览器。structuredContent.identity.page_id 与原动作返回相同，可连续读取验证定时截图能力。",
    z.object({
      type: z.literal("png").optional(),
      fullPage: z.boolean().optional(),
    }),
    async () => {
      const image = await (await browser()).takeScreenshot();
      const file = join(output, `screenshot-${++sequence}.png`);
      await writeFile(file, Buffer.from(image, "base64"));
      return response({ file, scope: "viewport" }, undefined, image);
    },
  );
  tool(
    "browser_close",
    "退出 Selenium WebDriver 并确认本服务的浏览器已释放。",
    z.object({}),
    async () => response(await closeBrowser()),
  );
  if (mode === "managed") {
    tool(
      "create_context",
      "新建本服务的独立 Selenium 会话并返回真实身份。",
      z.object({}),
      async () => {
        await browser();
        return response({ id: identity.session_id });
      },
    );
    tool(
      "dispose_context",
      "按原会话身份释放本服务的浏览器。",
      z.object({ context_id: z.string() }),
      async ({ context_id }) => {
        if (context_id !== identity?.session_id)
          throw new Error("资源身份不匹配");
        return response(await closeBrowser());
      },
    );
  }
  return server;
});

let stopping;
function shutdown() {
  return (stopping ??= closeBrowser().finally(() => process.exit(0)));
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.stdin.once("end", () => void shutdown());
