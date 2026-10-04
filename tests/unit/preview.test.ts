import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PreviewManager } from "../../src/preview.js";
import type { SuiteRun } from "../../src/contracts.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  cleanups.splice(0).forEach((cleanup) => cleanup());
});
function setup(browser = true) {
  const directory = mkdtempSync(join(tmpdir(), "preview-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const manager = new PreviewManager({
    workDir: directory,
    browscreenUrl: "http://127.0.0.1:18800",
  });
  const run = {
    suite_run_id: "run-one",
    lifecycle: "RUNNING",
    resource_quarantined: false,
    instances: [
      {
        case_run_id: "case-one",
        resources: browser ? { browser_context: { state: "exists" } } : {},
      },
    ],
  } as unknown as SuiteRun;
  manager.sync(run);
  const metadata = {
    run_id: "run-one",
    case_run_id: "case-one",
    target_id: "page-one",
    endpoint: "ws://127.0.0.1:9222/devtools/page/page-one",
    browser_endpoint: "http://127.0.0.1:9222",
    published_at: new Date(Date.now() - 1000).toISOString(),
  };
  const publish = (patch = {}) => {
    const value = { ...metadata, ...patch };
    writeFileSync(join(directory, "cdp.json"), JSON.stringify(value));
    writeFileSync(join(directory, ".cdp"), value.endpoint);
  };
  return { directory, manager, run, metadata, publish };
}
it("纯API、无CDP和另一运行的CDP都不会请求画面或启用浮窗", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const api = setup(false);
  api.publish();
  expect(await api.manager.state("run-one")).toEqual({ ready: false });
  const browser = setup();
  expect((await browser.manager.state("run-one")).ready).toBe(false);
  browser.publish({ run_id: "run-old" });
  expect((await browser.manager.state("run-one")).ready).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
  expect(
    JSON.parse(readFileSync(join(browser.directory, "owner.json"), "utf8")),
  ).toMatchObject({ run_id: "run-one" });
});
it("CDP可达但没有首帧时仍保持关闭；多标签不选错页面", async () => {
  const value = setup();
  value.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("json/list")
        ? new Response(
            JSON.stringify([
              {
                type: "page",
                id: "page-one",
                webSocketDebuggerUrl: value.metadata.endpoint,
              },
            ]),
          )
        : new Response("未就绪", { status: 503 }),
    ),
  );
  expect((await value.manager.state("run-one")).ready).toBe(false);
  const multiple = setup();
  multiple.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              type: "page",
              id: "page-one",
              webSocketDebuggerUrl: multiple.metadata.endpoint,
            },
            { type: "page", id: "page-two" },
          ]),
        ),
    ),
  );
  expect(await multiple.manager.state("run-one")).toMatchObject({
    ready: false,
    reason: "多标签页面暂不启用实时预览",
  });
});
it("正确页面的有效新帧才就绪，结束或下一运行立即撤销画面", async () => {
  const value = setup();
  value.publish();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).includes("json/list")
        ? new Response(
            JSON.stringify([
              {
                type: "page",
                id: "page-one",
                webSocketDebuggerUrl: value.metadata.endpoint,
              },
            ]),
          )
        : new Response(Buffer.from("89504e470d0a1a0a", "hex"), {
            headers: {
              "X-Frame-Id": "3",
              "X-Capture-Started-At": new Date().toISOString(),
            },
          }),
    ),
  );
  expect(await value.manager.state("run-one")).toMatchObject({
    ready: true,
    frame_id: "3",
  });
  value.manager.sync({ ...value.run, lifecycle: "FINISHED" });
  expect(await value.manager.state("run-one")).toEqual({ ready: false });
  expect(await value.manager.screenshot("run-one")).toBeUndefined();
});
it("旧请求晚到不能为新运行发布首帧", async () => {
  const value = setup();
  value.publish();
  let complete: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          complete = done;
        }),
    ),
  );
  const pending = value.manager.state("run-one");
  value.manager.sync({ ...value.run, suite_run_id: "run-next" });
  complete(
    new Response(
      JSON.stringify([
        {
          type: "page",
          id: "page-one",
          webSocketDebuggerUrl: value.metadata.endpoint,
        },
      ]),
    ),
  );
  expect(await pending).toEqual({ ready: false });
});
