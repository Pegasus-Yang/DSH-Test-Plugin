import { afterAll, afterEach, expect, it, vi } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const transport = vi.hoisted(() => ({
  request: vi.fn(),
  close: vi.fn(),
  anonymous: vi.fn(),
  user: { id: 11, username: "fixture-login" },
}));
vi.mock("../../scripts/gitlab/client.mjs", async (original) => ({
  ...(await original()),
  gitlabClient: async () => ({
    request: transport.request,
    close: transport.close,
    user: transport.user,
  }),
  publicGet: transport.anonymous,
}));
vi.mock("../../scripts/gitlab/config.mjs", async (original) => {
  const actual = (await original()) as any;
  const { randomUUID } = await import("node:crypto");
  return {
    ...actual,
    localRoot: join(actual.localRoot, "lifecycle-" + randomUUID()),
  };
});
import { cleanup, prepare } from "../../scripts/gitlab.mjs";
import {
  localRoot,
  readState,
  writePrivate,
} from "../../scripts/gitlab/config.mjs";

afterEach(() => vi.resetAllMocks());
afterAll(() => rmSync(localRoot, { recursive: true, force: true }));
const config = {
  origin: "http://localhost:8929",
  username: "fixture-login",
  password: "private-fixture-only",
};
const state = () => ({
  schema_version: "1",
  status: "prepared",
  origin: config.origin,
  marker: "dsh-gitlab-lifecycle-123",
  owner_id: 11,
  namespace_id: 22,
  namespace_path: config.username,
  account: { secret: config.username },
  projects: {
    api: { id: 30, path: "dsh-gitlab-lifecycle-123-api" },
    ui: { id: 31, path: "dsh-gitlab-lifecycle-123-ui" },
  },
});
const project = () => ({
  id: 30,
  path: state().projects.api.path,
  namespace: { id: 22 },
  path_with_namespace: config.username + "/" + state().projects.api.path,
  description: state().marker + "：仅用于 DSH GitLab 验收",
});
function record(name, value = state()) {
  const file = join(localRoot, name + ".json");
  writePrivate(file, value);
  return file;
}

it("已删除资源可重复清理，使用认证查询，不借匿名 404 判断不存在", async () => {
  const file = record("gone");
  transport.request.mockResolvedValue({
    status: 404,
    body: { message: "404 Project Not Found" },
  });
  await cleanup(config, file);
  expect(transport.request).toHaveBeenCalledTimes(3);
  expect(
    transport.request.mock.calls.every(([method]) => method === "GET"),
  ).toBe(true);
  expect(transport.anonymous).not.toHaveBeenCalled();
  expect(readState(file, false).status).toBe("cleaned");
  expect(transport.close).toHaveBeenCalledOnce();
});

it("延迟删除只对再次核对的专用项目发起永久删除并验证 404", async () => {
  const file = record("delayed");
  const scheduled = {
    ...project(),
    marked_for_deletion_on: "fixture-date",
    path: project().path + "-deletion_scheduled-30",
    path_with_namespace:
      project().path_with_namespace + "-deletion_scheduled-30",
  };
  let reads = 0;
  transport.request.mockImplementation(async (method, path) => {
    if (method === "DELETE") return { message: "202 Accepted" };
    if (path === "/projects/30")
      return ++reads < 3
        ? { status: 200, body: scheduled }
        : { status: 404, body: {} };
    return { status: 404, body: {} };
  });
  await cleanup(config, file);
  const deletes = transport.request.mock.calls.filter(
    ([method]) => method === "DELETE",
  );
  expect(deletes).toHaveLength(1);
  expect(deletes[0][1]).toBe(
    "/projects/30?permanently_remove=true&full_path=" +
      encodeURIComponent(scheduled.path_with_namespace),
  );
  expect(readState(file, false).status).toBe("cleaned");
});

it("延迟删除期间归属变化则拒绝永久删除并保留准备记录", async () => {
  const file = record("changed");
  let reads = 0;
  transport.request.mockImplementation(async (method, path) => {
    if (method === "DELETE") return { message: "202 Accepted" };
    return {
      status: 200,
      body:
        ++reads === 1
          ? project()
          : {
              ...project(),
              marked_for_deletion_on: "fixture-date",
              namespace: { id: 999 },
            },
    };
  });
  await expect(cleanup(config, file)).rejects.toThrow("拒绝");
  expect(
    transport.request.mock.calls.filter(([method]) => method === "DELETE"),
  ).toHaveLength(1);
  expect(readState(file, false).status).toBe("prepared");
  expect(transport.close).toHaveBeenCalledOnce();
});

it("准备响应丢失时保留失败记录，清理能够按精确路径找到未知资源", async () => {
  const failed = { ...state(), status: "preparation_failed", projects: {} };
  const file = record("unknown", failed);
  transport.request.mockImplementation(async (method, path) => {
    if (
      path ===
      "/projects/" + encodeURIComponent(config.username + "/" + project().path)
    )
      return { status: 200, body: project() };
    return method === "DELETE"
      ? { message: "202 Accepted" }
      : { status: 404, body: {} };
  });
  await cleanup(config, file);
  expect(
    transport.request.mock.calls.some(
      ([method, path]) => method === "DELETE" && path === "/projects/30",
    ),
  ).toBe(true);
  expect(readState(file, false).status).toBe("cleaned");
});

it("创建请求出错时不自动重发，已保存记录可以用于后续清理", async () => {
  transport.request.mockImplementation(async (method, path) => {
    if (method === "GET" && path.startsWith("/namespaces"))
      return [
        {
          id: 22,
          kind: "user",
          path: config.username,
          full_path: config.username,
        },
      ];
    throw new Error("模拟创建响应丢失");
  });
  const logger = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(prepare(config)).rejects.toThrow("模拟创建响应丢失");
    const file = JSON.parse(
      readFileSync(join(localRoot, "latest.json"), "utf8"),
    ).state;
    expect(readState(file, false).status).toBe("preparation_failed");
    expect(() => readState(file)).toThrow("尚未准备完成");
    expect(
      transport.request.mock.calls.filter(([method]) => method === "POST"),
    ).toHaveLength(1);
    expect(transport.close).toHaveBeenCalledOnce();
  } finally {
    logger.mockRestore();
  }
});
