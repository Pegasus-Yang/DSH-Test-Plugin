# DeepSeek Harness Test Plugin

[简体中文](README.md) | English

A TypeScript plugin that adds test planning, UI/API execution, evidence capture, deterministic assertions, and static HTML reports to **the current DeepSeek Harness (DSH) conversation**. Describe a task in natural language or run a prepared JSON test suite. The plugin uses DSH's normal model loop, tools, approvals, and conversation persistence; it does not create a separate execution agent or modify the host core.

Current version: **0.8.2 (development release)**. Environment status and release controls live in **Settings → 测试插件 → 测试环境**. A test command blocked by quarantine shows a notice only in the conversation that submitted it, directing the user to release the environment in settings and retry. Ordinary conversations without test commands show no quarantine warning. Confirmation, elapsed-time alerts, failure handling, preview settings, and the CDP/first-frame gate remain. See the [recovery guide (Chinese)](doc/user-guide/测试环境卡住怎么办.md), [preview setup guide (Chinese)](doc/user-guide/浏览器实时预览一步一步配置.md), and [development record (Chinese)](doc/project/开发进度.md).

## Features

| Feature | Behavior |
| --- | --- |
| Natural-language tests | `/test` breaks a request into business steps and textual checks, announces the plan, then runs it |
| Review before execution | `/test-plan` uses native plan mode; request changes or approve the current draft |
| Adaptive execution | Planning does not visit the target; concrete tools, selectors, and capture parameters are chosen during each step |
| Browser automation | A dedicated Playwright MCP browses, searches, clicks, and captures DOM observations and screenshots |
| API testing | Capture HTTP GET JSON responses and assert status codes or response fields; no browser required |
| Deterministic assertions | Compute results from captured observations and sourced expectations, rather than a model's claim of success |
| Conversation progress | Keep the original task, approach, steps, tool results, approvals, and final summary in the same conversation |
| Static reports | Inspect steps, assertions, actual/expected values, calls, and attachments; receive a report link and save location |
| Stop and cleanup | Stop business actions, settle in-flight work, then run preauthorized cleanup in the same conversation |
| JSON suites | Support multiple cases and datasets, dependencies, setup, cleanup, and an event ledger |
| Files and parameters | One case per nonblank TXT line or top-level Markdown list item; CSV headers name parameters and each data record expands into a reviewed instance |

## Install in local DSH

### 1. Build the plugin

You need Node.js **22.19+**, pnpm **11.7.0**, and a locally built DSH **0.2.1-alpha.1** with a working model configuration. Acceptance used Node.js 22.22.3. Revalidate compatibility before using another DSH version. Install and build the host according to its own documentation first.

Run these commands in the plugin checkout, replacing the absolute paths:

```sh
cd /absolute/path/DeepseekHarnessTestPlugin
pnpm install
node scripts/link-host.mjs /absolute/path/deepseek-harness
pnpm typecheck
pnpm build
pnpm pack --out artifacts/package/dsh-test-plugin.tgz
```

`link-host` links development dependencies to locally built host packages and records the host path in `.local/host.json`. It does not modify host source files. For browser tests, also install the Chromium versions used by the pinned MCP and validation dependencies:

```sh
node scripts/install-browser.mjs
```

API-only tests do not require this browser installation.

### 2. Install into the web profile

Run from the **DSH source checkout**:

```sh
cd /absolute/path/deepseek-harness
pnpm dsh plugin --profile web add /absolute/path/DeepseekHarnessTestPlugin/artifacts/package/dsh-test-plugin.tgz
```

If you already have a standalone `dsh` CLI, use `dsh` instead of `pnpm dsh`. Installation uses the user's default DSH home unless `DSH_HOME` is set. Use the same home when installing and starting the host.

