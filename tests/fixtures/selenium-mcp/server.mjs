/** 仅用于兼容性验证的真实 Selenium MCP；不进入插件发行包。 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { Builder, By } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import * as z from "zod/v4";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const mode = process.env.SELENIUM_MCP_MODE ?? "native";
if (!["native", "playwright-contract"].includes(mode))
  throw new Error("SELENIUM_MCP_MODE 只支持 native 或 playwright-contract");
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
  const data = value && typeof value === "object" ? value : { value };
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
    server.registerTool(name, { description, inputSchema }, async (args) => {
      await audit({ event: "tool_started", tool: name, args });
      try {
        const result = await handler(args);
        await audit({ event: "tool_finished", tool: name, ok: true });
        return result;
      } catch (error) {
        await audit({
          event: "tool_finished",
          tool: name,
          ok: false,
          error: error.message,
        });
        return {
          isError: true,
          content: [{ type: "text", text: error.message }],
        };
      }
    });
  }
  tool(
    "browser_navigate",
    "使用 Selenium 打开本轮本地计数页面。",
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
    "在当前本地页面执行 JavaScript 观察并返回真实值。",
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
      "使用 Selenium 读取指定 CSS 元素的文字。",
      z.object({ selector: z.string() }),
      async ({ selector }) =>
        response({
          text: await (await browser()).findElement(By.css(selector)).getText(),
        }),
    );
  tool(
    "browser_take_screenshot",
    "使用 Selenium 获取真实浏览器 PNG 截图。",
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
  return server;
});

let stopping;
function shutdown() {
  return (stopping ??= closeBrowser().finally(() => process.exit(0)));
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
process.stdin.once("end", () => void shutdown());
