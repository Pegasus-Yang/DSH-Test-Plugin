/** GitLab 复杂用例准备、生成与清理入口；真实测试由 DSH /test-run 执行。 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadConfig,
  localRoot,
  privatePath,
  readState,
  writePrivate,
} from "./gitlab/config.mjs";
import { assertOwned, gitlabClient, publicGet } from "./gitlab/client.mjs";
import { comment, createPlans, seeds } from "./gitlab/plans.mjs";

function options(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--config", "--state"].includes(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error("仅支持 --config 配置路径 和 --state 准备记录路径");
    values[args[i].slice(2)] = args[i + 1];
  }
  return values;
}
function latestState() {
  try {
    return privatePath(
      JSON.parse(readFileSync(join(localRoot, "latest.json"), "utf8")).state,
    );
  } catch {
    throw new Error("没有最近准备记录，请先执行 pnpm gitlab:prepare");
  }
}
export function generate(config, stateFile) {
  const state = readState(stateFile);
  const plans = createPlans(config, state);
  const directory = resolve(stateFile, "..");
  for (const [name, plan] of Object.entries(plans))
    writePrivate(join(directory, name + ".json"), plan);
  // 可分别验收单一 UI 流程；不需要编辑含凭据的完整文件。
  for (const item of plans.ui.cases)
    writePrivate(join(directory, item.case_id + ".json"), {
      ...plans.ui,
      suite_id: item.case_id,
      cases: [item],
    });
  console.log("已生成 4 条 UI 场景、13 条纯接口场景（包括分页的四次请求）。");
  console.log("/test-run " + join(directory, "api.json"));
  console.log("/test-run " + join(directory, "ui.json"));
  console.log("/test-run " + join(directory, "all.json"));
  return plans;
}
export async function prepare(config) {
  const client = await gitlabClient(config);
  const marker =
    "dsh-gitlab-" +
    new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14) +
    "-" +
    randomBytes(4).toString("hex");
  const stateFile = join(localRoot, marker, "state.json");
  let state;
  try {
    const namespaces = await client.request(
      "GET",
      "/namespaces?search=" + encodeURIComponent(client.user.username),
    );
    const namespace = namespaces.find(
      (n) => n.kind === "user" && n.path === client.user.username,
    );
    if (!namespace)
      throw new Error("未找到账号个人命名空间；需要允许该账号创建公开项目");
    state = {
      schema_version: "1",
      status: "preparing",
      marker,
      created_at: new Date().toISOString(),
      origin: config.origin,
      owner_id: client.user.id,
      namespace_id: namespace.id,
      namespace_path: namespace.full_path,
      account: { secret: config.username },
      projects: {},
    };
    writePrivate(stateFile, state);
    writePrivate(join(localRoot, "latest.json"), { state: stateFile });
    for (const role of ["api", "ui"]) {
      const project = await client.request(
        "POST",
        "/projects",
        {
          name: marker + "-" + role,
          path: marker + "-" + role,
          namespace_id: namespace.id,
          visibility: "public",
          description: marker + "：仅用于 DSH GitLab 验收",
          initialize_with_readme: false,
        },
        201,
      );
      state.projects[role] = {
        id: project.id,
        path: project.path,
        path_with_namespace: project.path_with_namespace,
        issues: [],
      };
      writePrivate(stateFile, state);
      const base = "/projects/" + project.id;
      for (const [name, color] of [
        ["dsh-smoke", "#3b82f6"],
        ["dsh-regression", "#a78bfa"],
      ])
        await client.request("POST", base + "/labels", { name, color }, 201);
      for (const seed of seeds) {
        const item = await client.request(
          "POST",
          base + "/issues",
          {
            title: seed.title,
            description: seed.description,
            labels: seed.labels,
          },
          201,
        );
        state.projects[role].issues.push({ id: item.id, iid: item.iid });
        writePrivate(stateFile, state);
        if (seed.state === "closed")
          await client.request("PUT", base + "/issues/" + item.iid, {
            state_event: "close",
          });
      }
      const note = await client.request(
        "POST",
        base + "/issues/" + state.projects[role].issues[0].iid + "/notes",
        { body: comment },
        201,
      );
      state.projects[role].seed_note_id = note.id;
      writePrivate(stateFile, state);
      const anonymous = await publicGet(config.origin, base);
      if (anonymous.status !== 200 || anonymous.body.id !== project.id)
        throw new Error(
          "专用项目不能匿名读取；请检查 GitLab public 可见性策略。当前插件的可信接口采集只支持无认证 GET JSON",
        );
    }
    state.status = "prepared";
    writePrivate(stateFile, state);
    generate(config, stateFile);
    console.log("准备记录：" + stateFile);
    console.log(
      "运行 UI 后如需重跑，请重新 prepare；每次生成新项目，旧记录会保留。",
    );
    return stateFile;
  } catch (error) {
    if (state) {
      state.status = "preparation_failed";
      writePrivate(stateFile, state);
      console.error(
        "已保留失败准备记录，可使用 pnpm gitlab:cleanup --state " +
          stateFile +
          " 清理本次专用项目。",
      );
    }
    throw error;
  } finally {
    await client.close();
  }
}
export async function cleanup(config, stateFile) {
  const state = readState(stateFile, false);
  if (state.origin !== config.origin)
    throw new Error("准备记录与配置地址不一致，拒绝清理");
  const client = await gitlabClient(config);
  try {
    if (client.user.id !== state.owner_id)
      throw new Error("当前登录账号不是本次准备账号，拒绝清理");
    // 创建响应丢失时仍按本次精确路径查找，先核对归属，不重发创建。
    const targets = ["api", "ui"].map((role) => ({
      role,
      id:
        state.projects[role]?.id ??
        state.namespace_path + "/" + state.marker + "-" + role,
      path: state.marker + "-" + role,
    }));
    targets.push({
      role: "created",
      id:
        state.created_project_id ??
        state.namespace_path + "/" + state.marker + "-created",
      path: state.marker + "-created",
    });
    for (const target of targets) {
      const encoded = encodeURIComponent(target.id);
      const existing = await client.request(
        "GET",
        "/projects/" + encoded,
        undefined,
        [200, 404],
      );
      if (existing.status === 404) continue;
      const project = existing.body;
      assertOwned(project, state, client.user, target);
      // 找回响应未知的资源后先保存 ID，避免标记删除重命名后丢失归属。
      if (target.role === "created") state.created_project_id = project.id;
      else if (!state.projects[target.role])
        state.projects[target.role] = { id: project.id, path: target.path };
      writePrivate(stateFile, state);
      if (!project.marked_for_deletion_on && !project.marked_for_deletion_at)
        await client.request(
          "DELETE",
          "/projects/" + project.id,
          undefined,
          202,
        );
      let gone = false;
      let permanentRequested = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const remaining = await client.request(
          "GET",
          "/projects/" + project.id,
          undefined,
          [200, 404],
        );
        if (remaining.status === 404) {
          gone = true;
          break;
        }
        if (
          !permanentRequested &&
          (remaining.body.marked_for_deletion_on ||
            remaining.body.marked_for_deletion_at)
        ) {
          // GitLab 新版本先标记延迟删除；只永久清理再次核对过的本次专用项目。
          assertOwned(remaining.body, state, client.user, target);
          await client.request(
            "DELETE",
            "/projects/" +
              project.id +
              "?permanently_remove=true&full_path=" +
              encodeURIComponent(remaining.body.path_with_namespace),
            undefined,
            202,
          );
          permanentRequested = true;
        }
        await new Promise((done) => setTimeout(done, 1000));
      }
      if (!gone)
        throw new Error(
          "GitLab 已受理删除但项目仍可访问。准备记录已保留，稍后再次 cleanup 核对",
        );
    }
    state.status = "cleaned";
    state.cleaned_at = new Date().toISOString();
    writePrivate(stateFile, state);
    console.log(
      "本次专用项目已清理，并逐个通过登录会话核对 GET 返回 404；本地用例和报告仍保留。",
    );
  } finally {
    await client.close();
  }
}
export async function main(args = process.argv.slice(2)) {
  const [mode, ...rest] = args;
  if (!["prepare", "generate", "cleanup"].includes(mode))
    throw new Error(
      "用法：node scripts/gitlab.mjs prepare|generate|cleanup [--config .local/gitlab/config.json] [--state .local/gitlab/本次目录/state.json]",
    );
  const opts = options(rest);
  const config = loadConfig(opts.config);
  if (mode === "prepare") {
    if (opts.state)
      throw new Error("prepare 自动创建新准备记录，不接受 --state");
    return prepare(config);
  }
  const stateFile = opts.state ? privatePath(opts.state) : latestState();
  return mode === "generate"
    ? generate(config, stateFile)
    : cleanup(config, stateFile);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    // Playwright 的错误会附带填表实参；不向终端转发含凭据的原始异常。
    console.error(
      "GitLab 用例操作失败：" +
        error.message +
        "。详见 doc/user-guide/GitLab复杂用例.md。",
    );
    process.exitCode = 1;
  });