**Keep the installed tgz file.** The profile records it as a local `file:` dependency. Use the stable filename `dsh-test-plugin.tgz` for subsequent builds. If an old archive was deleted and installation reports ENOENT, follow the [old-path recovery procedure](doc/deployment/安装与运维.en.md#recover-from-a-deleted-package-path): remove the dependency by package name, then add the new archive. Do not delete the whole profile.

For development updates at the same archive path, run `pnpm dsh plugin --profile web remove dsh-test-plugin` before the `add` command above. Re-adding the same path and version was observed to reuse old files. Restart the service and refresh the page after installation.

### 3. Configure the workspace and MCP, then start DSH

The bundle registers the plugin but does not configure a model or a browser. Create `/absolute/path/DeepseekHarnessTestPlugin/.local/dsh-test.patch.yml` using the [deployment configuration](doc/deployment/安装与运维.en.md#configure-the-installed-plugin). Set `workspace`, `outputRoot`, native tool mode, and a dedicated Playwright MCP for UI tests. Omit the MCP entry for API-only tests.

From the DSH checkout, start the host on an available port. If a service is already running, stop it normally and retain its existing startup options when adding this patch:

```sh
pnpm dsh web --patch /absolute/path/DeepseekHarnessTestPlugin/.local/dsh-test.patch.yml --port 3080
```

Open the address printed by DSH, enter your test workspace, and create a conversation using the standard preset. After an upgrade, restart the host for the same profile and refresh the page. The bundle already registers `harness-test`; the patch updates that entry rather than inserting a second instance.

## Run your first tests

Enter the following commands in the **DSH conversation input**, not in a terminal.

Run multiple cases without writing a JSON contract:

```text
/test-run examples/httpbin-cases.txt
/test-run examples/httpbin-cases.md
/test-plan --file examples/httpbin-cases.md
```

TXT uses nonblank lines; Markdown uses top-level ordered or unordered list items, preserving nested steps and code blocks inside each case. The first two commands announce all plans and execute; the third requires review.

Parameterization always requires native plan review:

```text
/test-data examples/httpbin-parameters.csv Request https://httpbin.org/get?keyword=${keyword} and verify status 200 and returned keyword ${keyword}.
/test-data examples/httpbin-parameters.csv --file examples/httpbin-parameterized.md
```

CSV headers are parameter names. Every source case uses every data record: 2 cases × 2 rows produces 4 instances. Review shows all parameter values, original and expanded tasks, counts, and each instance's steps. Values such as `001` and empty strings are preserved; substitution is a single text-replacement pass. Inputs use the read snapshot; cancel and resubmit after editing a source file. The included case files are Chinese examples; you can write your own TXT/Markdown cases in English.

Plan and execute a browser test immediately:

```text
/test Visit ceshiren.com, search for agent, open the first search-result post, and assert that the post's like count is not 0.
```

Review an API test plan before running:

```text
/test-plan Send a GET request to https://httpbin.org/get?keyword=agent&client=dsh and verify HTTP status 200, returned keyword agent, and client dsh.
```

The review contains **Original task, Approach, and Steps**. Request changes and provide feedback, or approve the current draft to execute. `/test` announces the same information and proceeds without confirmation. If the expectation is missing, the model asks in the current conversation. You do not need to invent selectors or response structures before visiting the target.

Run an existing JSON example inside the configured workspace:

```text
/test-run examples/ceshiren-agent.json
/test-run examples/httpbin-get.json
```

Run these examples separately. Paths resolve against the plugin's `workspace`; copy the examples into that directory if you use another workspace. `/test-run` accepts TXT, Markdown, or JSON paths; use `/test` or `/test-plan` for an inline task. Quote file paths containing spaces.

| Command | Purpose |
| --- | --- |
| `/test-status` | Show the current conversation's test state |
| `/test-stop` | Stop business work and perform permitted cleanup; native Stop also works |
| `/test-report [run-id]` | Rebuild a report; omit the ID to use only this conversation's run |
| `/test-release <resolution-json-path>` | Record verified stop/reset evidence and release a quarantined environment |

User-facing explanations follow DSH's explicit language preference. Without one, tasks containing Chinese use Chinese; other tasks fall back to English. Completed tool calls may be collapsed by DSH; expand them or open the trace view. See the [user guide](doc/user-guide/使用说明.en.md) for details.

## Reports and evidence

The conversation's input area shows the current test's steps and elapsed wall time, including waits. “查看步骤” opens details. With [optional Browscreen configuration (Chinese)](doc/deployment/安装与运维.md#浏览器实时预览可选), “实时画面” opens a read-only native floating panel. API-only tasks and tasks without usable CDP never open an empty preview. The first release supports one active page and does not add an App test adapter.

The final response includes a **report link and full save location**; you do not need to find the run ID yourself. HTTP links use the DSH server and its authentication. The report is static HTML and can also be opened offline without a separate report server.

Each run gets its own directory under `outputRoot`:

```text
artifacts/runs/<run-id>/
├── plan.json       # Original plan
├── events.jsonl    # Event ledger
├── results.json   # Results, observations, and assertions
├── evidence/      # Screenshots and response evidence
└── report.html    # Static report
```

Inspect the overview, case filters, steps, assertions, attachments, and run information to compare actual values, expectations, and their sources. Copy the whole directory to retain all evidence. `/test-report` rebuilds `report-rebuilt.html` and `results-rebuilt.json` from the ledger without overwriting original results or calling the model or business tools again.

## Current limitations

- Only DSH native tool mode is supported. Run serially in a shared environment; browser tools must use the `mcp__playwright__` prefix.
- Trusted API capture currently supports **GET JSON**, not POST or custom request bodies.
- JSON test execution still uses DSH's model loop. Model-free report reconstruction is not model-free test replay.
- Natural-language plans and locators may need retries. Simple numeric checks have additional validation; this is not a complete proof of arbitrary natural-language intent.
- Conversations can use English, but the report UI and some command messages remain primarily Chinese.
- Cancellation, missing evidence, tool errors, and failed cleanup are not counted as passing. Unexecuted design checks remain unverified.

## Development and documentation

After installing dependencies, linking the host, building, and installing the browser, you can start an isolated development environment from the plugin checkout:

```sh
node scripts/start-host.mjs
```

The helper defaults to port 13379, loads local `dist`, and reads specific model settings and credential references from an existing `~/.dsh`. It is not a replacement for installing into an existing profile. See [isolated development](doc/deployment/安装与运维.en.md#isolated-development-environment) for its assumptions and variables. The authenticated address is stored in `.local/host-state.json`; keep that file private.

```sh
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:integration
```

Real UI acceptance requires a running DSH, model, and appropriate tools; a successful build does not establish end-to-end correctness. Generated output, run records, logs, and local settings are excluded by `.gitignore`.

- [User guide](doc/user-guide/使用说明.en.md)
- [Installation and deployment](doc/deployment/安装与运维.en.md)
- [Documentation index (Chinese, with English entry points)](doc/README.md)
- [Architecture (Chinese)](doc/architecture/当前实现.md)
- [Development and acceptance record (Chinese)](doc/project/开发进度.md)

License: [MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
