/** 独立验收 profile 的只读探针；不进入发行包，也不替代 Agent 或工具。 */
export const name = "compat-state";
export const inject = ["tools", "webServer", "connection", "configEditor"];
export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/compat-audit-config",
      handler(req, res) {
        if (!ctx.connection.authorizeIndex(req, res)) return;
        const entry = ctx.configEditor
          .entries()
          .find((row) => row.options.id === "compat-playwright");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            mcpToolCallTimeoutMs: entry?.fiber?.config?.toolCallTimeoutMs,
            mcpReady: !!ctx.tools.get("mcp__playwright__browser_snapshot"),
          }),
        );
      },
    }),
  );
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/compat-audit-state",
      handler(req, res) {
        if (!ctx.connection.authorizeIndex(req, res)) return;
        const tests = ctx.get("nativeTests");
        if (!tests) {
          res.writeHead(503);
          res.end();
          return;
        }
        void (async () => {
          const rows = [];
          for (const [id, session] of tests.sessions) {
            const idle = await Promise.race([
              session.agent.whenIdle().then(() => true),
              new Promise((done) => setTimeout(() => done(false), 200)),
            ]);
            rows.push({
              id,
              closed: session.closed,
              finalizing: session.finalizing,
              lifecycle: session.run.lifecycle,
              agentStatus: session.agent.status,
              whenIdleResolved: idle,
              pendingTools: session.pendingTools.size,
            });
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(rows));
        })();
      },
    }),
  );
}
