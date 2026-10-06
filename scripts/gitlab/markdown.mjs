/** 将用户 Markdown 模板绑定到私有配置和准备记录，不使用实际响应生成预期。 */
import { readFileSync } from "node:fs";
import { parseCases, substitute } from "../../dist/case-input.js";
import { seeds, validateBinding } from "./plans.mjs";

function code(value) {
  const text = String(value);
  const fence = "`".repeat(
    Math.max(
      1,
      ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1),
    ),
  );
  return fence + " " + text + " " + fence;
}

export function createMarkdownPlans(config, state) {
  validateBinding(config, state);
  const origin = config.origin;
  const ui = state.projects.ui;
  const api = state.projects.api;
  const list = origin + "/" + ui.path_with_namespace + "/-/work_items";
  const draft = state.marker + "-cancelled-draft";
  const endpoint = (path) => origin + "/api/v4" + path;
  const bindings = {
    sign_in_url: config.sign_in_url,
    username: config.username,
    password: config.password,
    work_items_url: list,
    work_items_path: new URL(list).pathname,
    new_issue_url: list + "/new?type=issue",
    closed_title: seeds[2].title,
    closed_iid: ui.issues[2].iid,
    closed_api_url: endpoint(
      "/projects/" + ui.id + "/issues?state=closed&labels=dsh-smoke",
    ),
    draft_title: draft,
    draft_api_url: endpoint(
      "/projects/" + ui.id + "/issues?search=" + encodeURIComponent(draft),
    ),
    api_project_id: api.id,
    api_project_path: api.path,
    project_search_url: endpoint(
      "/projects?search=" + encodeURIComponent(api.path) + "&simple=true",
    ),
    missing_project_url: endpoint(
      "/projects/" +
        encodeURIComponent(
          state.namespace_path + "/" + state.marker + "-missing",
        ),
    ),
    ...Object.fromEntries(
      [1, 2, 3, 4].map((page) => [
        "page_" + page + "_url",
        endpoint(
          "/projects/" +
            api.id +
            "/issues?order_by=created_at&sort=asc&per_page=1&page=" +
            page,
        ),
      ]),
    ),
    ...Object.fromEntries(
      ["alpha", "beta", "gamma"].flatMap((name, index) => [
        [name + "_iid", api.issues[index].iid],
        [name + "_title", seeds[index].title],
      ]),
    ),
  };
  const values = Object.fromEntries(
    Object.entries(bindings).map(([key, value]) => [key, code(value)]),
  );
  const render = (filename) =>
    substitute(
      readFileSync(
        new URL("../../examples/gitlab/" + filename, import.meta.url),
        "utf8",
      ),
      values,
    );
  const webpage = render("ui-cases.md");
  const apiCases = render("api-cases.md");
  const uiCases = parseCases(webpage, ".md");
  const apiInput = parseCases(apiCases, ".md");
  return {
    ui: webpage,
    api: apiCases,
    all: webpage + "\n\n" + apiCases,
    ui_filters: uiCases.context + "\n\n" + uiCases.templates[0].text + "\n",
    ui_draft_cancel:
      uiCases.context + "\n\n" + uiCases.templates[1].text + "\n",
    api_project_search:
      apiInput.context + "\n\n" + apiInput.templates[0].text + "\n",
    api_pagination:
      apiInput.context + "\n\n" + apiInput.templates[1].text + "\n",
    api_missing_project:
      apiInput.context + "\n\n" + apiInput.templates[2].text + "\n",
  };
}
