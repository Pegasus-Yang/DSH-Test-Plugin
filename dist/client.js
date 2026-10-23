window.__ModuleLoader__.load({id:"dsh-test-plugin",factory:(require)=>{var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/preview-settings.tsx
var import_react6 = require("react");

// src/client/recovery-panel.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function elapsed(milliseconds) {
  const seconds = Math.floor(milliseconds / 1e3);
  if (seconds < 60) return `${seconds} \u79D2`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} \u5206 ${seconds % 60} \u79D2`;
  return `${Math.floor(minutes / 60)} \u5C0F\u65F6 ${minutes % 60} \u5206`;
}
function RecoveryPanel({
  readRecovery,
  recover,
  releaseEvidence
}) {
  const [state, setState] = (0, import_react.useState)();
  const [failed, setFailed] = (0, import_react.useState)(false);
  const [confirmation, setConfirmation] = (0, import_react.useState)();
  const [checked, setChecked] = (0, import_react.useState)(false);
  const [pending, setPending] = (0, import_react.useState)(false);
  const [message, setMessage] = (0, import_react.useState)("");
  const [error, setError] = (0, import_react.useState)(false);
  const [evidenceFile, setEvidenceFile] = (0, import_react.useState)("");
  const [evidenceConfirmation, setEvidenceConfirmation] = (0, import_react.useState)();
  (0, import_react.useEffect)(() => {
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      try {
        const next = await readRecovery(
          AbortSignal.any([controller.signal, AbortSignal.timeout(5e3)])
        );
        if (controller.signal.aborted) return;
        setState(next);
        setFailed(false);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1e3);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [readRecovery]);
  const quarantine = state?.quarantine;
  (0, import_react.useEffect)(() => {
    if (quarantine?.token) {
      setMessage("");
      setError(false);
    }
  }, [quarantine?.token]);
  (0, import_react.useEffect)(() => {
    if (confirmation !== quarantine?.token) {
      setConfirmation(void 0);
      setChecked(false);
    }
  }, [quarantine?.token, confirmation]);
  const release = async () => {
    if (!checked || !quarantine?.can_recover || confirmation !== quarantine.token || pending || failed)
      return;
    setPending(true);
    setMessage("\u6B63\u5728\u5173\u95ED\u6D4B\u8BD5\u4E13\u7528\u6D4F\u89C8\u5668\u5E76\u505C\u6B62\u9884\u89C8\uFF0C\u8BF7\u7559\u610F\u5BBF\u4E3B\u7684\u5DE5\u5177\u5BA1\u6279\u3002");
    setError(false);
    try {
      setMessage(await recover(quarantine.token));
      setConfirmation(void 0);
      setChecked(false);
    } catch (error2) {
      setMessage(error2 instanceof Error ? error2.message : String(error2));
      setError(true);
    } finally {
      setPending(false);
    }
  };
  const submitEvidence = async () => {
    if (!quarantine || evidenceConfirmation !== quarantine.token || !evidenceFile.trim() || pending || failed || state?.recovering)
      return;
    setPending(true);
    setMessage("");
    setError(false);
    try {
      setMessage(await releaseEvidence(evidenceFile.trim(), quarantine.token));
      setEvidenceConfirmation(void 0);
    } catch (error2) {
      setMessage(error2 instanceof Error ? error2.message : String(error2));
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      className: "dsh-test-recovery",
      "data-test-recovery": true,
      "data-state": quarantine || failed ? "blocked" : "ready",
      "aria-label": "\u6D4B\u8BD5\u73AF\u5883\u5904\u7F6E",
      children: [
        !state && !failed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u6B63\u5728\u8BFB\u53D6\u6D4B\u8BD5\u73AF\u5883\u72B6\u6001\u2026" }),
        state && !quarantine && !failed && !message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: "\u65E0\u5F85\u5904\u7406\u8D44\u6E90\u3002\u6B64\u72B6\u6001\u4E0D\u8868\u793A Hub \u6216\u6D4F\u89C8\u5668\u8FDE\u63A5\u5DF2\u9A8C\u8BC1\u3002" }),
        failed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: "\u65E0\u6CD5\u8BFB\u53D6\u6D4B\u8BD5\u73AF\u5883\u72B6\u6001\uFF0C\u8BF7\u68C0\u67E5\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002" }),
        quarantine && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "alert", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: quarantine.overdue ? "\u6D4B\u8BD5\u73AF\u5883\u53EF\u80FD\u5F02\u5E38\u5361\u4F4F" : "\u6D4B\u8BD5\u73AF\u5883\u9700\u8981\u5904\u7406" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: quarantine.reason }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
              quarantine.elapsed_ms === void 0 ? "\u9694\u79BB\u5F00\u59CB\u65F6\u95F4\u65E0\u6CD5\u786E\u8BA4\u3002" : `\u9694\u79BB\u5DF2\u6301\u7EED ${elapsed(quarantine.elapsed_ms)}\uFF1B\u6E05\u7406\u8D85\u65F6\u9608\u503C\u4E3A ${elapsed(quarantine.timeout_ms)}\u3002`,
              quarantine.overdue && " \u5DF2\u8D85\u8FC7\u9608\u503C\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u5904\u7406\u5E76\u91CA\u653E\u3002"
            ] })
          ] }),
          quarantine.run_id && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u67E5\u770B\u9057\u7559\u6D4B\u8BD5" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: quarantine.run_id })
          ] }),
          quarantine.unavailable_reason && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: quarantine.unavailable_reason }),
          state?.last_error && !message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: state.last_error }),
          confirmation === quarantine.token ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "div",
            {
              className: "dsh-test-recovery-confirm",
              role: "group",
              "aria-label": "\u91CA\u653E\u9694\u79BB\u786E\u8BA4",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u662F\u5426\u5173\u95ED\u6D4B\u8BD5\u4E13\u7528\u6D4F\u89C8\u5668\u5E76\u91CA\u653E\u9694\u79BB\uFF1F" }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
                  quarantine.browser_backend === "runbridge" ? "\u8FD9\u4F1A\u6838\u5BF9\u5E76\u5173\u95ED\u539F\u8BB8\u53EF\u4E0B\u7684\u8FDC\u7A0B\u6D4F\u89C8\u5668\u4F1A\u8BDD\u53CA\u9884\u89C8\u3002" : "\u8FD9\u4F1A\u5173\u95ED\u6D4B\u8BD5\u4E13\u7528\u7684\u672C\u673A\u6D4F\u89C8\u5668\u548C\u9884\u89C8\u3002",
                  "\u65E7\u6D4B\u8BD5\u7684\u9519\u8BEF\u4E0E\u62A5\u544A\u4F1A\u4FDD\u7559\uFF1B\u6210\u529F\u540E\u9700\u8981\u91CD\u65B0\u53D1\u9001\u7528\u4F8B\u3002"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "input",
                    {
                      type: "checkbox",
                      checked,
                      disabled: pending,
                      onChange: (event) => setChecked(event.target.checked)
                    }
                  ),
                  "\u6211\u5DF2\u786E\u8BA4\u65E7\u6D4B\u8BD5\u53CA\u5176\u4ED6\u5916\u90E8\u64CD\u4F5C\u5DF2\u505C\u6B62\uFF0C\u5141\u8BB8\u5173\u95ED\u6D4B\u8BD5\u4E13\u7528\u6D4F\u89C8\u5668\u3002"
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-test-actions", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      disabled: !checked || pending || failed || !quarantine.can_recover,
                      onClick: () => void release(),
                      children: "\u786E\u8BA4\u5173\u95ED\u5E76\u91CA\u653E"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      disabled: pending,
                      onClick: () => {
                        setConfirmation(void 0);
                        setChecked(false);
                      },
                      children: "\u6682\u4E0D\u91CA\u653E"
                    }
                  )
                ] })
              ]
            }
          ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-test-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              disabled: pending || failed || !quarantine.can_recover,
              onClick: () => {
                setConfirmation(quarantine.token);
                setChecked(false);
                setMessage("");
              },
              children: "\u5904\u7406\u5E76\u91CA\u653E"
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dsh-test-command-advanced", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u9AD8\u7EA7\u5904\u7F6E\uFF1A\u63D0\u4EA4\u5B9E\u9645\u5904\u7F6E\u8BC1\u636E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "\u65E0\u6CD5\u81EA\u52A8\u5173\u95ED\u6D4F\u89C8\u5668\u65F6\uFF0C\u5148\u5728\u5916\u90E8\u505C\u6B62\u65E7\u4EFB\u52A1\u5E76\u91CD\u7F6E\u5BF9\u5E94\u73AF\u5883\uFF0C\u518D\u6309\u6545\u969C\u6392\u67E5\u6307\u5357\u51C6\u5907\u8BC1\u636E\u6587\u4EF6\u3002\u63D0\u4EA4\u53EA\u8BB0\u5F55\u4F60\u7684\u5904\u7F6E\u7ED3\u679C\uFF0C\u4E0D\u4F1A\u66FF\u4F60\u5173\u95ED\u7A0B\u5E8F\u3002" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { htmlFor: "dsh-test-release-file", children: "\u5DE5\u4F5C\u533A\u5185\u7684\u5904\u7F6E\u8BC1\u636E JSON \u6587\u4EF6" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: "dsh-test-release-file",
                value: evidenceFile,
                disabled: pending,
                placeholder: "\u4F8B\u5982 recovery-evidence.json",
                onChange: (event) => {
                  setEvidenceFile(event.target.value);
                  setEvidenceConfirmation(void 0);
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-test-setting-switch", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  type: "checkbox",
                  checked: evidenceConfirmation === quarantine.token,
                  disabled: pending || failed || state?.recovering,
                  onChange: (event) => setEvidenceConfirmation(
                    event.target.checked ? quarantine.token : void 0
                  )
                }
              ),
              "\u6211\u5DF2\u505C\u6B62\u65E7\u4EFB\u52A1\u3001\u91CD\u7F6E\u5916\u90E8\u73AF\u5883\uFF0C\u5E76\u586B\u5199\u5B9E\u9645\u5904\u7F6E\u8BC1\u636E\u3002"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-test-setting-actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "button",
              {
                type: "button",
                disabled: evidenceConfirmation !== quarantine.token || !evidenceFile.trim() || pending || failed || state?.recovering,
                onClick: () => void submitEvidence(),
                children: pending ? "\u6B63\u5728\u5904\u7406\u2026" : "\u63D0\u4EA4\u8BC1\u636E\u5E76\u89E3\u9664\u9694\u79BB"
              }
            ) })
          ] })
        ] }),
        message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: error ? "alert" : "status", children: message })
      ]
    }
  );
}

// src/client/report-controls.tsx
var import_react2 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
function RebuildReport({
  rebuildReport,
  runId
}) {
  const [pending, setPending] = (0, import_react2.useState)(false);
  const [result, setResult] = (0, import_react2.useState)();
  const [error, setError] = (0, import_react2.useState)("");
  (0, import_react2.useEffect)(() => {
    setResult(void 0);
    setError("");
  }, [runId]);
  const rebuild = async () => {
    setPending(true);
    setError("");
    setResult(void 0);
    try {
      setResult(await rebuildReport(runId));
    } catch (error2) {
      setError(error2 instanceof Error ? error2.message : String(error2));
    } finally {
      setPending(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-test-report-control", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: pending, onClick: () => void rebuild(), children: pending ? "\u6B63\u5728\u91CD\u5EFA\u2026" : "\u91CD\u5EFA\u62A5\u544A" }),
    result && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "a",
      {
        href: result.url,
        target: "_blank",
        rel: "noreferrer",
        title: result.path,
        children: "\u67E5\u770B\u91CD\u5EFA\u62A5\u544A"
      }
    ),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { role: "alert", children: error })
  ] });
}
function ReportSettings(actions) {
  const [runId, setRunId] = (0, import_react2.useState)("");
  const [target, setTarget] = (0, import_react2.useState)();
  const [error, setError] = (0, import_react2.useState)("");
  const [pending, setPending] = (0, import_react2.useState)(false);
  const generation = (0, import_react2.useRef)(0);
  (0, import_react2.useEffect)(
    () => () => {
      generation.current++;
    },
    []
  );
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { "data-test-report-settings": true, className: "dsh-test-report-maintenance", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { children: "\u62A5\u544A\u7EF4\u62A4\uFF1A\u91CD\u5EFA\u5386\u53F2\u62A5\u544A" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u62A5\u544A\u7F3A\u5931\u6216\u9700\u8981\u91CD\u65B0\u751F\u6210\u65F6\uFF0C\u53EF\u6839\u636E\u5DF2\u7ED3\u675F\u6216\u4E2D\u65AD\u6D4B\u8BD5\u7684\u539F\u59CB\u8BB0\u5F55\u91CD\u5EFA\uFF0C\u4E0D\u4F1A\u91CD\u65B0\u6267\u884C\u7528\u4F8B\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("label", { htmlFor: "dsh-test-report-run", children: "\u8FD0\u884C ID\uFF08\u53EF\u9009\uFF09" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "input",
      {
        id: "dsh-test-report-run",
        value: runId,
        placeholder: "run-\u2026\uFF1B\u7559\u7A7A\u4F7F\u7528\u5F53\u524D\u5BF9\u8BDD\u7684\u62A5\u544A",
        onChange: (event) => {
          generation.current++;
          setRunId(event.target.value);
          setTarget(void 0);
          setError("");
          setPending(false);
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-test-setting-hint", children: "\u8FD0\u884C ID \u53EF\u5728\u6D4B\u8BD5\u62A5\u544A\u6216\u7ED3\u679C\u76EE\u5F55\u4E2D\u627E\u5230\u3002\u4ECD\u5728\u6267\u884C\u7684\u6D4B\u8BD5\u4E0D\u80FD\u91CD\u5EFA\uFF1B\u4E2D\u65AD\u8BB0\u5F55\u4F1A\u660E\u786E\u6807\u8BB0\u7ED3\u679C\u4E0D\u5B8C\u6574\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-test-setting-actions", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "button",
      {
        type: "button",
        disabled: pending,
        onClick: () => {
          const current = ++generation.current;
          setPending(true);
          setError("");
          setTarget(void 0);
          void actions.describeReport?.(runId.trim() || void 0).then((value) => {
            if (current === generation.current) setTarget(value);
          }).catch((error2) => {
            if (current === generation.current)
              setError(error2.message);
          }).finally(() => {
            if (current === generation.current) setPending(false);
          });
        },
        children: pending ? "\u6B63\u5728\u8BFB\u53D6\u2026" : "\u8BFB\u53D6\u76EE\u6807\u8FD0\u884C"
      }
    ) }),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: error }),
    target && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-test-command-check", role: "status", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("strong", { children: [
        "\u5C06\u91CD\u5EFA\uFF1A",
        target.name
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
        "\u8FD0\u884C ID\uFF1A",
        target.run_id
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { children: [
        "\u8BB0\u5F55\u72B6\u6001\uFF1A",
        target.lifecycle
      ] }),
      target.can_rebuild ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(RebuildReport, { ...actions, runId: target.run_id }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: "\u8BE5\u6D4B\u8BD5\u4ECD\u5728\u6267\u884C\uFF0C\u7ED3\u675F\u6216\u4E2D\u65AD\u540E\u624D\u80FD\u91CD\u5EFA\u3002" })
    ] })
  ] });
}

// src/client/browser-settings.tsx
var import_react5 = require("react");

// src/browser-preferences.ts
var browserPreferenceDefaults = {
  backend: "playwright",
  accessFile: "",
  resourceId: "chromium",
  leaseSeconds: 1800,
  previewEnabled: true
};
var runbridgeAccessTemplate = `# RunBridge \u79C1\u6709\u8BBF\u95EE\u914D\u7F6E\uFF1B\u4E5F\u652F\u6301\u539F\u6709 JSON \u6587\u4EF6\u3002
# Hub \u57FA\u5740\uFF0C\u4E0D\u542B\u672B\u5C3E /mcp\uFF1B\u53CD\u5411\u4EE3\u7406\u524D\u7F00\u53EF\u4EE5\u4FDD\u7559\u3002
hub_url: "http://hub.example:8787"
# \u4EE5\u4E0B\u4E09\u9879\u7531 Node \u6240\u6709\u8005\u914D\u5957\u7B7E\u53D1\uFF0C\u4E0D\u4F7F\u7528 enrollment.token \u767B\u8BB0\u4EE4\u724C\u3002
node_id: "node_example"
grant_id: "grant_example"
# \u4EE4\u724C\u4F7F\u7528\u5F15\u53F7\u5305\u88F9\uFF0C\u4FDD\u7559\u539F\u59CB\u5185\u5BB9\uFF1B\u8BF7\u52FF\u63D0\u4EA4\u5230 Git \u6216\u53D1\u9001\u5230\u5BF9\u8BDD\u3002
access_token: "<Node\u6240\u6709\u8005\u7B7E\u53D1\u7684\u8BBF\u95EE\u4EE4\u724C>"
# \u53EF\u9009\uFF1A\u7B7E\u53D1\u6587\u4EF6\u6807\u6CE8\u7684\u5230\u671F\u65F6\u95F4\uFF0C\u6388\u6743\u4ECD\u4EE5 Hub \u4E3A\u51C6\u3002
# expires_at: "2030-01-01T00:00:00Z"
`;

// src/preview-preferences.ts
var previewPreferenceDefaults = {
  enabled: false,
  recordingEnabled: false,
  browscreenExecutable: "browscreen",
  port: 13390,
  mcpId: ""
};
var browscreenVersionRange = ">=0.3.0,<0.4.0";
var videoInstallHint = "\u8BF7\u5728 DSH \u5BBF\u4E3B\u5B89\u88C5\u5F55\u5236\u4F9D\u8D56\uFF1Auv tool install --force --python 3.14 'browscreen[video]==0.3.0' -i http://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com\u3002\u5B89\u88C5\u540E\u91CD\u65B0\u6267\u884C\u6D4B\u8BD5\u3002";

// src/client/runbridge-connection.tsx
var import_react3 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
var remoteGuide = "https://github.com/Pegasus-Yang/DSH-Test-Plugin/blob/main/doc/user-guide/RunBridge\u8FDC\u7A0B\u6D4F\u89C8\u5668\u4E0E\u6301\u7EED\u9884\u89C8.md";
function RunBridgeConnection({
  value,
  edit,
  result,
  checking,
  read,
  cancel,
  errors
}) {
  const [copied, setCopied] = (0, import_react3.useState)("");
  const copyTemplate = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(runbridgeAccessTemplate);
      setCopied("\u6A21\u677F\u5DF2\u590D\u5236\uFF0C\u8BF7\u66FF\u6362\u4E3A\u771F\u5B9E\u7B7E\u53D1\u4FE1\u606F\u3002");
    } catch {
      setCopied("\u672A\u80FD\u8BBF\u95EE\u526A\u8D34\u677F\uFF0C\u8BF7\u9009\u62E9\u5E76\u590D\u5236\u4E0A\u65B9\u6A21\u677F\uFF0C\u6216\u4E0B\u8F7D\u7A7A\u767D\u6A21\u677F\u3002");
    }
  };
  const file = result?.file;
  const expires = file?.expires_at ? Date.parse(file.expires_at) : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { htmlFor: "dsh-test-runbridge-access", children: "\u8BBF\u95EE\u6587\u4EF6\uFF08DSH \u8FD0\u884C\u673A\u5668\u4E0A\u7684 YAML / JSON\uFF09" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "input",
      {
        id: "dsh-test-runbridge-access",
        value: value.accessFile,
        placeholder: "/path/to/runbridge-access.yaml",
        "aria-describedby": "dsh-test-access-help dsh-test-access-error",
        "aria-invalid": !!errors.accessFile || result?.code === "ACCESS_FILE_INVALID",
        onChange: (e) => edit({ accessFile: e.target.value })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { id: "dsh-test-access-help", className: "dsh-test-setting-hint", children: "\u5411 Node \u6240\u6709\u8005\u53D6\u5F97\u5DF2\u7B7E\u53D1\u7684\u8BBF\u95EE\u6587\u4EF6\uFF0C\u653E\u5230\u8FD0\u884C DSH \u7684\u673A\u5668\u4E0A\u3002\u6587\u4EF6\u5305\u542B Hub \u5730\u5740\u4E0E\u8BBF\u95EE\u8BB8\u53EF\uFF1B\u652F\u6301\u5E26\u6CE8\u91CA\u7684 YAML \u53CA\u539F\u6709 JSON\uFF0C\u4E0D\u4F7F\u7528 enrollment.token \u767B\u8BB0\u4EE4\u724C\u3002" }),
    (errors.accessFile || result?.code === "ACCESS_FILE_INVALID") && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { id: "dsh-test-access-error", role: "alert", children: errors.accessFile || result?.message }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("details", { className: "dsh-test-command-advanced", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("summary", { children: "\u67E5\u770B\u6587\u4EF6\u683C\u5F0F\u4E0E\u7A7A\u767D\u6A21\u677F" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: "\u9ED8\u8BA4\u63D0\u4F9B\u5E26\u6CE8\u91CA\u7684 YAML \u6A21\u677F\uFF1B\u539F\u6709 JSON \u6587\u4EF6\u4ECD\u53EF\u76F4\u63A5\u4F7F\u7528\u3002\u793A\u4F8B ID \u548C\u5360\u4F4D\u4EE4\u724C\u4E0D\u53EF\u76F4\u63A5\u8FDE\u63A5\uFF0C\u4E5F\u4E0D\u4F1A\u751F\u6210\u8BBF\u95EE\u8BB8\u53EF\u3002" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("pre", { tabIndex: 0, "aria-label": "RunBridge \u8BBF\u95EE\u6587\u4EF6 YAML \u6A21\u677F", children: runbridgeAccessTemplate }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dl", { className: "dsh-test-field-guide", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "hub_url" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: "Hub \u57FA\u5740\uFF1B\u63D2\u4EF6\u81EA\u52A8\u62FC\u63A5 /mcp\u3002\u4FDD\u7559\u53CD\u5411\u4EE3\u7406\u524D\u7F00\uFF0C\u4E0D\u586B\u5199\u5B8C\u6574 MCP \u7AEF\u70B9\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "node_id / grant_id" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: "Node \u6240\u6709\u8005\u63D0\u4F9B\u7684\u8282\u70B9\u548C\u914D\u5957\u8BB8\u53EF ID\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "access_token" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: "\u8BE5\u8BB8\u53EF\u7684\u8BBF\u95EE\u4EE4\u724C\uFF0C\u4E0D\u80FD\u66FF\u6362\u6210\u8282\u70B9\u767B\u8BB0\u4EE4\u724C\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-test-setting-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: () => void copyTemplate(), children: "\u590D\u5236\u6A21\u677F" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "a",
          {
            href: "data:application/yaml;charset=utf-8," + encodeURIComponent(runbridgeAccessTemplate),
            download: "runbridge-access.example.yaml",
            children: "\u4E0B\u8F7D\u7A7A\u767D\u6A21\u677F"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("a", { href: remoteGuide, target: "_blank", rel: "noreferrer", children: "\u5982\u4F55\u83B7\u53D6\u8BBF\u95EE\u6587\u4EF6" })
      ] }),
      copied && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: copied })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-test-setting-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          disabled: checking || !value.accessFile.trim(),
          onClick: () => read(false),
          children: "\u8BFB\u53D6\u914D\u7F6E"
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          disabled: checking || !value.accessFile.trim(),
          onClick: () => read(true),
          children: checking ? "\u6B63\u5728\u68C0\u67E5\u2026" : "\u68C0\u6D4B\u8FDE\u63A5"
        }
      ),
      checking && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: cancel, children: "\u53D6\u6D88\u68C0\u6D4B" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "dsh-test-setting-hint", children: "\u68C0\u6D4B\u53EA\u67E5\u8BE2 Hub \u548C\u6388\u6743\u8282\u70B9\uFF0C\u4E0D\u542F\u52A8\u6D4F\u89C8\u5668\uFF1B\u5B9E\u9645\u4F1A\u8BDD\u8EAB\u4EFD\u5728\u8FD0\u884C\u65F6\u6838\u5BF9\u3002\u4FDD\u5B58\u4E0D\u4F1A\u81EA\u52A8\u6267\u884C\u8FDE\u63A5\u68C0\u6D4B\u3002" }),
    file && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dl", { className: "dsh-test-connection-summary", "data-test-runbridge-summary": true, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "Hub \u57FA\u5740" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: file.hub_url }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "MCP \u7AEF\u70B9" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: file.mcp_url }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "\u8282\u70B9 ID" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: file.node_id }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "\u8BB8\u53EF ID" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: file.grant_id }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "\u8BBF\u95EE\u4EE4\u724C" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: "\u5DF2\u914D\u7F6E\uFF0C\u4EC5\u5728\u5BBF\u4E3B\u8BFB\u53D6" }),
      file.expires_at && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: "\u6587\u4EF6\u6807\u6CE8\u5230\u671F\u65F6\u95F4" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: new Date(file.expires_at).toLocaleString() })
      ] })
    ] }),
    result && result.code !== "ACCESS_FILE_INVALID" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        className: "dsh-test-command-check",
        role: result.ok ? "status" : "alert",
        "data-test-runbridge-check": true,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: result.code === "FILE_VALID" ? "\u6587\u4EF6\u5DF2\u89E3\u6790 \xB7 \u8FDE\u63A5\u672A\u9A8C\u8BC1" : result.ok ? "\u6700\u8FD1\u68C0\u6D4B\u901A\u8FC7" : result.hub_connected ? "Hub \u5DF2\u8FDE\u63A5 \xB7 \u8282\u70B9\u6216\u8D44\u6E90\u9700\u8981\u5904\u7406" : "\u6700\u8FD1\u8FDE\u63A5\u68C0\u6D4B\u672A\u901A\u8FC7" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: result.message }),
          result.checked_at && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
            "\u68C0\u6D4B\u65F6\u95F4\uFF1A",
            new Date(result.checked_at).toLocaleString(),
            "\u3002\u72B6\u6001\u53EF\u80FD\u53D8\u5316\uFF0C\u8FD0\u884C\u65F6\u4F1A\u91CD\u65B0\u6838\u5BF9\u3002"
          ] }),
          result.node_status && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { children: [
            "\u8282\u70B9\u72B6\u6001\uFF1A",
            result.node_status
          ] })
        ]
      }
    ),
    expires !== void 0 && expires - Date.now() < value.leaseSeconds * 1e3 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "status", children: "\u6587\u4EF6\u6807\u6CE8\u7684\u8BB8\u53EF\u5269\u4F59\u65F6\u95F4\u5C0F\u4E8E\u5F53\u524D\u79DF\u671F\uFF0C\u8BF7\u8054\u7CFB\u6240\u6709\u8005\u6838\u5BF9\u8BB8\u53EF\uFF1B\u6388\u6743\u6709\u6548\u6027\u4EE5 Hub \u4E3A\u51C6\u3002" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { htmlFor: "dsh-test-runbridge-resource", children: "\u53D7\u7BA1\u7406\u6D4F\u89C8\u5668\u8D44\u6E90 ID" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "input",
      {
        id: "dsh-test-runbridge-resource",
        value: value.resourceId,
        list: "dsh-test-runbridge-resources",
        "aria-describedby": "dsh-test-resource-help dsh-test-resource-error",
        "aria-invalid": !!errors.resourceId,
        onChange: (e) => edit({ resourceId: e.target.value })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("datalist", { id: "dsh-test-runbridge-resources", children: result?.resources?.map((r) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("option", { value: r.resource_id, children: [
      r.readiness,
      " / ",
      r.occupancy
    ] }, r.resource_id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { id: "dsh-test-resource-help", className: "dsh-test-setting-hint", children: "\u901A\u5E38\u4E3A chromium\u3002\u68C0\u6D4B\u540E\u53EF\u9009\u62E9\u8FD4\u56DE\u7684\u6388\u6743\u8D44\u6E90\uFF0C\u79BB\u7EBF\u65F6\u4ECD\u53EF\u586B\u5199\u6240\u6709\u8005\u63D0\u4F9B\u7684\u8D44\u6E90 ID\u3002" }),
    errors.resourceId && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { id: "dsh-test-resource-error", role: "alert", children: errors.resourceId }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("label", { htmlFor: "dsh-test-runbridge-lease", children: "\u6BCF\u6761\u7528\u4F8B\u7684\u4F1A\u8BDD\u79DF\u671F\uFF08\u79D2\uFF09" }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "input",
      {
        id: "dsh-test-runbridge-lease",
        type: "number",
        min: 1,
        max: 3600,
        value: Number.isFinite(value.leaseSeconds) ? value.leaseSeconds : "",
        "aria-describedby": "dsh-test-lease-help dsh-test-lease-error",
        "aria-invalid": !!errors.leaseSeconds,
        onChange: (e) => edit({
          leaseSeconds: e.target.value === "" ? NaN : Number(e.target.value)
        })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { id: "dsh-test-lease-help", className: "dsh-test-setting-hint", children: [
      Number.isFinite(value.leaseSeconds) ? `${value.leaseSeconds} \u79D2\uFF0C\u7EA6 ${Math.round(value.leaseSeconds / 60 * 10) / 10} \u5206\u949F\u3002` : "",
      "\u8303\u56F4 1\uFF5E3600 \u79D2\uFF0C\u9700\u8986\u76D6\u6267\u884C\u548C\u6536\u5C3E\uFF1B\u5B83\u4E0D\u662F\u5355\u4E2A\u5DE5\u5177\u7684\u8D85\u65F6\u3002"
    ] }),
    errors.leaseSeconds && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { id: "dsh-test-lease-error", role: "alert", children: errors.leaseSeconds })
  ] });
}

// src/client/local-preview-settings.tsx
var import_react4 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
var localGuide = "https://github.com/Pegasus-Yang/DSH-Test-Plugin/blob/main/doc/user-guide/\u6D4F\u89C8\u5668\u5B9E\u65F6\u9884\u89C8\u4E00\u6B65\u4E00\u6B65\u914D\u7F6E.md";
function LocalPreviewSettings({
  value,
  edit,
  info,
  refresh,
  errors
}) {
  const [check, setCheck] = (0, import_react4.useState)();
  const [checking, setChecking] = (0, import_react4.useState)(false);
  const [refreshing, setRefreshing] = (0, import_react4.useState)(false);
  const controller = (0, import_react4.useRef)();
  (0, import_react4.useEffect)(() => {
    controller.current?.abort();
    setCheck(void 0);
    setChecking(false);
    return () => controller.current?.abort();
  }, [value.browscreenExecutable]);
  const inspect = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setChecking(true);
    setCheck(void 0);
    try {
      const r = await fetch("/test-preview-settings/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browscreenExecutable: value.browscreenExecutable.trim() || "browscreen"
        }),
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(8e3)])
      });
      if (!r.ok) throw new Error();
      const next = await r.json();
      if (!current.signal.aborted) setCheck(next);
    } catch {
      if (!current.signal.aborted)
        setCheck({
          ok: false,
          message: "\u547D\u4EE4\u68C0\u6D4B\u5931\u8D25\uFF0C\u8BF7\u6838\u5BF9\u8DEF\u5F84\u548C\u5BBF\u4E3B\u8FDE\u63A5\u3002"
        });
    } finally {
      if (controller.current === current) setChecking(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-test-setting-switch", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "input",
        {
          type: "checkbox",
          checked: value.enabled,
          onChange: (e) => edit({ enabled: e.target.checked })
        }
      ),
      "\u663E\u793A\u5B9E\u65F6\u753B\u9762"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "dsh-test-setting-switch", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "input",
        {
          type: "checkbox",
          checked: !!value.recordingEnabled,
          onChange: (e) => edit({ recordingEnabled: e.target.checked })
        }
      ),
      "\u5F55\u5236\u6D4F\u89C8\u5668\u64CD\u4F5C\u89C6\u9891"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "dsh-test-setting-hint", children: "\u9884\u89C8\u7B49\u5F85\u9996\u5E27\u540E\u663E\u793A\uFF1B\u5F55\u50CF\u4E0E\u9884\u89C8\u72EC\u7ACB\uFF0C\u5173\u95ED\u6D6E\u7A97\u4E0D\u4F1A\u505C\u6B62\u5F55\u50CF\uFF0C\u7ED3\u675F\u540E\u5728\u62A5\u544A\u67E5\u770B\u3002" }),
    value.enabled || value.recordingEnabled ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { htmlFor: "dsh-test-preview-mcp", children: "Playwright \u6D4F\u89C8\u5668" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
        "select",
        {
          id: "dsh-test-preview-mcp",
          value: value.mcpId,
          "aria-describedby": "dsh-test-mcp-help dsh-test-mcp-error",
          "aria-invalid": !!errors.mcpId,
          onChange: (e) => edit({ mcpId: e.target.value }),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "\u8BF7\u9009\u62E9\u6D4F\u89C8\u5668" }),
            info.mcpInstances.map((m) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("option", { value: m.id, disabled: !m.compatible, children: [
              m.label,
              m.compatible ? "" : "\uFF08\u6682\u4E0D\u652F\u6301\u6B64\u63A5\u5165\uFF09"
            ] }, m.id))
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { id: "dsh-test-mcp-help", className: "dsh-test-setting-hint", children: "\u9009\u62E9\u6D4B\u8BD5\u4E13\u7528\u7684\u672C\u673A Playwright MCP\uFF0C\u4E0D\u4E0E\u5176\u4ED6\u5BF9\u8BDD\u5171\u4EAB\u64CD\u4F5C\u3002" }),
      errors.mcpId && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { id: "dsh-test-mcp-error", role: "alert", children: errors.mcpId }),
      !info.mcpInstances.some((m) => m.compatible) && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { role: "status", children: [
        "\u672A\u627E\u5230\u53EF\u7528\u7684\u672C\u673A Playwright MCP\u3002",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: localGuide, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u914D\u7F6E\u6307\u5357" }),
        "\uFF0C\u914D\u7F6E\u540E\u91CD\u65B0\u8BFB\u53D6\u5217\u8868\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-test-setting-actions", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "button",
        {
          type: "button",
          disabled: refreshing,
          onClick: () => {
            setRefreshing(true);
            void refresh().catch(
              () => setCheck({
                ok: false,
                message: "\u65E0\u6CD5\u91CD\u65B0\u8BFB\u53D6 MCP \u5217\u8868\uFF0C\u8BF7\u68C0\u67E5\u5BBF\u4E3B\u8FDE\u63A5\u3002"
              })
            ).finally(() => setRefreshing(false));
          },
          children: refreshing ? "\u6B63\u5728\u8BFB\u53D6\u2026" : "\u91CD\u65B0\u8BFB\u53D6 MCP \u5217\u8868"
        }
      ) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "dsh-test-setting-hint", children: [
        "DSH \u8FD0\u884C\u673A\u5668\u9700\u8981 Browscreen\uFF08Python \u22653.14\uFF09\uFF0C\u652F\u6301\u7A33\u5B9A\u7248",
        " ",
        browscreenVersionRange,
        "\u3002\u65E0\u9700\u63D0\u524D\u542F\u52A8\u91C7\u96C6\u670D\u52A1\u3002",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: localGuide, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u5B89\u88C5\u4E0E\u914D\u7F6E\u6B65\u9AA4" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "dsh-test-setting-actions", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "button",
        {
          type: "button",
          disabled: checking,
          onClick: () => void inspect(),
          children: checking ? "\u6B63\u5728\u68C0\u6D4B\u2026" : "\u68C0\u6D4B\u547D\u4EE4\u4E0E\u7248\u672C"
        }
      ) }),
      check && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
        "div",
        {
          className: "dsh-test-command-check",
          "data-test-browscreen-check": true,
          role: check.ok ? "status" : "alert",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: check.message }),
            check.executable && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
              "\u547D\u4EE4\u4F4D\u7F6E\uFF1A",
              check.executable
            ] }),
            check.version && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { children: [
              "\u7248\u672C\uFF1A",
              check.version
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u6B64\u9879\u4EC5\u68C0\u6D4B\u547D\u4EE4\u548C\u7248\u672C\uFF0C\u4E0D\u8BC1\u660E\u5F55\u50CF\u4F9D\u8D56\u6216\u5B9E\u9645\u91C7\u96C6\u5DF2\u53EF\u7528\u3002" })
          ]
        }
      ),
      value.recordingEnabled && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { children: "\u5F55\u50CF\u4F9D\u8D56\u51C6\u5907" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: videoInstallHint }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "\u547D\u4EE4\u68C0\u6D4B\u4E0D\u9A8C\u8BC1 PyAV\uFF0C\u5B9E\u9645\u5F55\u5236\u7ED3\u679C\u5728\u6D4B\u8BD5\u65F6\u786E\u8BA4\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("details", { className: "dsh-test-command-advanced", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("summary", { children: "\u9AD8\u7EA7\u8BBE\u7F6E\uFF1A\u547D\u4EE4\u8DEF\u5F84\u4E0E\u91C7\u96C6\u7AEF\u53E3" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { htmlFor: "dsh-test-browscreen-executable", children: "Browscreen \u53EF\u6267\u884C\u6587\u4EF6" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            id: "dsh-test-browscreen-executable",
            value: value.browscreenExecutable,
            "aria-describedby": "dsh-test-command-help dsh-test-command-error",
            "aria-invalid": !!errors.browscreenExecutable,
            onChange: (e) => edit({ browscreenExecutable: e.target.value })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { id: "dsh-test-command-help", className: "dsh-test-setting-hint", children: "\u9ED8\u8BA4 browscreen\u3002\u627E\u4E0D\u5230\u547D\u4EE4\u65F6\u586B\u5199\u5B8C\u6574\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\uFF0C\u4E0D\u586B\u76EE\u5F55\u6216\u989D\u5916\u53C2\u6570\u3002" }),
        errors.browscreenExecutable && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { id: "dsh-test-command-error", role: "alert", children: errors.browscreenExecutable }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("label", { htmlFor: "dsh-test-browscreen-port", children: "\u91C7\u96C6\u670D\u52A1\u7AEF\u53E3" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            id: "dsh-test-browscreen-port",
            type: "number",
            min: 1,
            max: 65535,
            value: Number.isFinite(value.port) ? value.port : "",
            "aria-describedby": "dsh-test-port-help dsh-test-port-error",
            "aria-invalid": !!errors.port,
            onChange: (e) => edit({
              port: e.target.value === "" ? NaN : Number(e.target.value)
            })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { id: "dsh-test-port-help", className: "dsh-test-setting-hint", children: "\u901A\u5E38\u4FDD\u7559 13390\uFF1B\u88AB\u5360\u7528\u65F6\u6362\u4E3A\u7A7A\u95F2\u7AEF\u53E3\u3002\u5B83\u4E0D\u662F DSH \u6216\u6D4F\u89C8\u5668 CDP \u7AEF\u53E3\u3002" }),
        errors.port && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { id: "dsh-test-port-error", role: "alert", children: errors.port })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "dsh-test-setting-hint", children: [
      "\u753B\u9762\u4E0E\u5F55\u50CF\u5747\u5DF2\u5173\u95ED\uFF0C\u4E0D\u9700\u8981\u914D\u7F6E Browscreen\u3002\u6D4F\u89C8\u5668\u7528\u4F8B\u4ECD\u9700\u5DF2\u6CE8\u518C\u7684\u672C\u673A Playwright MCP\u3002",
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: localGuide, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u914D\u7F6E\u6307\u5357" })
    ] })
  ] });
}

// src/client/browser-settings.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var drafts = /* @__PURE__ */ new WeakMap();
var values = (v, info) => ({
  browser: {
    ...browserPreferenceDefaults,
    ...v?.browserConnection ?? v?.browser ?? info.browserConnection
  },
  preview: { ...previewPreferenceDefaults, ...v?.browserPreview }
});
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function BrowserSettings({
  form,
  info,
  refresh
}) {
  const state = (0, import_react5.useSyncExternalStore)(
    form.subscribe.bind(form),
    form.getSnapshot.bind(form)
  );
  const cached = drafts.get(form);
  const [base, setBase] = (0, import_react5.useState)(
    () => cached?.base ?? values(state.value, info)
  );
  const [draft, setDraft] = (0, import_react5.useState)(
    () => cached?.draft ?? values(state.value, info)
  );
  const [revision, setRevision] = (0, import_react5.useState)(cached?.revision ?? state.revision);
  const [notice, setNotice] = (0, import_react5.useState)(
    cached ? "\u4E0A\u6B21\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u5DF2\u4FDD\u7559\u3002\u8BF7\u4FDD\u5B58\u6216\u653E\u5F03\u4FEE\u6539\u3002" : ""
  );
  const [errors, setErrors] = (0, import_react5.useState)({});
  const [saving, setSaving] = (0, import_react5.useState)(false);
  const [result, setResult] = (0, import_react5.useState)();
  const [checking, setChecking] = (0, import_react5.useState)(false);
  const request = (0, import_react5.useRef)();
  const formRef = (0, import_react5.useRef)(null);
  const dirty = !same(base, draft);
  const browser = draft.browser;
  const requestKey = JSON.stringify([
    browser.backend,
    browser.accessFile.trim(),
    browser.resourceId,
    browser.leaseSeconds
  ]);
  const latestKey = (0, import_react5.useRef)(requestKey);
  latestKey.current = requestKey;
  const resultRef = (0, import_react5.useRef)(result);
  resultRef.current = result;
  (0, import_react5.useEffect)(() => {
    if (!dirty && state.status === "ready") {
      const current = values(state.value, info);
      setBase(current);
      setDraft(current);
      setRevision(state.revision);
    }
  }, [state.value, state.revision, state.status, dirty, info]);
  (0, import_react5.useEffect)(() => {
    if (dirty) drafts.set(form, { draft, base, revision });
    else drafts.delete(form);
  }, [draft, base, revision, dirty, form]);
  (0, import_react5.useEffect)(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const cancel = () => {
    request.current?.controller.abort();
    request.current = void 0;
    setChecking(false);
  };
  const inspect = async (connect, quiet = false) => {
    if (request.current && quiet) return;
    cancel();
    const current = { controller: new AbortController(), key: requestKey };
    request.current = current;
    if (!quiet) setChecking(true);
    try {
      const response = await fetch("/test-preview-settings/runbridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: connect ? "connect" : "read",
          accessFile: browser.accessFile.trim(),
          resourceId: browser.resourceId.trim()
        }),
        signal: current.controller.signal
      });
      const next = await response.json();
      if (current.controller.signal.aborted || latestKey.current !== current.key)
        return;
      if (!response.ok) throw new Error();
      const previous = resultRef.current;
      setResult(
        !connect && previous?.checked_at && next.file?.revision === previous.file?.revision ? { ...previous, file: next.file } : next
      );
      return next;
    } catch {
      if (!current.controller.signal.aborted && latestKey.current === current.key) {
        const failed = {
          ok: false,
          code: "SETTINGS_UNAVAILABLE",
          message: "\u65E0\u6CD5\u8BFB\u53D6\u8FDE\u63A5\u8BBE\u7F6E\uFF0C\u8BF7\u6838\u5BF9\u5BBF\u4E3B\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002"
        };
        setResult(failed);
        return failed;
      }
    } finally {
      if (request.current === current) {
        request.current = void 0;
        setChecking(false);
      }
    }
  };
  (0, import_react5.useEffect)(() => {
    cancel();
    setResult(void 0);
    if (browser.backend !== "runbridge" || !browser.accessFile.trim() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.resourceId))
      return;
    const timer = setTimeout(() => void inspect(false), 450);
    return () => {
      clearTimeout(timer);
      request.current?.controller.abort();
    };
  }, [browser.backend, requestKey]);
  (0, import_react5.useEffect)(() => {
    if (browser.backend !== "runbridge" || !result?.file) return;
    const check = () => {
      if (document.visibilityState === "visible") void inspect(false, true);
    };
    const timer = setInterval(check, 15e3);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [browser.backend, requestKey, result?.file?.revision]);
  const edit = (next) => {
    if (!dirty) setRevision(state.revision);
    setDraft((v) => ({ ...v, ...next }));
    setErrors({});
    setNotice("");
  };
  const focusError = (key) => {
    const ids = {
      accessFile: "dsh-test-runbridge-access",
      resourceId: "dsh-test-runbridge-resource",
      leaseSeconds: "dsh-test-runbridge-lease",
      mcpId: "dsh-test-preview-mcp",
      port: "dsh-test-browscreen-port",
      browscreenExecutable: "dsh-test-browscreen-executable"
    };
    const element = formRef.current?.querySelector("#" + ids[key]);
    const details = element?.closest("details");
    if (details) details.open = true;
    element?.focus();
  };
  const save = async () => {
    const invalid = {};
    if (browser.backend === "runbridge") {
      if (!browser.accessFile.trim())
        invalid.accessFile = "\u8BF7\u586B\u5199 DSH \u8FD0\u884C\u673A\u5668\u4E0A\u7684\u8BBF\u95EE YAML \u6216 JSON \u6587\u4EF6\u8DEF\u5F84\u3002";
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(browser.resourceId.trim()))
        invalid.resourceId = "\u8BF7\u586B\u5199\u6709\u6548\u7684\u53D7\u7BA1\u7406\u6D4F\u89C8\u5668\u8D44\u6E90 ID\u3002";
      if (!Number.isInteger(browser.leaseSeconds) || browser.leaseSeconds < 1 || browser.leaseSeconds > 3600)
        invalid.leaseSeconds = "\u4F1A\u8BDD\u79DF\u671F\u987B\u4E3A 1\uFF5E3600 \u79D2\u7684\u6574\u6570\u3002";
    } else if (draft.preview.enabled || draft.preview.recordingEnabled) {
      if (!draft.preview.mcpId || !info.mcpInstances.some(
        (m) => m.id === draft.preview.mcpId && m.compatible
      ))
        invalid.mcpId = "\u8BF7\u5148\u9009\u62E9\u53EF\u7528\u7684\u6D4B\u8BD5\u4E13\u7528 Playwright MCP\u3002";
      if (!Number.isInteger(draft.preview.port) || draft.preview.port < 1 || draft.preview.port > 65535)
        invalid.port = "\u91C7\u96C6\u670D\u52A1\u7AEF\u53E3\u987B\u4E3A 1\uFF5E65535 \u7684\u6574\u6570\u3002";
      const command = draft.preview.browscreenExecutable.trim();
      if (command && command !== "browscreen" && !/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(command))
        invalid.browscreenExecutable = "\u8BF7\u586B\u5199 browscreen \u6216\u5B8C\u6574\u53EF\u6267\u884C\u6587\u4EF6\u8DEF\u5F84\uFF0C\u4E0D\u586B\u5199\u989D\u5916\u53C2\u6570\u3002";
    }
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      focusError(Object.keys(invalid)[0]);
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      if (browser.backend === "runbridge") {
        const file = await inspect(false);
        if (!file?.ok) {
          setErrors({
            accessFile: file?.message ?? "\u8BFB\u53D6\u914D\u7F6E\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u65B0\u68C0\u67E5\u6587\u4EF6\u3002"
          });
          focusError("accessFile");
          return;
        }
      }
      const normalized = {
        browser: {
          ...browser,
          accessFile: browser.accessFile.trim(),
          resourceId: browser.resourceId.trim(),
          leaseSeconds: browser.backend === "playwright" && (!Number.isInteger(browser.leaseSeconds) || browser.leaseSeconds < 1 || browser.leaseSeconds > 3600) ? base.browser.leaseSeconds : browser.leaseSeconds
        },
        preview: {
          ...draft.preview,
          browscreenExecutable: draft.preview.browscreenExecutable.trim() || "browscreen",
          port: (browser.backend === "runbridge" || !draft.preview.enabled && !draft.preview.recordingEnabled) && (!Number.isInteger(draft.preview.port) || draft.preview.port < 1 || draft.preview.port > 65535) ? base.preview.port : draft.preview.port
        }
      };
      if (await form.mutate(
        [
          {
            op: "set",
            path: ["browserConnection"],
            value: { ...normalized.browser }
          },
          {
            op: "set",
            path: ["browserPreview"],
            value: { ...normalized.preview }
          }
        ],
        revision
      )) {
        setDraft(normalized);
        setBase(normalized);
        drafts.delete(form);
        setNotice(
          "\u5DF2\u4FDD\u5B58\uFF0C\u4E0B\u6B21\u6D4B\u8BD5\u751F\u6548\uFF1B\u5F53\u524D\u6D4B\u8BD5\u7EE7\u7EED\u4F7F\u7528\u539F\u8FDE\u63A5\u3002\u8FDE\u63A5\u68C0\u6D4B\u7ED3\u679C\u89C1\u4E0A\u65B9\uFF0C\u4FDD\u5B58\u672C\u8EAB\u4E0D\u4EE3\u8868\u8FDE\u63A5\u5DF2\u9A8C\u8BC1\u3002"
        );
      } else
        setErrors({
          save: state.writable ? "\u8BBE\u7F6E\u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u4FEE\u6539\u6216\u53D7\u542F\u52A8\u914D\u7F6E\u8986\u76D6\uFF0C\u672A\u8986\u76D6\u73B0\u6709\u503C\u3002\u8BF7\u653E\u5F03\u8349\u7A3F\u5E76\u91CD\u65B0\u8BFB\u53D6\u540E\u518D\u8BD5\u3002" : "\u5F53\u524D\u8BBE\u7F6E\u7531\u542F\u52A8\u914D\u7F6E\u56FA\u5B9A\uFF0C\u4E0D\u80FD\u5728\u6B64\u4FDD\u5B58\u3002"
        });
    } catch {
      setErrors({ save: "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5BBF\u4E3B\u8FDE\u63A5\u540E\u91CD\u8BD5\uFF1B\u5F53\u524D\u8349\u7A3F\u4ECD\u4FDD\u7559\u3002" });
    } finally {
      setSaving(false);
    }
  };
  if (state.status === "loading")
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u4FDD\u5B58\u7684\u914D\u7F6E\u2026" });
  const writable = state.writable && state.status === "ready";
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
    "form",
    {
      ref: formRef,
      noValidate: true,
      "data-test-browser-connection": true,
      onSubmit: (e) => {
        e.preventDefault();
        void save();
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { className: "dsh-test-config-state", role: "status", children: [
          dirty ? "\u6709\u672A\u4FDD\u5B58\u4FEE\u6539\uFF1B\u5173\u95ED\u8BBE\u7F6E\u540E\u8349\u7A3F\u4ECD\u4FDD\u7559\uFF0C\u8BF7\u4FDD\u5B58\u6216\u653E\u5F03\u3002" : "\u5F53\u524D\u914D\u7F6E\u5DF2\u4FDD\u5B58",
          " ",
          "\xB7 \u5DF2\u4FDD\u5B58\u7684\u6D4F\u89C8\u5668\u4F4D\u7F6E\uFF1A",
          base.browser.backend === "runbridge" ? "\u8FDC\u7A0B RunBridge" : "\u672C\u673A Playwright"
        ] }),
        info.activeBrowser && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { className: "dsh-test-setting-hint", children: [
          "\u6253\u5F00\u8BBE\u7F6E\u65F6\uFF0C\u8FD0\u884C\u4E2D\u7684\u6D4B\u8BD5\u7ED1\u5B9A\uFF1A",
          info.activeBrowser === "runbridge" ? "\u8FDC\u7A0B RunBridge" : "\u672C\u673A Playwright",
          "\u3002\u4FDD\u5B58\u4E0D\u4F1A\u5207\u6362\u8BE5\u6D4B\u8BD5\u3002"
        ] }),
        !writable && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { role: "alert", children: [
          "\u5F53\u524D\u8FDE\u63A5\u4E3A\u53EA\u8BFB\u6216\u914D\u7F6E\u7531\u542F\u52A8 patch \u56FA\u5B9A\u3002\u8BF7\u5728\u53EF\u7F16\u8F91\u7684 DSH profile \u4E2D\u8C03\u6574\uFF0C\u4E0D\u80FD\u901A\u8FC7\u6B64\u9875\u8986\u76D6\u542F\u52A8\u914D\u7F6E\u3002",
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "a",
            {
              href: browser.backend === "runbridge" ? remoteGuide : localGuide,
              target: "_blank",
              rel: "noreferrer",
              children: "\u67E5\u770B\u914D\u7F6E\u8BF4\u660E"
            }
          )
        ] }),
        !!Object.keys(errors).length && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { role: "alert", className: "dsh-test-command-check", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: "\u8BBE\u7F6E\u5C1A\u672A\u4FDD\u5B58" }),
          Object.entries(errors).map(([key, message]) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("p", { children: [
            message,
            key !== "save" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
              "button",
              {
                type: "button",
                className: "dsh-test-inline-action",
                onClick: () => focusError(key),
                children: "\u5B9A\u4F4D\u5B57\u6BB5"
              }
            )
          ] }, key))
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("fieldset", { disabled: saving || !writable, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("label", { htmlFor: "dsh-test-browser-backend", children: "\u6D4F\u89C8\u5668\u4F4D\u7F6E" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
            "select",
            {
              id: "dsh-test-browser-backend",
              value: browser.backend,
              disabled: !writable,
              onChange: (e) => edit({
                browser: {
                  ...browser,
                  backend: e.target.value
                }
              }),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "playwright", children: "\u672C\u673A Playwright MCP" }),
                /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "runbridge", children: "\u8FDC\u7A0B RunBridge MCP" })
              ]
            }
          ),
          browser.backend === "runbridge" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            RunBridgeConnection,
            {
              value: browser,
              edit: (v) => edit({ browser: { ...browser, ...v } }),
              result,
              checking,
              read: (connect) => void inspect(connect),
              cancel: () => {
                cancel();
                setNotice("\u68C0\u6D4B\u5DF2\u53D6\u6D88\uFF0C\u672A\u4FDD\u5B58\u8BBE\u7F6E\u3002");
              },
              errors
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: "\u753B\u9762\u4E0E\u5F55\u50CF" }),
          browser.backend === "runbridge" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "dsh-test-setting-switch", children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                "input",
                {
                  type: "checkbox",
                  checked: browser.previewEnabled,
                  disabled: !writable,
                  onChange: (e) => edit({
                    browser: { ...browser, previewEnabled: e.target.checked }
                  })
                }
              ),
              "\u663E\u793A\u5B9E\u65F6\u753B\u9762"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "dsh-test-setting-hint", children: "RunBridge \u63D0\u4F9B\u540C\u4E00\u8FDC\u7A0B\u9875\u9762\u7684\u753B\u9762\uFF0C\u65E0\u9700\u672C\u673A Browscreen\uFF1B\u8FDC\u7A0B\u5F55\u50CF\u6682\u4E0D\u652F\u6301\u3002" })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            LocalPreviewSettings,
            {
              value: draft.preview,
              edit: (v) => edit({ preview: { ...draft.preview, ...v } }),
              info,
              refresh,
              errors
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-test-settings-save dsh-test-setting-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "submit",
              disabled: !writable || !dirty || saving || checking,
              children: saving ? "\u6B63\u5728\u4FDD\u5B58\u2026" : "\u4FDD\u5B58\u6D4F\u89C8\u5668\u8BBE\u7F6E"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "button",
              disabled: !dirty || saving,
              onClick: () => {
                cancel();
                const current = values(state.value, info);
                setDraft(current);
                setBase(current);
                setRevision(state.revision);
                setErrors({});
                setNotice("\u5DF2\u653E\u5F03\u4FEE\u6539\uFF0C\u6062\u590D\u5F53\u524D\u5DF2\u4FDD\u5B58\u7684\u6D4F\u89C8\u5668\u8BBE\u7F6E\u3002");
                drafts.delete(form);
              },
              children: "\u653E\u5F03\u4FEE\u6539"
            }
          )
        ] }),
        notice && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { role: "status", children: notice })
      ]
    }
  );
}

// src/client/preview-settings.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
function PreviewSettingsPage({
  forms,
  rebuildReport,
  describeReport,
  ...recovery
}) {
  const [info, setInfo] = (0, import_react6.useState)();
  const [error, setError] = (0, import_react6.useState)("");
  const refresh = (0, import_react6.useCallback)(async (signal) => {
    const response = await fetch("/test-preview-settings", {
      signal,
      cache: "no-store"
    });
    if (!response.ok)
      throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u8BBE\u7F6E\uFF0C\u8BF7\u786E\u8BA4\u5DF2\u767B\u5F55\u4E14\u6D4B\u8BD5\u63D2\u4EF6\u6B63\u5E38\u52A0\u8F7D\u3002");
    setInfo(await response.json());
    setError("");
  }, []);
  (0, import_react6.useEffect)(() => {
    const c = new AbortController();
    void refresh(c.signal).catch((e) => {
      if (!c.signal.aborted) setError(e.message);
    });
    return () => c.abort();
  }, [refresh]);
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "dsh-test-settings", "data-test-preview-settings": true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h2", { children: "\u6D4F\u89C8\u5668\u8BBE\u7F6E" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-test-setting-hint", children: "\u9009\u62E9\u6D4B\u8BD5\u6D4F\u89C8\u5668\u7684\u4F4D\u7F6E\uFF0C\u518D\u914D\u7F6E\u8FDE\u63A5\u548C\u753B\u9762\u3002\u63A5\u53E3\u6D4B\u8BD5\u65E0\u9700\u6D4F\u89C8\u5668\u3002" }),
    error && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "alert", children: error }),
    info ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      BrowserSettings,
      {
        form: forms.get(info.namespace),
        info,
        refresh
      }
    ) : !error && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u8BBE\u7F6E\u2026" }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RecoveryPanel, { ...recovery }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      ReportSettings,
      {
        rebuildReport,
        describeReport
      }
    )
  ] });
}

// src/client/components.tsx
var import_react8 = require("react");

// src/client/progress-view.ts
var phaseLabels = {
  planning: "\u6B63\u5728\u89C4\u5212",
  reviewing: "\u7B49\u5F85\u8BA1\u5212\u5BA1\u6838",
  executing: "\u6267\u884C\u4E2D",
  stopping: "\u6B63\u5728\u505C\u6B62",
  cleanup: "\u6B63\u5728\u6E05\u7406",
  finished: "\u5DF2\u7ED3\u675F",
  interrupted: "\u5DF2\u4E2D\u65AD"
};
var statusLabels = {
  PENDING: "\u5F85\u6267\u884C",
  RUNNING: "\u8FD0\u884C\u4E2D",
  SUCCEEDED: "\u5DF2\u5B8C\u6210",
  PASS: "\u901A\u8FC7",
  FAIL: "\u5931\u8D25",
  ERROR: "\u9519\u8BEF",
  BLOCKED: "\u963B\u585E",
  SKIPPED: "\u8DF3\u8FC7",
  CANCELLED: "\u53D6\u6D88",
  INCONCLUSIVE: "\u7ED3\u8BBA\u4E0D\u8DB3"
};
function duration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1e3));
  return seconds < 60 ? `${seconds} \u79D2` : `${Math.floor(seconds / 60)} \u5206 ${String(seconds % 60).padStart(2, "0")} \u79D2`;
}
function elapsed2(step, now) {
  return step.started_at && !step.finished_at && step.status === "RUNNING" ? Math.max(0, now - Date.parse(step.started_at)) : step.duration_ms;
}
function tone(status) {
  return status === "RUNNING" ? "running" : ["PASS", "SUCCEEDED"].includes(status) ? "pass" : ["FAIL", "ERROR", "INCONCLUSIVE", "BLOCKED"].includes(status) ? "error" : "muted";
}
function selectedInstance(snapshot) {
  return snapshot.instances.find(
    (instance) => instance.id === snapshot.current_instance_id
  ) ?? snapshot.instances.find((instance) => instance.status === "RUNNING") ?? snapshot.instances[0];
}
function stepRows(snapshot) {
  let number = 0;
  return snapshot.instances.flatMap(
    (instance) => instance.steps.map((step) => ({
      key: `${instance.id}/${step.id}`,
      number: ++number,
      instance,
      step
    }))
  );
}
function progressTone(snapshot, failed = false) {
  if (failed || snapshot.phase === "interrupted") return "error";
  if (snapshot.instances.some((instance) => tone(instance.status) === "error"))
    return "error";
  return snapshot.phase === "finished" ? snapshot.instances.length > 0 && snapshot.instances.every(
    (instance) => ["PASS", "SUCCEEDED"].includes(instance.status)
  ) ? "pass" : "muted" : "running";
}
function focusStep(snapshot, rows = stepRows(snapshot)) {
  const instance = selectedInstance(snapshot);
  if (snapshot.phase === "planning")
    return { label: "\u6B63\u5728\u89C4\u5212", description: "\u6B63\u5728\u5206\u6790\u4EFB\u52A1\u5E76\u62C6\u5206\u6D4B\u8BD5\u6B65\u9AA4" };
  if (snapshot.phase === "reviewing")
    return {
      label: "\u7B49\u5F85\u5BA1\u6838",
      description: "\u8BF7\u5728\u539F\u751F\u5BA1\u6838\u4E2D\u786E\u8BA4\u8BA1\u5212\uFF0C\u6279\u51C6\u540E\u5F00\u59CB\u6267\u884C"
    };
  if (snapshot.phase === "cleanup") {
    const step = instance?.cleanup.find((step2) => step2.id === snapshot.current_step_id) ?? instance?.cleanup.find((step2) => step2.status === "RUNNING");
    return {
      label: "\u8D44\u6E90\u6E05\u7406",
      description: step?.description ?? "\u6B63\u5728\u91CA\u653E\u672C\u8F6E\u6D4B\u8BD5\u8D44\u6E90",
      step
    };
  }
  if (snapshot.phase === "finished" || snapshot.phase === "interrupted") {
    const problem = rows.find((row2) => tone(row2.step.status) === "error");
    const cleanupProblem = snapshot.instances.flatMap((instance2) => instance2.cleanup).find((step) => tone(step.status) === "error");
    const setupProblem = snapshot.instances.flatMap((instance2) => instance2.setup).find((step) => tone(step.status) === "error");
    const externalProblem = cleanupProblem ?? setupProblem;
    if (externalProblem)
      return {
        label: cleanupProblem ? "\u6E05\u7406\u5F02\u5E38" : "\u51C6\u5907\u5F02\u5E38",
        description: externalProblem.description,
        step: externalProblem
      };
    if (problem)
      return {
        label: "\u5F02\u5E38\u6B65\u9AA4",
        description: problem.step.description,
        row: problem,
        step: problem.step
      };
    if (snapshot.phase === "interrupted")
      return {
        label: "\u5DF2\u4E2D\u65AD",
        description: "\u672C\u8F6E\u6267\u884C\u5DF2\u4E2D\u65AD\uFF0C\u8BF7\u67E5\u770B\u6B65\u9AA4\u548C\u8FD0\u884C\u8BB0\u5F55"
      };
    return {
      label: "\u672C\u8F6E\u5DF2\u7ED3\u675F",
      description: "\u67E5\u770B\u5B8C\u6574\u6B65\u9AA4\u4E0E\u8FD0\u884C\u8BB0\u5F55\uFF0C\u4E86\u89E3\u672C\u8F6E\u6267\u884C\u7ED3\u679C"
    };
  }
  const preparing = instance?.setup.find(
    (step) => step.id === snapshot.current_step_id
  );
  if (preparing)
    return {
      label: "\u73AF\u5883\u51C6\u5907",
      description: preparing.description,
      step: preparing
    };
  const row = rows.find(
    (row2) => row2.instance.id === instance?.id && row2.step.id === snapshot.current_step_id
  ) ?? rows.find(
    (row2) => row2.instance.id === instance?.id && row2.step.status === "RUNNING"
  );
  if (!row)
    return {
      label: snapshot.phase === "stopping" ? "\u6B63\u5728\u505C\u6B62" : "\u7B49\u5F85\u4E0B\u4E00\u6B65",
      description: snapshot.phase === "stopping" ? "\u6B63\u5728\u7B49\u5F85\u5728\u9014\u64CD\u4F5C\u7ED3\u7B97" : "\u6B63\u5728\u51C6\u5907\u4E0B\u4E00\u9879\u6D4B\u8BD5\u64CD\u4F5C"
    };
  const localIndex = row.instance.steps.indexOf(row.step);
  return {
    label: snapshot.phase === "stopping" ? "\u6B63\u5728\u505C\u6B62" : "\u5F53\u524D\u6B65\u9AA4",
    description: row.step.description,
    row,
    step: row.step,
    next: row.instance.steps[localIndex + 1]
  };
}

// src/client/progress-dock.tsx
var import_react7 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime7 = require("react/jsx-runtime");
function ProgressCard({
  snapshot,
  now,
  failed,
  actions
}) {
  const [collapsed, setCollapsed] = (0, import_react7.useState)(false);
  const [expanded, setExpanded] = (0, import_react7.useState)(false);
  const [inspection, setInspection] = (0, import_react7.useState)();
  const [textExpanded, setTextExpanded] = (0, import_react7.useState)(false);
  const [clipped, setClipped] = (0, import_react7.useState)(false);
  const previewVisible = (0, import_react7.useSyncExternalStore)(
    actions.previewVisible.subscribe,
    actions.previewVisible.getSnapshot,
    actions.previewVisible.getSnapshot
  );
  const description = (0, import_react7.useRef)(null);
  const list = (0, import_react7.useRef)(null);
  const bodyId = (0, import_react7.useId)();
  const listId = (0, import_react7.useId)();
  const descriptionId = (0, import_react7.useId)();
  const rows = stepRows(snapshot);
  const focus = focusStep(snapshot, rows);
  const activeKey = focus.row?.key;
  const currentInstance = focus.row?.instance;
  const stateTone = progressTone(snapshot, failed);
  const StateIcon = stateTone === "error" ? import_dsh_client_ui_primitives.IconWarningOutlineRegular : stateTone === "muted" ? import_dsh_client_ui_primitives.IconInfoOutlineRegular : snapshot.phase === "finished" ? import_dsh_client_ui_primitives.IconCheckCircleOutlineRegular : import_dsh_client_ui_primitives.IconLoadingOutlineRegular;
  const total = Math.max(
    0,
    Date.parse(snapshot.finished_at ?? new Date(now).toISOString()) - Date.parse(snapshot.created_at)
  );
  const ratio = snapshot.total_steps ? Math.min(1, snapshot.settled_steps / snapshot.total_steps) : 0;
  (0, import_react7.useEffect)(() => {
    setCollapsed(false);
    setExpanded(false);
    setInspection(void 0);
  }, [snapshot.run_id]);
  (0, import_react7.useEffect)(() => {
    setTextExpanded(false);
    setClipped(false);
  }, [focus.description]);
  (0, import_react7.useEffect)(() => {
    const element = description.current;
    if (!element || textExpanded || collapsed) return;
    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [focus.description, textExpanded, collapsed]);
  (0, import_react7.useEffect)(() => {
    if (!expanded || inspection || !activeKey) return;
    const container = list.current;
    const target = container?.querySelector(
      '[aria-current="step"]'
    );
    if (!container || !target) return;
    const center = () => {
      const rect = target.getBoundingClientRect();
      container.scrollTop += rect.top - container.getBoundingClientRect().top - (container.clientHeight - rect.height) / 2;
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(container);
    observer.observe(target);
    return () => observer.disconnect();
  }, [expanded, activeKey, inspection, snapshot.run_id]);
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "section",
    {
      className: `dsh-test-card dsh-test-card-${stateTone}`,
      "data-test-progress": true,
      "data-run-id": snapshot.run_id,
      "aria-label": "\u6D4B\u8BD5\u6267\u884C\u8FDB\u5EA6",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-test-card-heading", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-test-card-phase", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              StateIcon,
              {
                size: 18,
                className: stateTone === "running" ? "dsh-test-spin" : void 0
              }
            ),
            failed ? "\u8FDE\u63A5\u6682\u4E0D\u53EF\u7528" : phaseLabels[snapshot.phase]
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "dsh-test-card-title", title: snapshot.title, children: snapshot.title }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-test-card-time", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives.IconClockOutlineRegular, { size: 16 }),
            "\u5DF2\u7528 ",
            duration(total)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
            "button",
            {
              className: "dsh-test-fold",
              type: "button",
              "aria-label": collapsed ? "\u5C55\u5F00\u6D4B\u8BD5\u8FDB\u5EA6" : "\u6536\u8D77\u6D4B\u8BD5\u8FDB\u5EA6",
              "aria-expanded": !collapsed,
              "aria-controls": bodyId,
              onClick: () => setCollapsed(!collapsed),
              children: collapsed ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives.IconChevronUpOutlineRegular, { size: 18 }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 18 })
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "div",
          {
            className: "dsh-test-meter",
            role: "progressbar",
            "aria-label": "\u4E1A\u52A1\u6B65\u9AA4\u7ED3\u7B97\u8FDB\u5EA6",
            "aria-valuemin": 0,
            "aria-valuemax": snapshot.total_steps || 100,
            "aria-valuenow": snapshot.total_steps ? snapshot.settled_steps : void 0,
            children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { width: `${ratio * 100}%` } })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-test-card-count", children: [
          snapshot.total_steps ? `${snapshot.settled_steps} / ${snapshot.total_steps} \u6B65\u5DF2\u7ED3\u7B97` : "\u4E1A\u52A1\u6B65\u9AA4\u5C1A\u672A\u786E\u5B9A",
          failed && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: "\u8FDE\u63A5\u6062\u590D\u540E\u66F4\u65B0\u8FDB\u5EA6\u4E0E\u8017\u65F6" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { id: bodyId, className: "dsh-test-card-body", hidden: collapsed, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-test-focus", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-test-focus-marker", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "dsh-test-focus-number", "aria-hidden": "true", children: focus.row ? String(focus.row.number).padStart(2, "0") : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StateIcon, { size: 23 }) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-test-focus-label", children: [
                focus.label,
                snapshot.instances.length > 1 && currentInstance && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("small", { children: [
                  "\u7528\u4F8B ",
                  snapshot.instances.indexOf(currentInstance) + 1,
                  " /",
                  " ",
                  snapshot.instances.length
                ] })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-test-focus-content", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "p",
                {
                  ref: description,
                  id: descriptionId,
                  className: "dsh-test-focus-description",
                  "data-expanded": textExpanded,
                  tabIndex: textExpanded ? 0 : void 0,
                  children: focus.description
                }
              ),
              (clipped || textExpanded) && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                "button",
                {
                  type: "button",
                  className: "dsh-test-text-toggle",
                  "aria-expanded": textExpanded,
                  "aria-controls": descriptionId,
                  onClick: () => setTextExpanded(!textExpanded),
                  children: textExpanded ? "\u6536\u8D77\u6587\u5B57" : "\u5C55\u5F00\u5B8C\u6574\u6587\u5B57"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-test-focus-meta", children: [
                focus.step && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives.IconClockOutlineRegular, { size: 14 }),
                  statusLabels[focus.step.status] ?? focus.step.status,
                  focus.step.started_at ? ` \xB7 \u672C\u6B65 ${duration(elapsed2(focus.step, now))}` : ""
                ] }),
                focus.next && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
                  "span",
                  {
                    className: "dsh-test-focus-next",
                    title: focus.next.description,
                    children: [
                      "\u4E0B\u4E00\u6B65\uFF1A",
                      focus.next.description
                    ]
                  }
                )
              ] })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-test-card-actions", children: [
            rows.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
              "button",
              {
                type: "button",
                "aria-expanded": expanded,
                "aria-controls": listId,
                onClick: () => setExpanded(!expanded),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives.IconFlatListOutlineRegular, { size: 17 }),
                  expanded ? "\u6536\u8D77\u5B8C\u6574\u6B65\u9AA4" : `\u67E5\u770B\u5168\u90E8\u6B65\u9AA4\uFF08${rows.length}\uFF09`
                ]
              }
            ),
            snapshot.preview.ready && !failed && snapshot.phase !== "finished" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
              "button",
              {
                type: "button",
                "aria-pressed": previewVisible,
                onClick: () => actions.openPreview(snapshot),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives.IconBrowseOutlineRegular, { size: 17 }),
                  previewVisible ? "\u9690\u85CF\u5B9E\u65F6\u753B\u9762" : "\u663E\u793A\u5B9E\u65F6\u753B\u9762"
                ]
              }
            ),
            snapshot.report_url && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("a", { href: snapshot.report_url, target: "_blank", rel: "noreferrer", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives.IconFlatListOutlineRegular, { size: 17 }),
              "\u6D4B\u8BD5\u62A5\u544A"
            ] }),
            snapshot.phase === "finished" && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              RebuildReport,
              {
                rebuildReport: actions.rebuildReport,
                runId: snapshot.run_id
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("small", { children: "\u65F6\u95F4\u5305\u542B\u7B49\u5F85" })
          ] }),
          snapshot.preview.failed && !failed && snapshot.phase !== "finished" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
            "p",
            {
              className: "dsh-test-preview-note",
              "data-test-preview-error": true,
              role: "status",
              children: [
                "\u5B9E\u65F6\u753B\u9762\u672A\u542F\u7528\uFF1A",
                snapshot.preview.reason,
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: "\u8BF7\u8FDB\u5165\u201C\u8BBE\u7F6E \u2192 \u6D4B\u8BD5\u63D2\u4EF6 \u2192 \u6D4F\u89C8\u5668\u5B9E\u65F6\u9884\u89C8\u201D\u68C0\u6D4B\u5B89\u88C5\u6216\u8C03\u6574\u914D\u7F6E\uFF1B\u4E1A\u52A1\u6D4B\u8BD5\u7EE7\u7EED\u6267\u884C\u3002" })
              ]
            }
          ),
          snapshot.preview.recording_notice && !failed && snapshot.phase !== "finished" && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
            "p",
            {
              className: "dsh-test-preview-note",
              "data-test-recording-error": true,
              role: "status",
              children: [
                snapshot.preview.recording_notice,
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: "\u5F55\u50CF\u5F02\u5E38\u4E0D\u6539\u53D8\u4E1A\u52A1\u65AD\u8A00\uFF1B\u8BF7\u5728\u201C\u8BBE\u7F6E \u2192 \u6D4B\u8BD5\u63D2\u4EF6\u201D\u68C0\u67E5\u5B89\u88C5\u548C\u914D\u7F6E\u3002" })
              ]
            }
          ),
          expanded && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
            "div",
            {
              className: "dsh-test-step-list",
              id: listId,
              ref: list,
              role: "region",
              "aria-label": "\u5B8C\u6574\u4E1A\u52A1\u6B65\u9AA4",
              tabIndex: 0,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("ol", { children: rows.map((row) => {
                  const selected = inspection === row.key;
                  const StepIcon = tone(row.step.status) === "error" ? import_dsh_client_ui_primitives.IconWarningOutlineRegular : ["PASS", "SUCCEEDED"].includes(row.step.status) ? import_dsh_client_ui_primitives.IconCheckCircleOutlineRegular : row.step.status === "RUNNING" ? import_dsh_client_ui_primitives.IconLoadingOutlineRegular : void 0;
                  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
                    "li",
                    {
                      "data-test-step": row.step.id,
                      "data-step-status": row.step.status,
                      "data-tone": tone(row.step.status),
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
                          "button",
                          {
                            type: "button",
                            className: "dsh-test-step-row",
                            "aria-current": activeKey === row.key ? "step" : void 0,
                            "aria-expanded": selected,
                            onClick: () => setInspection(selected ? void 0 : row.key),
                            children: [
                              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-test-step-position", children: [
                                StepIcon && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                                  StepIcon,
                                  {
                                    size: 16,
                                    className: row.step.status === "RUNNING" ? "dsh-test-spin" : void 0
                                  }
                                ),
                                row.number
                              ] }),
                              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-test-step-copy", children: [
                                snapshot.instances.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("small", { children: [
                                  row.instance.name,
                                  " \xB7 ",
                                  row.instance.data_id
                                ] }),
                                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: row.step.description })
                              ] }),
                              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-test-step-result", children: [
                                statusLabels[row.step.status] ?? row.step.status,
                                row.step.started_at && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("small", { children: duration(elapsed2(row.step, now)) })
                              ] })
                            ]
                          }
                        ),
                        selected && /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-test-step-inspection", children: [
                          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: row.step.description }),
                          row.step.reason && /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: row.step.reason }),
                          row.step.checks.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("ul", { children: row.step.checks.map((check, index) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("li", { children: [
                            check.text,
                            " \xB7",
                            " ",
                            statusLabels[check.status] ?? check.status,
                            check.reason && ` \xB7 ${check.reason}`
                          ] }, index)) }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: "\u672C\u6B65\u9AA4\u6CA1\u6709\u9644\u52A0\u68C0\u67E5\u70B9\u3002" })
                        ] })
                      ]
                    },
                    row.key
                  );
                }) }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                  "button",
                  {
                    className: "dsh-test-more-details",
                    type: "button",
                    onClick: actions.openDetails,
                    children: "\u67E5\u770B\u51C6\u5907\u3001\u6E05\u7406\u53CA\u5B8C\u6574\u8BE6\u60C5"
                  }
                )
              ]
            }
          )
        ] })
      ]
    }
  );
}

// src/client/components.tsx
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime8 = require("react/jsx-runtime");
function useProgress(actions, visible = true) {
  const [snapshot, setSnapshot] = (0, import_react8.useState)();
  const [failed, setFailed] = (0, import_react8.useState)(false);
  const [tick, setTick] = (0, import_react8.useState)(0);
  const received = (0, import_react8.useRef)(0);
  (0, import_react8.useEffect)(() => {
    if (!visible) return;
    let stopped = false;
    let timer;
    let controller;
    const poll = async () => {
      if (stopped || document.hidden) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5e3);
      try {
        const next = await actions.read(controller.signal);
        if (!stopped) {
          received.current = performance.now();
          setSnapshot(next);
          setFailed(false);
        }
      } catch {
        if (!stopped) setFailed(true);
      } finally {
        clearTimeout(timeout);
        controller = void 0;
        if (!stopped) timer = setTimeout(poll, 1e3);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (document.hidden) controller?.abort();
      else if (!controller) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [actions.read, visible]);
  (0, import_react8.useEffect)(() => {
    if (!visible || !snapshot || snapshot.finished_at || failed) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1e3);
    return () => clearInterval(timer);
  }, [snapshot?.run_id, snapshot?.finished_at, visible, failed]);
  void tick;
  const now = snapshot ? Date.parse(snapshot.server_now) + (failed || snapshot.finished_at ? 0 : performance.now() - received.current) : Date.now();
  return { snapshot, failed, now };
}
function StepFlow({
  steps,
  now,
  details = false
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("ol", { className: "dsh-test-flow", "aria-label": "\u6D4B\u8BD5\u4E1A\u52A1\u6B65\u9AA4", children: steps.map((step, index) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "li",
    {
      className: `dsh-test-${tone(step.status)}`,
      "data-test-step": step.id,
      "data-step-status": step.status,
      "aria-current": step.status === "RUNNING" ? "step" : void 0,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "dsh-test-node", "aria-hidden": "true", children: ["PASS", "SUCCEEDED"].includes(step.status) ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives2.IconCheckOutlineRegular, { size: 16 }) : ["FAIL", "ERROR", "BLOCKED", "INCONCLUSIVE"].includes(
          step.status
        ) ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives2.IconWarningOutlineRegular, { size: 16 }) : index + 1 }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "dsh-test-step-name", children: step.description }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "dsh-test-step-time", children: [
          statusLabels[step.status] ?? step.status,
          step.started_at ? ` \xB7 ${duration(elapsed2(step, now))}` : ""
        ] }),
        details && step.checks.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("ul", { className: "dsh-test-checks", children: step.checks.map((check, i) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("li", { children: [
          check.text,
          " \xB7 ",
          statusLabels[check.status] ?? check.status
        ] }, i)) }),
        details && step.reason && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "dsh-test-reason", children: step.reason })
      ]
    },
    step.id
  )) });
}
function Heading({
  state,
  now,
  failed
}) {
  const total = Math.max(
    0,
    Date.parse(state.finished_at ?? new Date(now).toISOString()) - Date.parse(state.created_at)
  );
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-test-heading", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("strong", { className: "dsh-test-phase", children: failed ? "\u8FDE\u63A5\u6682\u4E0D\u53EF\u7528" : phaseLabels[state.phase] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
      state.settled_steps,
      " / ",
      state.total_steps,
      " \u6B65\u5DF2\u7ED3\u7B97"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "dsh-test-time", children: [
      "\u5DF2\u7528 ",
      duration(total)
    ] })
  ] });
}
function ProgressDock(props) {
  const notice = (0, import_react8.useSyncExternalStore)(
    props.notice.subscribe,
    props.notice.getSnapshot
  );
  const { snapshot, failed, now } = useProgress(props);
  (0, import_react8.useEffect)(() => {
    if (snapshot && !failed) props.followPreview(snapshot);
  }, [snapshot, failed, props.followPreview]);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
    notice && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
      "section",
      {
        className: "dsh-test-command-notice",
        "data-test-command-notice": true,
        "aria-label": "\u6D4B\u8BD5\u547D\u4EE4\u63D0\u793A",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { role: "alert", children: notice }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "dsh-test-actions", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", onClick: props.notice.dismiss, children: "\u5173\u95ED\u63D0\u793A" }) })
        ]
      }
    ),
    snapshot && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      ProgressCard,
      {
        snapshot,
        now,
        failed,
        actions: props
      }
    )
  ] });
}
function ProgressHeader(props) {
  const { snapshot, failed } = useProgress(props);
  (0, import_react8.useEffect)(() => {
    if (snapshot && !failed) props.followPreview(snapshot);
  }, [snapshot, failed, props.followPreview]);
  if (!snapshot) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "button",
    {
      type: "button",
      className: "dsh-test-header",
      "aria-label": "\u67E5\u770B\u6D4B\u8BD5\u8FDB\u5EA6",
      onClick: props.openDetails,
      title: failed ? "\u8FDE\u63A5\u6682\u4E0D\u53EF\u7528" : `${phaseLabels[snapshot.phase]} \xB7 ${snapshot.settled_steps}/${snapshot.total_steps} \u6B65\u5DF2\u7ED3\u7B97`,
      "data-test-progress-header": true,
      children: [
        "\u6D4B\u8BD5\u8FDB\u5EA6",
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
          snapshot.settled_steps,
          "/",
          snapshot.total_steps
        ] })
      ]
    }
  );
}
function ProgressDetails(props) {
  const info = props.useTabInfo();
  const { snapshot, failed, now } = useProgress(props, info.tab.visible);
  const [selected, setSelected] = (0, import_react8.useState)();
  const previewVisible = (0, import_react8.useSyncExternalStore)(
    props.previewVisible.subscribe,
    props.previewVisible.getSnapshot
  );
  (0, import_react8.useEffect)(() => setSelected(void 0), [snapshot?.run_id]);
  if (!snapshot)
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-test-preview-message", children: "\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u6D4B\u8BD5\u8BA1\u5212" });
  const instance = snapshot.instances.find((entry) => entry.id === selected) ?? selectedInstance(snapshot);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "dsh-test-details", "aria-label": "\u6D4B\u8BD5\u6B65\u9AA4\u8BE6\u60C5", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h2", { children: snapshot.title }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Heading, { state: snapshot, now, failed }),
    snapshot.rationale && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-test-muted", children: snapshot.rationale }),
    snapshot.instances.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
      "select",
      {
        "aria-label": "\u67E5\u770B\u6D4B\u8BD5\u5B9E\u4F8B",
        value: instance?.id ?? "",
        onChange: (event) => setSelected(event.target.value),
        children: snapshot.instances.map((entry, i) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("option", { value: entry.id, children: [
          i + 1,
          ". ",
          entry.name,
          " \xB7 ",
          entry.data_id,
          " \xB7",
          " ",
          statusLabels[entry.status] ?? entry.status
        ] }, entry.id))
      }
    ),
    instance && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(StepFlow, { steps: instance.steps, now, details: true }),
      ["setup", "cleanup"].map(
        (phase) => instance[phase].length > 0 && /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("summary", { children: phase === "setup" ? "\u73AF\u5883\u51C6\u5907" : "\u8D44\u6E90\u6E05\u7406" }),
          instance[phase].map((step) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { children: [
            step.description,
            " \xB7",
            " ",
            statusLabels[step.status] ?? step.status,
            " \xB7",
            " ",
            duration(elapsed2(step, now))
          ] }, step.id))
        ] }, phase)
      )
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-test-actions", children: [
      snapshot.preview.ready && !failed && snapshot.phase !== "finished" && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "button",
        {
          type: "button",
          "aria-pressed": previewVisible,
          onClick: () => props.openPreview(snapshot),
          children: previewVisible ? "\u9690\u85CF\u5B9E\u65F6\u753B\u9762" : "\u663E\u793A\u5B9E\u65F6\u753B\u9762"
        }
      ),
      snapshot.report_url && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("a", { href: snapshot.report_url, target: "_blank", rel: "noreferrer", children: "\u67E5\u770B\u6D4B\u8BD5\u62A5\u544A" }),
      snapshot.phase === "finished" && /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        RebuildReport,
        {
          rebuildReport: props.rebuildReport,
          runId: snapshot.run_id
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("small", { children: "\u65F6\u95F4\u5305\u542B\u7B49\u5F85" })
    ] })
  ] });
}
function PreviewPanel(props) {
  const info = props.useTabInfo();
  const { snapshot, failed } = useProgress(props, info.tab.visible);
  (0, import_react8.useEffect)(() => {
    if (snapshot?.phase === "finished" || snapshot === null)
      info.tab.actions.close();
  }, [snapshot?.phase, snapshot === null, info.tab.actions]);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "section",
    {
      className: "dsh-test-preview",
      "data-test-browser-preview": true,
      "aria-label": "\u6D4F\u89C8\u5668\u5B9E\u65F6\u753B\u9762",
      children: snapshot?.preview.ready && snapshot.preview.src && !failed ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        "iframe",
        {
          title: "\u6D4F\u89C8\u5668\u5B9E\u65F6\u753B\u9762",
          src: snapshot.preview.src,
          sandbox: "allow-scripts allow-same-origin"
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-test-preview-message", children: failed ? "\u753B\u9762\u8FDE\u63A5\u6682\u4E0D\u53EF\u7528" : snapshot?.preview.reason ?? "\u6B63\u5728\u8FDE\u63A5\u5F53\u524D\u6D4F\u89C8\u5668\u753B\u9762" })
    }
  );
}

// src/client/style.ts
var progressStyle = `
.dsh-test-card{--dsh-test-accent:color-mix(in srgb,#009fe8 70%,var(--dsw-alias-label-primary,#0f172a) 30%);--dsh-test-line:color-mix(in srgb,#38bdf8 28%,var(--dsw-alias-border-l1,#d6eaf5) 72%);--dsh-test-state-color:var(--dsh-test-accent);box-sizing:border-box;container-type:inline-size;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px));max-width:var(--dsh-composer-card-max-width,952px);margin:6px auto 16px;padding:18px 20px 15px;border:1px solid var(--dsh-test-line);border-radius:12px;background:color-mix(in srgb,var(--dsw-specific-input-major,#fff) 94%,#38bdf8 6%);color:var(--dsw-alias-label-primary,#0f172a);font:inherit;font-size:14px;line-height:1.5;animation:dsh-test-enter .18s ease-out}
.dsh-test-card-error{--dsh-test-state-color:var(--dsw-alias-state-error-primary,#be3b45)}
.dsh-test-card-heading{display:grid;grid-template-columns:auto minmax(0,1fr) auto 28px;gap:12px;align-items:center;min-width:0}.dsh-test-card-phase{display:flex;align-items:center;gap:8px;color:var(--dsh-test-state-color);font-size:16px;font-weight:600;white-space:nowrap}.dsh-test-card svg{flex:none;vertical-align:middle}.dsh-test-card-title{min-width:0;padding-left:12px;border-left:1px solid var(--dsh-test-line);font-size:15px;font-weight:600;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.dsh-test-card-time{display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:13px;color:var(--dsw-alias-label-secondary,#64748b);font-variant-numeric:tabular-nums}
.dsh-test-card button,.dsh-test-card a{font:inherit;color:var(--dsh-test-accent);cursor:pointer}.dsh-test-card button{border:0;background:transparent}.dsh-test-card a{text-decoration:none}.dsh-test-card button:focus-visible,.dsh-test-card a:focus-visible,.dsh-test-step-list:focus-visible{outline:2px solid var(--dsh-test-accent);outline-offset:3px;border-radius:4px}.dsh-test-card .dsh-test-fold{display:grid;place-items:center;padding:5px;border-radius:5px}.dsh-test-fold:hover{background:color-mix(in srgb,#38bdf8 10%,transparent)}
.dsh-test-meter{height:5px;background:color-mix(in srgb,#38bdf8 16%,transparent);border-radius:99px;margin-top:13px;overflow:hidden}.dsh-test-meter>span{display:block;height:100%;background:#38bdf8;border-radius:inherit;transition:width .2s ease-out}.dsh-test-card-count{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;color:var(--dsw-alias-label-secondary,#64748b);font-size:13px;font-variant-numeric:tabular-nums}.dsh-test-card-count>span{color:var(--dsh-test-state-color)}.dsh-test-card [hidden]{display:none}.dsh-test-card-body{max-height:max(100px,calc(100dvh - 380px));overflow-y:auto;overscroll-behavior:contain}
.dsh-test-focus{display:flex;align-items:flex-start;gap:20px;margin-top:17px;padding-top:17px;border-top:1px solid var(--dsh-test-line)}.dsh-test-focus-marker{display:flex;align-items:center;gap:12px;min-width:160px;flex:none}.dsh-test-focus-number{box-sizing:border-box;display:grid;place-items:center;min-width:50px;height:50px;padding:0 6px;border-radius:99px;background:color-mix(in srgb,var(--dsw-specific-input-major,#fff) 87%,#38bdf8 13%);color:var(--dsh-test-state-color);font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}.dsh-test-focus-label{color:var(--dsh-test-state-color);font-size:14px;white-space:nowrap;border-left:1px solid var(--dsh-test-line);padding-left:12px}.dsh-test-focus-label small{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#64748b);margin-top:3px}.dsh-test-focus-content{flex:1;min-width:0;padding-left:20px;border-left:1px solid var(--dsh-test-line)}.dsh-test-focus-description{margin:0;font-size:19px;font-weight:600;line-height:1.55;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.dsh-test-focus-description[data-expanded=true]{display:block;max-height:140px;overflow:auto;overscroll-behavior:contain}.dsh-test-focus-meta{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:7px;font-size:13px;color:var(--dsw-alias-label-secondary,#64748b);font-variant-numeric:tabular-nums}.dsh-test-focus-meta>span{display:inline-flex;align-items:center;gap:5px;max-width:100%;min-width:0}.dsh-test-focus-next{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-test-card .dsh-test-text-toggle{font-size:12px;padding:4px 0 0}.dsh-test-text-toggle:hover{text-decoration:underline}
.dsh-test-card-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px 16px;margin-top:16px}.dsh-test-card-actions>button,.dsh-test-card-actions>a{display:inline-flex;align-items:center;gap:7px;padding:4px 0;font-size:14px}.dsh-test-card-actions>button:hover,.dsh-test-card-actions>a:hover{text-decoration:underline}.dsh-test-card-actions>small{margin-left:auto;font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#94a3b8)}
.dsh-test-step-list{max-height:min(240px,26vh,max(80px,calc(100dvh - 560px)));overflow:auto;overscroll-behavior:contain;border-top:1px solid var(--dsh-test-line);margin-top:10px;padding-top:4px;scrollbar-gutter:stable}.dsh-test-step-list ol{list-style:none;margin:0;padding:0}.dsh-test-step-list ol>li{border-bottom:1px solid var(--dsw-alias-border-l1,#e5e9ef)}.dsh-test-card .dsh-test-step-row{box-sizing:border-box;display:grid;grid-template-columns:50px minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;padding:10px 8px;text-align:left;border-radius:6px;color:inherit;font-size:13px;line-height:1.5}.dsh-test-step-row:hover,.dsh-test-step-row[aria-expanded=true]{background:color-mix(in srgb,#38bdf8 7%,transparent)}.dsh-test-step-row[aria-current=step]{background:color-mix(in srgb,#38bdf8 13%,transparent)}.dsh-test-step-position{display:flex;align-items:center;justify-content:flex-start;gap:6px;font-variant-numeric:tabular-nums;color:var(--dsh-test-accent)}.dsh-test-step-copy{min-width:0}.dsh-test-step-copy>span{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}.dsh-test-step-copy>small{display:block;color:var(--dsw-alias-label-secondary,#64748b);font-size:11px;overflow-wrap:anywhere}.dsh-test-step-result{font-size:12px;color:var(--dsw-alias-label-secondary,#64748b);text-align:right;white-space:nowrap}.dsh-test-step-result>small{display:block;font-size:11px;font-variant-numeric:tabular-nums}.dsh-test-step-list [data-tone=error] .dsh-test-step-position,.dsh-test-step-list [data-tone=error] .dsh-test-step-result{color:var(--dsw-alias-state-error-primary,#be3b45)}.dsh-test-step-inspection{padding:0 8px 12px 68px;font-size:12px;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,#64748b)}.dsh-test-step-inspection p{margin:6px 0}.dsh-test-step-inspection ul{padding-left:18px}.dsh-test-card .dsh-test-more-details{font-size:12px;padding:9px 8px}
@container (max-width:560px){.dsh-test-card-heading{grid-template-columns:minmax(0,1fr) auto 28px;gap:8px}.dsh-test-card-phase{grid-column:1;grid-row:1}.dsh-test-card-title{grid-column:1/-1;grid-row:2;border-left:0;padding-left:0;font-size:13px}.dsh-test-card-time{grid-column:2;grid-row:1;font-size:11px}.dsh-test-fold{grid-column:3;grid-row:1}.dsh-test-focus{gap:12px;padding-top:12px;margin-top:12px}.dsh-test-focus-marker{flex-direction:column;gap:5px;min-width:0;align-items:center}.dsh-test-focus-number{min-width:38px;height:38px;font-size:17px}.dsh-test-focus-label{font-size:11px;border-left:0;padding-left:0}.dsh-test-focus-content{padding-left:12px}.dsh-test-focus-description{font-size:14px}.dsh-test-card-actions{gap:5px 12px;margin-top:12px}.dsh-test-card-actions>small{flex-basis:100%;margin-left:0}.dsh-test-card .dsh-test-step-row{grid-template-columns:35px minmax(0,1fr) auto;gap:6px;padding:9px 3px;font-size:12px}.dsh-test-step-position{gap:3px}.dsh-test-step-position svg{width:13px;height:13px}.dsh-test-step-result{font-size:11px}.dsh-test-step-inspection{padding-left:44px}}
@keyframes dsh-test-spin{to{transform:rotate(360deg)}}.dsh-test-spin{animation:dsh-test-spin 1.3s linear infinite}@media(prefers-reduced-motion:reduce){.dsh-test-spin,.dsh-test-card{animation:none}.dsh-test-meter>span{transition:none}}
.dsh-test-command-notice{font:inherit;font-size:12px;line-height:1.6;margin:8px 0;padding:10px 12px;border:1px solid var(--dsw-alias-state-error-primary,#be3b45);border-radius:6px;color:var(--dsw-alias-label-primary,#253041)}.dsh-test-command-notice p{margin:0;overflow-wrap:anywhere}.dsh-test-recovery[data-state=ready]{border-color:var(--dsw-alias-border-l1,#e5e9ef)}
.dsh-test-recovery{font:inherit;font-size:12px;line-height:1.6;margin:8px 0;padding:10px 12px;border:1px solid var(--dsw-alias-state-error-primary,#be3b45);border-radius:6px;color:var(--dsw-alias-label-primary,#253041)}.dsh-test-recovery p{margin:6px 0}.dsh-test-recovery [role=alert]{color:var(--dsw-alias-state-error-primary,#be3b45)}.dsh-test-recovery details{margin:6px 0}.dsh-test-recovery code{overflow-wrap:anywhere}.dsh-test-recovery-confirm{border-top:1px solid var(--dsw-alias-border-l1,#e5e9ef);margin-top:9px;padding-top:9px}.dsh-test-recovery-confirm label{display:flex;align-items:flex-start;gap:6px}.dsh-test-recovery .dsh-test-actions button:disabled{opacity:.5;cursor:default;text-decoration:none}
.dsh-test-details{color:var(--dsw-alias-label-primary,#253041);font:inherit;font-size:12px;line-height:1.5}
.dsh-test-header{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font:11px system-ui,sans-serif;padding:4px 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary,#64748b);cursor:pointer}.dsh-test-header:hover{background:var(--dsw-alias-interactive-bg-hover,#edf2f8)}.dsh-test-header span{color:var(--dsw-alias-link,#3873cf);font-variant-numeric:tabular-nums}

.dsh-test-report-control{display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px 12px;min-width:0;font-size:13px}.dsh-test-report-control [role=alert]{overflow-wrap:anywhere;color:var(--dsw-alias-state-error-primary,#be3b45)}.dsh-test-report-control button:disabled{opacity:.5;cursor:default}.dsh-test-settings>section{margin:24px 0}.dsh-test-actions{flex-wrap:wrap}
.dsh-test-heading{display:flex;align-items:center;gap:8px;min-width:0}.dsh-test-heading strong{font-size:12px;font-weight:600}.dsh-test-heading .dsh-test-time{margin-left:auto;white-space:nowrap;color:var(--dsw-alias-label-secondary,#64748b);font-variant-numeric:tabular-nums}
.dsh-test-phase{color:var(--dsw-alias-link,#3873cf)}.dsh-test-actions{display:flex;gap:8px;align-items:center;margin-top:7px}.dsh-test-actions button{font:inherit;color:var(--dsw-alias-link,#3873cf);background:transparent;border:0;padding:3px 0;cursor:pointer}.dsh-test-actions button:hover{text-decoration:underline}.dsh-test-actions small{color:var(--dsw-alias-label-tertiary,#94a3b8);margin-left:auto}.dsh-test-actions a{color:var(--dsw-alias-link,#3873cf)}
.dsh-test-flow{display:flex;gap:12px;list-style:none;padding:0;margin:0;overflow-x:auto}.dsh-test-flow>li{flex:1;min-width:100px;position:relative;padding-top:4px}.dsh-test-flow>li:not(:last-child)::after{content:'';position:absolute;height:1px;background:var(--dsw-alias-border-l1,#dde3ec);top:14px;left:28px;right:-8px}.dsh-test-node{position:relative;z-index:1;width:20px;height:20px;display:grid;place-items:center;border-radius:50%;color:var(--dsw-alias-label-secondary,#64748b);background:var(--dsw-specific-menu,#f2f5fa);border:1px solid var(--dsw-alias-border-l1,#dde3ec);font-size:10px;transition:background .2s,color .2s,border-color .2s}.dsh-test-step-name{display:block;margin-top:5px;max-width:180px;line-height:1.45}.dsh-test-step-time{display:block;color:var(--dsw-alias-label-tertiary,#94a3b8);font-size:11px;font-variant-numeric:tabular-nums;margin-top:2px}.dsh-test-running .dsh-test-node{background:var(--dsw-alias-link,#3873cf);border-color:transparent;color:white;animation:dsh-test-pulse 1.8s ease-in-out infinite}.dsh-test-pass .dsh-test-node{color:var(--dsw-alias-link,#3873cf);border-color:var(--dsw-alias-link,#3873cf)}.dsh-test-error .dsh-test-node{color:var(--dsw-alias-state-error-primary,#be3b45);border-color:currentColor}.dsh-test-muted{color:var(--dsw-alias-label-tertiary,#94a3b8)}
.dsh-test-details{height:100%;overflow:auto;padding:18px 18px 24px}.dsh-test-details h2{font-size:15px;margin:0 0 10px;line-height:1.5}.dsh-test-details select{font:inherit;color:inherit;background:var(--dsw-specific-menu,#f6f8fb);border:1px solid var(--dsw-alias-border-l1,#dde3ec);padding:6px 8px;width:100%;margin:12px 0}.dsh-test-details .dsh-test-flow{display:block;overflow:visible}.dsh-test-details .dsh-test-flow>li{padding:0 0 20px 34px;min-width:0}.dsh-test-details .dsh-test-node{position:absolute;left:0;top:1px}.dsh-test-details .dsh-test-flow>li:not(:last-child)::after{left:10px;right:auto;top:26px;bottom:5px;width:1px;height:auto}.dsh-test-details .dsh-test-step-name{margin:0;max-width:none;font-size:13px}.dsh-test-checks{margin:7px 0 0;padding-left:16px;color:var(--dsw-alias-label-secondary,#64748b)}.dsh-test-checks li{padding:2px 0}.dsh-test-details details{border-top:1px solid var(--dsw-alias-border-l1,#e5e9ef);padding-top:10px;margin-top:10px}.dsh-test-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#64748b)}.dsh-test-details details p{margin:8px 0}.dsh-test-reason{color:var(--dsw-alias-state-error-primary,#be3b45);margin-top:5px}.dsh-test-preview{height:100%;min-height:180px;display:flex;flex-direction:column;background:var(--dsw-specific-menu,#f6f8fb)}.dsh-test-preview iframe{width:100%;flex:1;min-height:0;border:0}.dsh-test-preview-message{margin:auto;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary,#64748b);font-size:12px}
@keyframes dsh-test-enter{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}@keyframes dsh-test-pulse{50%{opacity:.65}}@media(prefers-reduced-motion:reduce){.dsh-test-card,.dsh-test-running .dsh-test-node{animation:none}.dsh-test-node{transition:none}}
.dsh-test-settings{color:var(--dsw-alias-label-primary,#253041);font:inherit;font-size:13px;line-height:1.6;max-width:650px}.dsh-test-settings h2{font-size:18px;font-weight:600;margin:0 0 12px}.dsh-test-settings p{margin:8px 0 16px}.dsh-test-settings fieldset{border:0;padding:0;margin:20px 0}.dsh-test-settings fieldset>label{display:block;font-weight:500;margin:18px 0 7px}.dsh-test-settings input:not([type=checkbox]),.dsh-test-settings select{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1,#d6dde7);border-radius:6px;background:var(--dsw-specific-menu,#f6f8fb);color:inherit;font:inherit}.dsh-test-settings input:focus,.dsh-test-settings select:focus{outline:2px solid var(--dsw-alias-link,#3873cf);outline-offset:2px}.dsh-test-setting-switch{display:flex;align-items:center;gap:9px;font-weight:500}.dsh-test-setting-switch input{accent-color:var(--dsw-alias-link,#3873cf)}.dsh-test-settings .dsh-test-setting-hint{color:var(--dsw-alias-label-secondary,#64748b);font-size:12px;margin-top:6px}.dsh-test-setting-actions{display:flex;gap:10px}.dsh-test-setting-actions button{font:inherit;padding:8px 14px;border:1px solid var(--dsw-alias-border-l1,#d6dde7);border-radius:6px;background:transparent;color:inherit;cursor:pointer}.dsh-test-setting-actions button[type=submit]{background:var(--dsw-alias-link,#3873cf);color:white;border-color:transparent}.dsh-test-setting-actions button:disabled{opacity:.5;cursor:default}.dsh-test-settings [role=alert]{color:var(--dsw-alias-state-error-primary,#be3b45)}
.dsh-test-command-advanced{margin:18px 0}.dsh-test-command-advanced summary{cursor:pointer;font-weight:500}.dsh-test-command-advanced label{display:block;margin:12px 0 7px}.dsh-test-command-check{margin:12px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#d6dde7);border-radius:6px;overflow-wrap:anywhere}.dsh-test-command-check p{margin:4px 0}.dsh-test-command-check code{font-size:12px}.dsh-test-preview-note{font-size:12px;line-height:1.6;overflow-wrap:anywhere;margin:10px 0 0;padding:8px 10px;border-top:1px solid var(--dsh-test-line);color:var(--dsw-alias-label-secondary,#64748b)}.dsh-test-preview-note span{display:block}
.dsh-test-settings{display:flex;flex-direction:column;min-width:0}.dsh-test-settings form{order:1}.dsh-test-settings .dsh-test-recovery{order:2}.dsh-test-settings .dsh-test-recovery[data-state=blocked]{order:-1}.dsh-test-settings .dsh-test-recovery[data-state=ready]{border:0;padding:0;font-size:12px;color:var(--dsw-alias-label-secondary,#64748b)}.dsh-test-settings .dsh-test-report-maintenance{order:3;border-top:1px solid var(--dsw-alias-border-l1,#d6dde7);padding-top:16px;margin-top:16px}.dsh-test-settings h3{font-size:15px;font-weight:600;margin:26px 0 10px}.dsh-test-settings label{display:block;font-weight:500;margin:16px 0 7px}.dsh-test-settings .dsh-test-setting-switch{display:flex;align-items:center;gap:9px}.dsh-test-settings input[type=checkbox]{flex:none}.dsh-test-settings .dsh-test-config-state{font-size:12px;margin:0 0 12px;color:var(--dsw-alias-label-secondary,#64748b)}.dsh-test-settings .dsh-test-setting-actions{flex-wrap:wrap;align-items:center}.dsh-test-settings .dsh-test-setting-actions a{color:var(--dsw-alias-link,#3873cf);font-size:12px}.dsh-test-settings button:focus-visible,.dsh-test-settings a:focus-visible,.dsh-test-settings summary:focus-visible{outline:2px solid var(--dsw-alias-link,#3873cf);outline-offset:3px}.dsh-test-settings .dsh-test-settings-save{background:var(--dsw-specific-menu,#fff);border-top:1px solid var(--dsw-alias-border-l1,#d6dde7);padding:12px 0;margin-top:16px}.dsh-test-settings pre{font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:var(--dsw-specific-menu,#f6f8fb);border:1px solid var(--dsw-alias-border-l1,#d6dde7);border-radius:6px}.dsh-test-settings dl{display:grid;grid-template-columns:minmax(80px,120px) minmax(0,1fr);gap:6px 12px;font-size:12px;min-width:0;margin:16px 0}.dsh-test-settings dt{color:var(--dsw-alias-label-secondary,#64748b)}.dsh-test-settings dd{margin:0;min-width:0;overflow-wrap:anywhere}.dsh-test-settings .dsh-test-inline-action{border:0;background:transparent;color:var(--dsw-alias-link,#3873cf);font:inherit;margin-left:8px;cursor:pointer}
`;

// src/client/index.ts
var name = "harness-test-ui";
var inject = [
  "slots",
  "sidebarRightTabs",
  "sidebarRight",
  "remote",
  "uiSession"
];
var progressKind = "harness-test-progress";
var previewKind = "harness-test-preview";
var progressId = "dsh-test-plugin:progress";
var previewId = "dsh-test-plugin:preview";
var testCommands = /* @__PURE__ */ new Set(["test", "test-plan", "test-run", "test-data"]);
function apply(ctx) {
  const currentSession = () => ctx.uiSession.adapter.current.getSnapshot().key;
  const post = async (action, body) => {
    const response = await fetch(`/test-ui/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw new Error(result.message ?? "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u8FDE\u63A5\u540E\u91CD\u8BD5\u3002");
    return result.value;
  };
  const clearNotices = () => {
    for (const record of faces.values()) record.setNotice("");
  };
  const recovery = {
    readRecovery: async (signal) => {
      const response = await fetch("/test-recovery", {
        signal,
        cache: "no-store"
      });
      if (!response.ok) throw new Error("\u9694\u79BB\u72B6\u6001\u8BFB\u53D6\u5931\u8D25");
      return await response.json();
    },
    recover: async (token) => {
      const sessionId = currentSession();
      if (!sessionId)
        throw new Error(
          "\u8BF7\u5148\u5173\u95ED\u8BBE\u7F6E\u5E76\u6253\u5F00\u4E00\u4E2A\u5BF9\u8BDD\uFF0C\u518D\u8FDB\u5165\u6D4B\u8BD5\u63D2\u4EF6\u8BBE\u7F6E\u91CA\u653E\u73AF\u5883\u3002"
        );
      const message = await post("recover", {
        session_id: sessionId,
        token
      });
      clearNotices();
      return message;
    },
    releaseEvidence: async (file, token) => {
      const message = await post("release", {
        evidence_file: file,
        token
      });
      clearNotices();
      return message;
    }
  };
  ctx.inject(["configForms"], (settings) => {
    settings.slots.inject(
      "settings.section",
      () => settings.slots.register(
        {
          name: "settings.section",
          id: "harness-test",
          order: 35,
          label: () => "\u6D4B\u8BD5\u63D2\u4EF6",
          inject: () => ({
            forms: settings.configForms,
            ...recovery,
            rebuildReport: (runId) => post("report", {
              session_id: currentSession(),
              run_id: runId
            }),
            describeReport: (runId) => post("report-target", {
              session_id: currentSession(),
              run_id: runId
            })
          })
        },
        PreviewSettingsPage
      )
    );
  });
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "dsh-test-plugin";
    style.textContent = progressStyle;
    document.head.append(style);
    return () => style.remove();
  });
  for (const [id, kind, title] of [
    [progressId, progressKind, "\u6D4B\u8BD5\u8FDB\u5EA6"],
    [previewId, previewKind, "\u6D4F\u89C8\u5668\u5B9E\u65F6\u753B\u9762"]
  ])
    ctx.effect(
      () => ctx.sidebarRightTabs.register({ id, kind, title: () => title })
    );
  const faces = /* @__PURE__ */ new Map();
  const face = (sessionId) => {
    const existing = faces.get(sessionId);
    if (existing) return existing.actions;
    let notice = "";
    const listeners = /* @__PURE__ */ new Set();
    const setNotice = (message) => {
      if (notice === message) return;
      notice = message;
      for (const listener of listeners) listener();
    };
    const opened = /* @__PURE__ */ new Set();
    let tabId;
    let previewRun;
    const foreground = () => ctx.sidebarRight.mounted.getSnapshot() === sessionId;
    const previewTabs = () => ctx.sidebarRight.openTabs.getSnapshot().filter(
      (tab) => tab.sessionId === sessionId && tab.kind === previewKind
    );
    const closePreview = () => {
      for (const tab of previewTabs()) ctx.sidebarRight.close(tab.tabId);
      tabId = void 0;
      previewRun = void 0;
    };
    const showPreview = (state) => {
      if (!foreground() || !state.preview.ready || state.preview.failed || state.phase === "finished")
        return;
      const expanded = ctx.sidebarRight.isExpanded();
      const existing2 = previewTabs();
      if (existing2.length) {
        tabId = existing2[0].tabId;
        for (const duplicate of existing2.slice(1))
          ctx.sidebarRight.close(duplicate.tabId);
        ctx.sidebarRight.focus(tabId);
      } else {
        ctx.sidebarRight.openTab(previewKind);
        const tab = ctx.sidebarRight.active();
        if (tab?.kind !== previewKind) return;
        tabId = tab.id;
      }
      previewRun = state.run_id;
      opened.add(state.run_id);
      ctx.sidebarRight.float(tabId);
      if (!expanded && ctx.sidebarRight.isExpanded())
        ctx.sidebarRight.toggleExpanded();
    };
    const actions = {
      notice: {
        getSnapshot: () => notice,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        dismiss: () => setNotice("")
      },
      read: async (signal) => {
        const response = await fetch(
          `/test-progress/${encodeURIComponent(sessionId)}`,
          { signal, cache: "no-store" }
        );
        if (!response.ok) throw new Error("\u8FDB\u5EA6\u8BFB\u53D6\u5931\u8D25");
        const state = await response.json();
        if (state && state.session_id !== sessionId)
          throw new Error("\u8FDB\u5EA6\u4F1A\u8BDD\u4E0D\u5339\u914D");
        return state;
      },
      openDetails: () => {
        if (foreground())
          ctx.sidebarRight.openTab(progressKind, { preferNewPane: true });
      },
      rebuildReport: (runId) => post("report", {
        session_id: sessionId,
        run_id: runId
      }),
      previewVisible: {
        getSnapshot: () => previewTabs().length > 0,
        subscribe: (listener) => ctx.sidebarRight.openTabs.subscribe(listener)
      },
      openPreview: (state) => {
        if (!foreground() || !state.preview.ready || state.preview.failed || state.phase === "finished")
          return;
        opened.add(state.run_id);
        if (previewTabs().length) closePreview();
        else showPreview(state);
      },
      followPreview: (state) => {
        if (!foreground()) return;
        if (previewRun && state.run_id !== previewRun || state.phase === "finished" || state.preview.failed) {
          closePreview();
        }
        if (state.preview.ready && !state.preview.failed && state.phase !== "finished" && !opened.has(state.run_id))
          showPreview(state);
      }
    };
    faces.set(sessionId, { actions, setNotice });
    return actions;
  };
  ctx.on("command/executed", (sessionId, command, result) => {
    if (!testCommands.has(command)) return;
    face(sessionId);
    faces.get(sessionId).setNotice(
      result.kind === "error" ? (result.text ?? "\u6D4B\u8BD5\u547D\u4EE4\u6267\u884C\u5931\u8D25").replace(/^Error:\s*/, "") : ""
    );
  });
  ctx.slots.inject(
    "conversation.input.dock",
    () => ctx.slots.register(
      {
        name: "conversation.input.dock",
        id: "harness-test-progress",
        order: 20,
        inject: (sessionId) => face(sessionId)
      },
      ProgressDock
    )
  );
  ctx.slots.inject(
    "conversation.session.header.actions",
    () => ctx.slots.register(
      {
        name: "conversation.session.header.actions",
        id: "harness-test-progress",
        order: 20,
        inject: (sessionId) => face(sessionId)
      },
      ProgressHeader
    )
  );
  ctx.slots.inject(
    "sidebar.right.pane.tab",
    () => ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: progressId,
        inject: (sessionId) => face(sessionId)
      },
      ProgressDetails
    )
  );
  ctx.slots.inject(
    "sidebar.right.pane.tab",
    () => ctx.slots.register(
      {
        name: "sidebar.right.pane.tab",
        key: previewId,
        inject: (sessionId) => face(sessionId)
      },
      PreviewPanel
    )
  );
}
return module.exports;}});
//# sourceMappingURL=client.js.map
