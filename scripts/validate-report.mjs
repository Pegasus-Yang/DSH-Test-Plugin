/** 核对账本、真实观察、断言、附件及离线报告。不会调用模型或测试工具。 */
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { rebuild, ledgerEvents } from "../dist/recorder.js";
import { mcpResult } from "../dist/adapters.js";
import { field } from "../dist/contracts.js";
const dir = resolve(process.argv[2]);
const run = JSON.parse(await readFile(join(dir, "results.json"), "utf8"));
assert.deepEqual(await rebuild(dir), run);
const producers = new Set(
  run.instances.flatMap((i) =>
    i.steps.flatMap((s) => s.observations.map((o) => o.producer.call_id)),
  ),
);
const boundCalls = new Map(),
  finishedCalls = new Map();
for await (const event of ledgerEvents(dir)) {
  if (!producers.has(event.payload?.call_id)) continue;
  if (event.type === "tool_bound")
    boundCalls.set(event.payload.call_id, event.seq);
  if (event.type === "tool_finished")
    finishedCalls.set(event.payload.call_id, event.seq);
}
for (const e of run.evidence) {
  const bytes = await readFile(join(dir, e.relative_path));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), e.sha256);
}
for (const instance of run.instances)
  for (const step of instance.steps) {
    for (const o of step.observations) {
      assert.equal(o.binding.case_run_id, instance.case_run_id);
      const bound = boundCalls.get(o.producer.call_id);
      const settled = finishedCalls.get(o.producer.call_id);
      assert(bound !== undefined && settled !== undefined && bound < settled);
      const evidence = run.evidence.find(
        (e) => e.evidence_id === o.evidence_refs[0],
      );
      const raw = JSON.parse(
        await readFile(join(dir, evidence.relative_path), "utf8"),
      );
      if (o.producer.adapter === "playwright-dom-v1")
        assert.deepEqual(
          field(mcpResult(raw.value), o.producer.field),
          o.value,
        );
      if (o.producer.adapter === "http-json-v1")
        assert.deepEqual(field(raw.value, o.producer.field), o.value);
    }
    if (step.assertion) {
      const observation = instance.steps
        .flatMap((s) => s.observations)
        .find(
          (o) =>
            o.observation_id ===
            step.assertion.operand_snapshot.actual_observation_id,
        );
      const snap = step.assertion.operand_snapshot;
      assert.deepEqual(
        field(
          observation.value,
          snap.actual_path.split(".").slice(2).join("."),
        ),
        step.assertion.actual,
      );
      const definition = instance.effective_steps.find(
        (s) => s.step_id === step.step_id,
      ).assertion;
      const expectedObservation = instance.steps
        .flatMap((s) => s.observations)
        .find((o) => o.observation_id === snap.expected_observation_id);
      const expected = expectedObservation
        ? field(
            expectedObservation.value,
            snap.expected_path.split(".").slice(2).join("."),
          )
        : definition.expected_ref
          ? field({ data: instance.data }, definition.expected_ref)
          : definition.literal;
      assert.deepEqual(step.assertion.expected, expected);
      if (["eq", "neq"].includes(definition.operator)) {
        const same =
          JSON.stringify(step.assertion.actual) === JSON.stringify(expected);
        const pass =
          definition.operator === "eq"
            ? same
            : typeof step.assertion.actual === typeof expected && !same;
        assert.equal(step.assertion.status, pass ? "PASS" : "FAIL");
      }
    }
  }
if (process.argv.includes("--data-only")) {
  console.log(
    JSON.stringify({
      run_id: run.suite_run_id,
      data_integrity: "PASS",
      evidence_count: run.evidence.length,
      statuses: run.instances.map((i) => i.status),
    }),
  );
  process.exit(0);
}
const copied = resolve("artifacts/validation/offline", run.suite_run_id);
await mkdir(copied, { recursive: true });
await cp(dir, copied, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  offline: true,
  viewport: { width: 1440, height: 1050 },
});
const page = await context.newPage();
const errors = [],
  network = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("request", (r) => {
  if (/^https?:/.test(r.url())) network.push(r.url());
});
try {
  await page.goto(pathToFileURL(join(copied, "report.html")).href);
  assert.equal(
    await page.locator("article.case").count(),
    run.instances.length,
  );
  for (const [i, instance] of run.instances.entries()) {
    const article = page.locator("article.case").nth(i);
    assert.equal(await article.getAttribute("data-status"), instance.status);
    for (const [n, step] of instance.steps.entries()) {
      const row = article.locator(".step").nth(n);
      assert.equal(await row.locator("h3").textContent(), step.description);
      if (step.assertion) {
        const values = await row.locator(".comparison pre").allTextContents();
        assert.deepEqual(values, [
          JSON.stringify(step.assertion.actual, null, 2),
          JSON.stringify(step.assertion.expected, null, 2),
        ]);
        assert.equal(
          await row.locator(".step-title .badge").textContent(),
          step.assertion.status,
        );
      }
    }
  }
  await page.locator("#case").selectOption(run.instances[0].case_id);
  await page.locator("#data").selectOption(run.instances[0].data_id);
  await page.locator("#status").selectOption(run.instances[0].status);
  assert.equal(await page.locator("article.case:visible").count(), 1);
  await page.locator("#status").evaluate((el) => {
    el.add(new Option("不存在", "NONE"));
    el.value = "NONE";
    el.dispatchEvent(new Event("change"));
  });
  assert.equal(await page.locator("#empty").isVisible(), true);
  await page.locator("#clear").click();
  assert.equal(
    await page.locator("article.case:visible").count(),
    run.instances.length,
  );
  await page
    .locator("details")
    .evaluateAll((es) => es.forEach((e) => (e.open = true)));
  const link = page.locator("a.evidence").first();
  if (await link.count()) {
    const href = await link.getAttribute("href");
    const attachment = await context.newPage();
    await attachment.goto(pathToFileURL(join(copied, href)).href);
    await attachment.close();
  }
  await page
    .locator("details")
    .evaluateAll((es) => es.forEach((e) => (e.open = false)));
  await page.screenshot({
    path: join(dir, "report-verified-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: join(dir, "report-verified-mobile.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  const result = {
    run_id: run.suite_run_id,
    instance_count: run.instances.length,
    evidence_count: run.evidence.length,
    event_count: events.length,
    rebuild_equal: true,
    observations_match_raw: true,
    expected_values_match_plan: true,
    rendered_assertions_match: true,
    attachment_hashes: true,
    offline_filters: true,
    empty_filter: true,
    narrow_no_horizontal_overflow: true,
    script_errors: errors,
    network_requests: network,
  };
  await writeFile(
    join(dir, "report-verification.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  await browser.close();
}
