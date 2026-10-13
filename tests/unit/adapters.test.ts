import { it, expect } from "vitest";
import { mcpResult, domFunction } from "../../src/adapters.js";
import { redact } from "../../src/recorder.js";
it("解析规范MCP结果，不拿运行代码或页面摘要作为实际值", () => {
  expect(
    mcpResult({
      content: [
        {
          type: "text",
          text: '### Result\n{"values":{"likes":0}}\n### Ran Playwright code\nignored',
        },
      ],
    }),
  ).toEqual({ values: { likes: 0 } });
  expect(() =>
    mcpResult({ content: [{ type: "text", text: "模型说点赞为1" }] }),
  ).toThrow();
});
it("采集脚本仅采用冻结选择器、显式序号和目标限制", () => {
  const f = domFunction(
    {
      likes: { kind: "dom", mode: "number", selector: "#post_1 .like-count" },
      href: { selector: 'a[href^="/t/"]', index: 0 },
    },
    ["https://ceshiren.com"],
  );
  expect(f).toContain("nodes[c.index??0]");
  expect(f).toContain("location.origin");
  expect(f).not.toContain(".click(");
});
it("图片二进制不重复进入事件，口令和令牌脱敏", () => {
  expect(
    redact({
      content: [
        { type: "image", mimeType: "image/png", data: "BASE64_SECRET" },
      ],
      authorization: "Bearer abcd",
      url: "https://example.test/?token=abc",
    }),
  ).toEqual({
    content: [
      {
        type: "image",
        mimeType: "image/png",
        data: "[二进制图像另存证据附件]",
      },
    ],
    authorization: "[已脱敏]",
    url: "https://example.test/?token=[已脱敏]",
  });
});

it("计划密码在工具text和JSON证据中也脱敏", async () => {
  const { Recorder } = await import("../../src/recorder.js");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const r = new Recorder(mkdtempSync(join(tmpdir(), "secret-")), "run");
  r.protect({ password: "s3cr3t-value" });
  r.event("tool", { text: "输入s3cr3t-value" });
  const e = r.evidence(
    "response.json",
    JSON.stringify({ text: "s3cr3t-value" }),
    "application/json",
  );
  expect(readFileSync(join(r.directory, "events.jsonl"), "utf8")).not.toContain(
    "s3cr3t-value",
  );
  expect(
    readFileSync(join(r.directory, e.relative_path), "utf8"),
  ).not.toContain("s3cr3t-value");
});

it("DSH 投影图片引用不会遮盖规范 MCP 原图，远程证据保存实际 PNG", async () => {
  const { captureStep } = await import("../../src/adapters.js");
  const { Recorder } = await import("../../src/recorder.js");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "remote-evidence-"));
  const recorder = new Recorder(root, "run");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
    "base64",
  );
  const step: any = {
    action: {
      capability: "browser",
      allowed_targets: ["https://example.test"],
      outputs: { zero: { type: "number" } },
      capture: { zero: { kind: "dom", mode: "count", selector: ".missing" } },
    },
  };
  const result: any = { observations: [] };
  const suite: any = { evidence: [] };
  try {
    await captureStep(
      {
        id: "origin",
        browser: { prefix: "mcp__runbridge__" } as any,
        call: async (name) => ({
          callId: name,
          result: {
            isError: false,
            content: [{ type: "image", attachment: { id: "ref" } }],
            value: name.endsWith("browser_capture")
              ? {
                  structuredContent: {
                    values: { zero: 0 },
                    url: "https://example.test/",
                    truncated: false,
                  },
                }
              : {
                  content: [
                    {
                      type: "image",
                      mimeType: "image/png",
                      data: png.toString("base64"),
                    },
                  ],
                },
          } as any,
        }),
      },
      recorder,
      suite,
      step,
      result,
      {} as any,
      {} as any,
    );
    expect(result.observations[0].value).toBe(0);
    expect(result.observations[0].evidence_refs).toHaveLength(2);
    const image = suite.evidence.find((e: any) => e.media_type === "image/png");
    expect(image).toBeDefined();
    expect(readFileSync(join(recorder.directory, image.relative_path))).toEqual(
      png,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
