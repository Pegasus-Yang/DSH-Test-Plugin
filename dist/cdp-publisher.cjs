"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/cdp-publisher.ts
var cdp_publisher_exports = {};
__export(cdp_publisher_exports, {
  default: () => publishPage
});
module.exports = __toCommonJS(cdp_publisher_exports);
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_crypto = require("node:crypto");
async function readOwner(directory) {
  return JSON.parse(await (0, import_promises.readFile)((0, import_node_path.join)(directory, "owner.json"), "utf8"));
}
async function publish(path, contents) {
  const temporary = `${path}.${(0, import_node_crypto.randomUUID)()}.tmp`;
  await (0, import_promises.writeFile)(temporary, contents, { mode: 384 });
  await (0, import_promises.rename)(temporary, path);
}
async function publishPage({
  page
}) {
  const directory = process.env.DSH_TEST_PREVIEW_DIR;
  if (!directory) return;
  let session;
  try {
    const owner = await readOwner(directory);
    if (!owner.run_id || !owner.case_run_id) return;
    session = await page.context().newCDPSession(page);
    const command = await session.send("Browser.getBrowserCommandLine");
    let port = command.arguments.map((argument) => /^--remote-debugging-port=(\d+)$/.exec(argument)).filter((match) => match).at(-1)?.[1];
    if (port === "0") {
      const profile = command.arguments.map((argument) => /^--user-data-dir=(.+)$/.exec(argument)).filter((match) => match).at(-1)?.[1];
      if (!profile) return;
      port = (await (0, import_promises.readFile)((0, import_node_path.join)(profile, "DevToolsActivePort"), "utf8")).split(/\r?\n/)[0]?.trim();
    }
    if (!port || Number(port) < 1 || Number(port) > 65535) return;
    const { targetInfo } = await session.send("Target.getTargetInfo");
    const browserEndpoint = `http://127.0.0.1:${port}`;
    const response = await fetch(`${browserEndpoint}/json/list`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return;
    const targets = await response.json();
    const target = targets.find((entry) => entry.id === targetInfo.targetId);
    if (!target?.webSocketDebuggerUrl) return;
    const current = await readOwner(directory);
    if (current.run_id !== owner.run_id || current.case_run_id !== owner.case_run_id)
      return;
    const metadata = {
      ...owner,
      target_id: target.id,
      endpoint: target.webSocketDebuggerUrl,
      browser_endpoint: browserEndpoint,
      published_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    await (0, import_promises.mkdir)(directory, { recursive: true });
    await publish((0, import_node_path.join)(directory, ".cdp"), metadata.endpoint + "\n");
    await publish((0, import_node_path.join)(directory, "cdp.json"), JSON.stringify(metadata));
  } catch (error) {
    console.warn("\u6D4B\u8BD5\u9875\u9762\u672A\u4EA4\u4ED8 CDP\uFF0C\u5B9E\u65F6\u9884\u89C8\u4FDD\u6301\u5173\u95ED\uFF1A", String(error));
  } finally {
    await session?.detach().catch(() => {
    });
  }
}
