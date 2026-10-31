/** 独立验收宿主的只读状态探针；不进入插件发行包。 */
export const name = "selenium-probe";
export const inject = ["tools", "webServer", "connection"];
export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/selenium-probe",
      handler(req, res) {
        if (!ctx.connection.authorizeIndex(req, res)) return;
        void (async () => {
          const tests = ctx.get("nativeTests");
          const catalog = ctx.tools
            .schemas()
            .map((s) => s.name ?? s.function?.name)
            .filter(Boolean);
          const sessions = [];
          for (const [id, session] of tests?.sessions ?? []) {
            const idle = await Promise.race([
              session.agent.whenIdle().then(() => true),
              new Promise((done) => setTimeout(() => done(false), 200)),
            ]);
            sessions.push({
              id,
              closed: session.closed,
              agent_status: session.agent.status,
              when_idle: idle,
              pending_tools: session.pendingTools.size,
              run_id: session.run.suite_run_id,
              lifecycle: session.run.lifecycle,
              phase: session.state().phase,
              operation_names: session.agent.ctx.tools.get(
                "test_execute_operation",
              )?.parameters?.properties?.tool_name?.enum,
            });
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ catalog, sessions }));
        })().catch(() => {
          res.writeHead(503);
          res.end();
        });
      },
    }),
  );
}
