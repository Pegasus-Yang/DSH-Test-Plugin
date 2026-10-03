/** 只读勘察选择器；正式验收必须由Harness模型和MCP执行。 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto("https://ceshiren.com");
await page.getByRole("button", { name: "搜索", exact: true }).click();
console.log(
  "inputs",
  await page
    .locator("input")
    .evaluateAll((es) =>
      es.map((e) => ({ type: e.type, id: e.id, placeholder: e.placeholder })),
    ),
);
await page.locator("#search-term").fill("agent");
await page.locator("#search-term").press("Enter");
await page.waitForTimeout(5000);
console.log("url", page.url());
console.log((await page.locator("body").innerText()).slice(0, 5000));
console.log(
  "links",
  await page
    .locator("a.search-link")
    .evaluateAll((es) =>
      es
        .slice(0, 3)
        .map((e) => ({ text: e.textContent, href: e.href, html: e.outerHTML })),
    ),
);
await page.locator("a.search-link").first().click();
await page.waitForTimeout(4000);
console.log("posturl", page.url());
console.log("post", await page.locator("#post_1").innerText());
console.log(
  "likes",
  await page
    .locator("#post_1")
    .evaluate((e) =>
      [...e.querySelectorAll("[class*=like]")].map((x) => x.outerHTML),
    ),
);
await mkdir("artifacts/validation/ceshiren", { recursive: true });
await page.screenshot({ path: "artifacts/validation/ceshiren/scout.png" });
await browser.close();
