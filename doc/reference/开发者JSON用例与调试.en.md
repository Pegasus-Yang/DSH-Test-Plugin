# Developer JSON suites and debugging

JSON execution files are retained for development, debugging, and generated regression suites. User-facing commands and guides recommend TXT, Markdown, and CSV parameters. JSON execution still uses the current conversation's model and native tools.

[简体中文](开发者JSON用例与调试.md) · [User guide](../user-guide/使用说明.en.md)

## Creating an internal suite

/test-run still accepts a complete TestSuite JSON file within the invoking conversation's workspace. Required root fields are schema_version (the string “1”), suite_id, name, source_refs, and cases. Cases define datasets, preconditions, steps, and cleanup. Optional planning requires original_task and rationale; without a separate original description, the manual case leaves it blank.

The plan.json saved by natural-language planning contains intent steps; batch inputs also include planning.input. The JSON execution parser rejects these internal textual plans. Runtime definitions stay in effective_steps. actual-steps.json is an execution record. There is no generic export from a text run to a reusable executable JSON suite.

Observation paths use dots and numeric array segments, such as request.response.body.0.iid. Text bindings reject body[0] syntax. A full HTTP response is declared as an object; bind its status field for numeric status checks. Body subfields retain business failure behavior, and expected values never come from the observed response.

Copy a validated [browser sample](../../examples/ceshiren-agent.json) or [API sample](../../examples/httpbin-get.json), adapt the contract and independent expectations, then invoke /test-run file.json. GitLab preparation continues to save api.json, ui.json, all.json, and individual UI files for the 17-case developer regression. Its default printed commands use the five-case Markdown user set. Use fresh preparation data for separate UI runs; generation does not change expected values based on current responses.

## Private records

Keep real credentials and generated files under the ignored private directory. Text inputs and snapshots can contain original input; manual Markdown intentionally contains real inputs. Audit records use the existing redaction rules. Missing cleanup conditions and invalid references are rejected. Preserve recorded failures and independent expected values for meaningful regression.


## JSON suites and assertion contracts

See [the browser suite](../../examples/ceshiren-agent.json) and [the API suite](../../examples/httpbin-get.json). Use JSON when concrete execution definitions are already known; natural-language planning does not require these fields.

- A suite contains cases; each case's datasets expand into separate instances. Empty datasets create a default row.
- Setup, business, and cleanup share a step structure. IDs are unique across a case's phases; the `__` prefix is reserved. Dependencies point to earlier steps.
- Each case needs at least one required business assertion. Required steps cannot depend on optional outputs.
- JSON actions declare targets, goals, inputs, output schemas, and required outputs. Capture is fixed by default; `capture_mode: "runtime"` permits runtime capture binding within the declared contract.
- Inputs may use `{"input_ref":"data.inputs.key"}`, `{"resource_ref":"browser_context"}`, `{"literal":value}`, or a direct JSON value. The current resource registry supports exclusive browser contexts.

| Capture kind | Meaning |
| --- | --- |
| `dom` | Fixed read-only DOM extraction using a selector and mode; require a unique match unless an explicit zero-based index is supplied |
| `http` | GET JSON response through the native tool pipeline; use paths such as `body.amount` |
| `browser_close` | Close the Playwright context and record `released=true` only after a successful tool response |

DOM modes are `text`, `number`, `count`, `visible`, `url`, `attribute`, and `value`. URL extraction defaults to the full URL; `field: "pathname"` selects the path. Numeric extraction does not turn a missing or blank value into zero. Captured observations are bound once and cannot be overwritten.

Assertions support `eq`, `neq`, `contains`, `range`, `exists`, `text`, and `visible`. Choose exactly one expected-value source: a literal, a dataset expectation, or another observation; supply a rule source in `source_refs`. Ranges require two numeric bounds, a unit, and tolerance. Required missing evidence causes ERROR; optional missing evidence can make the relevant assertion INCONCLUSIVE.

The model may append checks supported by existing rule sources to future boundaries of unfinished instances. Required additions can affect those instances' outcomes. Existing steps, expectations, and finished outcomes are not rewritten. Adding new authority, business writes, or broader permissions requires a new confirmed plan.
