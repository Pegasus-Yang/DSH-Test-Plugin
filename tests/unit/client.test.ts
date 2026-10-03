import { it, expect, vi } from "vitest";
import { apply, inject, progressDefinition } from "../../src/client.js";

it("进度关联宿主原生命令事件，只为测试命令建立节点", () => {
  const event = {
    type: "command/run",
    data: { commandId: "cmd-1", name: "test-run" },
  };
  expect(progressDefinition.match(event as never)).toEqual({
    id: "cmd-1",
    role: "start",
  });
  expect(
    progressDefinition.match({
      ...event,
      data: { ...event.data, name: "test-stop" },
    } as never),
  ).toBeNull();
  expect(
    progressDefinition.match({
      type: "command/done",
      data: { commandId: "cmd-1" },
    } as never),
  ).toEqual({ id: "cmd-1", role: "update" });
});

it("按钮先刷新会话目录，停止使用当前快照中的发起会话及运行ID", async () => {
  let render!: (props: unknown) => {
    props: {
      open: (id: string) => Promise<void>;
      stop: (p: unknown) => Promise<void>;
    };
  };
  let refreshed = false;
  const execute = vi.fn(async () => ({
    ok: true,
    value: { result: { kind: "success" } },
  }));
  const services = {
    uiConversation: { events: { register() {} } },
    slots: {
      inject: (_: string, fn: () => void) => fn(),
      register: (_: unknown, fn: typeof render) => {
        render = fn;
      },
    },
    sessions: {
      refresh: async () => {
        refreshed = true;
      },
    },
    uiWorkspace: {
      openSession: (id: string) => {
        expect(refreshed).toBe(true);
        expect(id).toBe("execution");
      },
    },
    remote: { commands: { execute } },
  };
  // 模拟Cordis依赖约束：声明子服务不能替代父服务remote的注入。
  const ctx = new Proxy(services, {
    get(target, key) {
      if (!inject.includes(String(key)))
        throw new Error(`未注入 ${String(key)}`);
      return Reflect.get(target, key);
    },
  });
  apply(ctx as never);
  const element = render({ node: { data: { id: "cmd-1", sessionId: "" } } });
  await element.props.open("execution");
  await element.props.stop({
    id: "cmd-1",
    runId: "run-1",
    sessionId: "origin",
  });
  expect(execute).toHaveBeenCalledWith("origin", "/test-stop run-1", []);
});
