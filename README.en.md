# DSH Test Plugin

**Plan and execute tests, capture evidence, and generate reports inside a DeepSeek Harness conversation.**

[简体中文](README.md) · English

[Version v0.8.3](https://github.com/Pegasus-Yang/DSH-Test-Plugin/tree/v0.8.3) · [Changelog (Chinese)](changelog.md) · [MIT License](LICENSE) · [Documentation](doc/README.md) · [Issues](https://github.com/Pegasus-Yang/DSH-Test-Plugin/issues)

DSH Test Plugin is a native TypeScript plugin for DeepSeek Harness (DSH), supporting browser tests and HTTP GET JSON checks. It uses the current conversation's model, tools, approvals, and persistence, evaluates assertions against captured observations and sourced expectations, and produces static HTML reports.

Describe a test in the DSH input:

```text
/test Visit ceshiren.com, search for agent, open the first search-result post, and assert that its like count is not 0.
```

The plugin presents a text plan, executes each step with progress updates, and returns the result and report link. Use `/test-plan` to review the plan before execution.

> This is a development release validated with DSH `0.2.1-alpha.1`. Build and install it first. Website content and model execution can change; the recorded observations, assertions, and cleanup status determine the final result.

## Features

| Feature | Description |
| --- | --- |
| Natural-language plans | Split tasks into business actions and textual checks; review or revise plans through native approval |
| Browser and API tests | Operate a dedicated Playwright MCP browser; capture GET JSON responses and check status codes or fields |
| Evidence-based assertions | Preserve actual observations, expectations, and their sources; compute results deterministically |
| Files and parameters | Import TXT, Markdown, or JSON cases; expand CSV data and review before running |
| Execution progress | Show the current step, settled count, and elapsed time; expand the bounded list for long text and continuous batch numbering |
| Live browser preview | Display headless browser frames through Browscreen after the current page has usable CDP and a valid first frame |
| Reports and cleanup | Static HTML reports with steps, assertions, and attachments; stop, cleanup, and environment recovery |

## Quick start

### 1. Prerequisites

- Node.js **22.19+** and pnpm **11.7.0**.
- A locally built DeepSeek Harness **0.2.1-alpha.1** with a working model configuration.
- Browser tests require a dedicated Playwright MCP and Chromium; API-only tests can skip browser installation.

Build the host according to its own documentation. Revalidate compatibility after changing the host or MCP version.

### 2. Clone, build, and package

```sh
git clone https://github.com/Pegasus-Yang/DSH-Test-Plugin.git
cd DSH-Test-Plugin
pnpm install
node scripts/link-host.mjs /absolute/path/deepseek-harness
pnpm build
pnpm pack --out artifacts/package/dsh-test-plugin.tgz
```

Replace the sample host path. `link-host` links development dependencies inside the plugin checkout and stores local paths under the Git-ignored `.local/` directory.

For browser tests, also run from the plugin root:

```sh
node scripts/install-browser.mjs
```

### 3. Install in DSH

Run from the **DSH source checkout**, replacing the archive path:

```sh
pnpm dsh plugin --profile web add /absolute/path/DSH-Test-Plugin/artifacts/package/dsh-test-plugin.tgz
```

Use `dsh` instead of `pnpm dsh` if you have the standalone CLI. Configure the test `workspace`, `outputRoot`, native tool mode, and dedicated Playwright MCP using the [deployment guide](doc/deployment/安装与运维.en.md#configure-the-installed-plugin), then restart the same Web profile and refresh the page.

**Keep the archive.** The profile uses a local `file:` dependency. Remove the installed dependency before adding an updated archive at the same path; see [installation and updates](doc/deployment/安装与运维.en.md). If using a custom `DSH_HOME`, use the same home for installation and startup.

### 4. Run tests in a conversation

Enter these commands in the **DSH input**, not a terminal. Run them separately:

```text
/test-plan Send a GET request to https://httpbin.org/get?keyword=agent and verify HTTP status 200 and returned keyword agent.
/test-run examples/httpbin-cases.md
/test-data examples/httpbin-parameters.csv --file examples/httpbin-parameterized.md
```

File paths resolve against the plugin's configured `workspace`. Copy [examples](examples) into that workspace if needed. The included case files are Chinese examples; you can write your own in English. See the [user guide](doc/user-guide/使用说明.en.md) for input formats, approval, and parameter rules.

## Live browser preview

In **Settings → 测试插件 → 浏览器实时预览**, save the Browscreen directory, capture port, and dedicated Playwright MCP. Once dependencies are ready, the next test starts capture when needed, while the browser can remain headless.

The floating preview waits for the current page's CDP and a valid first frame. API-only tests and unavailable browser frames show no empty preview. Follow the [step-by-step setup guide (Chinese)](doc/user-guide/浏览器实时预览一步一步配置.md) for dependencies and editable MCP registration.

## Commands and reports

| Command | Purpose |
| --- | --- |
| `/test <task>` | Present the plan and run immediately |
| `/test-plan <task>` | Review the plan before running |
| `/test-run <file>` | Run TXT, Markdown, or JSON cases |
| `/test-data <CSV> --file <cases>` | Expand parameters, review, and execute |
| `/test-status` / `/test-stop` | Inspect progress or stop and settle the run |
| `/test-report [run-id]` | Rebuild a report; omit the ID for the current conversation |

Steps and elapsed time appear above the composer. The final response includes a report link and save location. Reports are static HTML, available through DSH authentication or offline with the run directory. [Progress guide (Chinese)](doc/user-guide/执行步骤与进度显示.md) · [User guide](doc/user-guide/使用说明.en.md) · [Troubleshooting (Chinese)](doc/deployment/常见问题速查与处理.md)

If the environment is quarantined, open **Settings → 测试插件 → 测试环境**, confirm old external operations have stopped, follow recovery instructions, and resubmit the case. See the [recovery guide (Chinese)](doc/user-guide/测试环境卡住怎么办.md).

## Current scope

- DSH native tool mode only; shared environments run serially. Independent browsers across concurrent conversations are a [planned improvement (Chinese)](doc/design/多对话并行测试优化方案.md).
- Trusted API capture supports **GET JSON**. Automatic preview uses a local Chromium Playwright MCP and currently supports one active page.
- JSON execution still uses the model loop. Model-free report reconstruction does not provide model-free test replay.
- Reports and some command messages remain primarily Chinese. Cancellation, missing evidence, tool errors, and required cleanup failures do not count as passing.

## Development and contributing

After installing dependencies and linking the host, run from the plugin root:

```sh
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:integration
```

See [isolated development](doc/deployment/安装与运维.en.md#isolated-development-environment) for the local host and real acceptance workflow. When reporting issues, include plugin, DSH, Node.js, and MCP versions, reproduction steps, and sanitized error details. Validate relevant changes and update affected documentation before submitting them.

Keep local credentials, authenticated URLs, logs, screenshots, and run reports under `.local/` or `artifacts/`, outside public commits. Create annotated version tags using the [release guide (Chinese)](doc/deployment/版本发布与Git标签.md).

## Documentation

| Document | Contents |
| --- | --- |
| [Documentation index](doc/README.md) | English entry points, deployment, design, and historical acceptance records |
| [User guide](doc/user-guide/使用说明.en.md) | Commands, inputs, parameters, assertions, and reports |
| [Deployment guide](doc/deployment/安装与运维.en.md) | Build, install, configure, update, and run an isolated host |
| [Troubleshooting (Chinese)](doc/deployment/常见问题速查与处理.md) | Environment, preview, installation, and report problems |
| [Architecture (Chinese)](doc/architecture/当前实现.md) | Module responsibilities and execution flow |
| [Development record (Chinese)](doc/project/开发进度.md) | Validation scope and historical findings |

## License

Licensed under [MIT](LICENSE). Third-party dependencies and icon licenses are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
