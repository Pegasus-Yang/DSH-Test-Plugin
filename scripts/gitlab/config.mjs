/** GitLab 验收的私有配置与本地文件；凭据不写入可提交目录。 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

export const localRoot = resolve(".local/gitlab");

export function privatePath(file) {
  const full = resolve(file);
  let parent = full;
  while (!existsSync(parent)) parent = dirname(parent);
  const root = existsSync(localRoot) ? realpathSync(localRoot) : localRoot;
  const actual = resolve(realpathSync(parent), relative(parent, full));
  const rel = relative(root, actual);
  if (!rel || rel === ".." || rel.startsWith(".." + sep))
    throw new Error("私有配置和生成文件必须放在当前项目的 .local/gitlab/ 内");
  return full;
}

export function loadConfig(file = resolve(localRoot, "config.json")) {
  const full = privatePath(file);
  if (!existsSync(full))
    throw new Error(
      "缺少私有配置。请将 examples/gitlab/config.example.json 复制为 .local/gitlab/config.json，再填写本机账号。",
    );
  if ((statSync(full).mode & 0o077) !== 0)
    throw new Error(
      "私有配置权限过宽，请执行 chmod 600 .local/gitlab/config.json",
    );
  let config;
  try {
    config = JSON.parse(readFileSync(full, "utf8"));
  } catch {
    throw new Error("私有配置必须是有效 JSON；请检查逗号和双引号");
  }
  for (const key of ["sign_in_url", "username", "password"])
    if (
      typeof config[key] !== "string" ||
      !config[key].trim() ||
      /^<.*>$/.test(config[key])
    )
      throw new Error("私有配置缺少有效字段：" + key);
  let url;
  try {
    url = new URL(config.sign_in_url);
  } catch {
    throw new Error("sign_in_url 必须是完整网址");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/users/sign_in"
  )
    throw new Error(
      "sign_in_url 应为 http(s)://主机:端口/users/sign_in，不带账号、查询参数或片段",
    );
  if (
    config.browser_channel !== undefined &&
    !["chrome", "chromium"].includes(config.browser_channel)
  )
    throw new Error("browser_channel 仅支持 chrome 或 chromium");
  return { ...config, origin: url.origin };
}

export function writePrivate(file, value) {
  return writePrivateText(file, JSON.stringify(value, null, 2) + "\n");
}

export function writePrivateText(file, text) {
  const full = privatePath(file);
  mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
  // 不覆盖符号链接；已存在文件也重新检查权限。
  if (existsSync(full) && lstatSync(full).isSymbolicLink())
    throw new Error("私有输出文件不能是符号链接");
  if (existsSync(full) && (statSync(full).mode & 0o077) !== 0)
    throw new Error("本地文件权限过宽，请先设为 600：" + full);
  writeFileSync(full, text, { mode: 0o600 });
  return full;
}

export function readState(file, requirePrepared = true) {
  let state;
  try {
    state = JSON.parse(readFileSync(privatePath(file), "utf8"));
  } catch {
    throw new Error("找不到有效准备记录，请先执行 pnpm gitlab:prepare");
  }
  if (
    state.schema_version !== "1" ||
    !/^dsh-gitlab-[a-z0-9-]+$/.test(state.marker) ||
    !Number.isInteger(state.owner_id)
  )
    throw new Error("准备记录结构不正确，不能用于生成或清理");
  for (const [role, project] of Object.entries(state.projects ?? {}))
    if (
      !["api", "ui"].includes(role) ||
      !Number.isInteger(project.id) ||
      project.path !== state.marker + "-" + role
    )
      throw new Error("准备记录缺少独立测试项目：" + role);
  if (
    requirePrepared &&
    (state.status !== "prepared" || !state.projects?.api || !state.projects?.ui)
  )
    throw new Error("数据尚未准备完成；请使用该准备记录清理残留，然后重新准备");
  if (
    requirePrepared &&
    Object.values(state.projects).some(
      (p) =>
        p.issues?.length !== 3 ||
        p.issues.some((i) => !Number.isInteger(i.iid) || i.iid < 1),
    )
  )
    throw new Error("准备记录缺少完整的三条固定 Issue，不能生成用例");
  return state;
}
