import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { PreviewSettingsAccess } from "../../src/preview-settings-access.js";
import { checkBrowscreen } from "../../src/browscreen-command.js";
import { checkRunBridgeSettings } from "../../src/runbridge-settings.js";
vi.mock("../../src/runbridge-settings.js", () => ({
  checkRunBridgeSettings: vi
    .fn()
    .mockResolvedValue({ ok: true, code: "FILE_VALID", message: "已解析" }),
}));

vi.mock("../../src/browscreen-command.js", () => ({
  checkBrowscreen: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(checkBrowscreen).mockReset().mockResolvedValue({
    ok: true,
    executable: "/installed/browscreen",
    version: "0.2.1",
    message: "已安装",
  });
});
const services: PreviewSettingsAccess[] = [];
afterEach(() => services.splice(0).forEach((service) => service.dispose()));
function setup() {
  const service = new PreviewSettingsAccess(() => ({
    namespace: "test",
    message: "未开始",
    mcpInstances: [],
  }));
  services.push(service);
  return service;
}
async function request(
  service: PreviewSettingsAccess,
  path: string,
  method = "GET",
  body = "",
) {
  const req = Object.assign(new PassThrough(), { url: path, method });
  let status = 200,
    result = "";
  const headers: Record<string, string> = {};
  const res: any = new EventEmitter();
  res.setHeader = (name: string, value: string) => {
    headers[name] = value;
  };
  res.writeHead = (value: number) => {
    status = value;
  };
  res.end = (value: string) => {
    result = value;
  };
  const pending = service.serve(req as never, res);
  req.end(body);
  await pending;
  return { status, result: result ? JSON.parse(result) : undefined, headers };
}
it("读取元信息不执行检测；主动 POST 检测当前填写的命令，不保存配置", async () => {
  const service = setup();
  expect(
    (await request(service, "/test-preview-settings")).result.namespace,
  ).toBe("test");
  expect(checkBrowscreen).not.toHaveBeenCalled();
  const result = await request(
    service,
    "/test-preview-settings/check",
    "POST",
    JSON.stringify({ browscreenExecutable: "/installed command/browscreen" }),
  );
  expect(result.result).toMatchObject({ ok: true, version: "0.2.1" });
  expect(checkBrowscreen).toHaveBeenCalledWith(
    "/installed command/browscreen",
    { signal: expect.any(AbortSignal) },
  );
  expect(result.headers["Cache-Control"]).toBe("no-store");
});
it.each([
  ["/test-preview-settings/check", "GET", 405],
  ["/test-preview-settings", "POST", 405],
  ["/test-preview-settings/not-a-command", "POST", 404],
])("路径 %s 方法 %s 不会触发命令", async (path, method, status) => {
  expect((await request(setup(), path, method)).status).toBe(status);
  expect(checkBrowscreen).not.toHaveBeenCalled();
});
it.each(["not-json", "null", '{"browscreenExecutable":5}', "x".repeat(4097)])(
  "非法或过大请求不会执行命令",
  async (body) => {
    expect(
      (await request(setup(), "/test-preview-settings/check", "POST", body))
        .status,
    ).toBe(400);
    expect(checkBrowscreen).not.toHaveBeenCalled();
  },
);
it("宿主卸载时取消尚未完成的设置页查询", async () => {
  const service = setup();
  vi.mocked(checkBrowscreen).mockImplementation(
    (_value, options) =>
      new Promise((done) => {
        options?.signal?.addEventListener("abort", () =>
          done({ ok: false, code: "CHECK_CANCELLED", message: "已取消" }),
        );
      }),
  );
  const pending = request(
    service,
    "/test-preview-settings/check",
    "POST",
    '{"browscreenExecutable":"browscreen"}',
  );
  await vi.waitFor(() => expect(checkBrowscreen).toHaveBeenCalled());
  service.dispose();
  expect((await pending).result.code).toBe("CHECK_CANCELLED");
});
it("远程检查只接收路径，读取与连接动作分开，不保存配置", async () => {
  const service = setup();
  const result = await request(
    service,
    "/test-preview-settings/runbridge",
    "POST",
    JSON.stringify({
      accessFile: "/private/access.json",
      resourceId: "chromium",
      action: "read",
    }),
  );
  expect(result.result.code).toBe("FILE_VALID");
  expect(checkRunBridgeSettings).toHaveBeenLastCalledWith(
    process.cwd(),
    {
      accessFile: "/private/access.json",
      resourceId: "chromium",
      connect: false,
    },
    expect.any(AbortSignal),
  );
  expect(result.headers["Cache-Control"]).toBe("no-store");
  await request(
    service,
    "/test-preview-settings/runbridge",
    "POST",
    JSON.stringify({
      accessFile: "/private/access.json",
      resourceId: "chromium",
      action: "connect",
    }),
  );
  expect(checkRunBridgeSettings).toHaveBeenLastCalledWith(
    process.cwd(),
    expect.objectContaining({ connect: true }),
    expect.any(AbortSignal),
  );
});
it.each([
  "null",
  '{"accessFile":5}',
  JSON.stringify({
    accessFile: "path",
    resourceId: "../outside",
    action: "connect",
  }),
])("非法远程检查参数被拒绝", async (body) => {
  expect(
    (await request(setup(), "/test-preview-settings/runbridge", "POST", body))
      .status,
  ).toBe(400);
});
