import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { protocolConfigurationFixture } from "../../tests/fixtures/protocol-configuration.ts";

/** The real CLI runs with inert origin/observer fixtures; no browser or network. */
function quoteRunner(target: "sandbox" | "mainnet", interrupted: boolean) {
  const output = mkdtempSync(join(tmpdir(), "cybergold-quote-checkpoint-"));
  const fixture = join(output, "quote-observer.mjs");
  writeFileSync(fixture, `
import { mock } from "node:test";
import { writeFileSync } from "node:fs";
import * as matrix from ${JSON.stringify(fileURLToPath(new URL("../../tests/trading/matrix.ts", import.meta.url)))};
import { resultFor } from ${JSON.stringify(fileURLToPath(new URL("../../tests/trading/regression.ts", import.meta.url)))};
mock.module(${JSON.stringify(fileURLToPath(new URL("../../tests/trading/matrix.ts", import.meta.url)))}, { namedExports: {
  ...matrix, readValuation: async () => ({ id: "synthetic-valuation" }), buildMatrix: () => matrix.matrixTemplates(),
} });
mock.module(${JSON.stringify(fileURLToPath(new URL("../../tests/trading/browserQuotes.ts", import.meta.url)))}, { namedExports: {
  observeBrowserQuotes: async (_origin, _config, _facts, inventory, checkpoint) => {
    const results = [];
    for (const scenario of inventory) {
      results.push({ ...resultFor(scenario, "browser"), id: "ui-" + scenario.id,
        requestedStrategy: "auto", status: "pass", code: undefined, executionStage: "complete",
        providers: { core: { availability: "qualified", searchOutcome: "complete" },
          market: { availability: "unsupported", searchOutcome: "not-run" } } });
      if (checkpoint) await checkpoint(results);
      if (${interrupted}) {
        writeFileSync(${JSON.stringify(join(output, "completed-case.json"))}, JSON.stringify(results[0]));
        // Inject the owned container's force-stop after this case is persisted.
        // Startup speed cannot determine whether the completed case exists.
        process.kill(process.pid, "SIGKILL");
        await new Promise(() => {});
      }
    }
    return results;
  },
} });
const config = ${JSON.stringify(protocolConfigurationFixture)};
globalThis.fetch = async url => new URL(url).pathname === "/en"
  ? new Response('<a data-testid="deployed-commit" title="${"a".repeat(40)}">revision</a>')
  : Response.json(new URL(url).pathname === "/api/protocol/config" ? config : {},
    { headers: { "X-CyberGold-Backend-Revision": "${"b".repeat(40)}" } });
`);
  const child = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--import", fixture,
    "scripts/run-trade-regression.mjs", "--target", target, "--mode", "quotes", "--base-url", "https://fixture.invalid", "--output-dir", output],
  { cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 10_000 });
  return { output, child };
}

for (const target of ["sandbox", "mainnet"] as const) test(`${target} interrupted quote runner retains completed cases without a final report or passing run`, () => {
  const { output, child } = quoteRunner(target, true);
  try {
    assert.equal(child.signal, "SIGKILL", child.stderr); assert.equal(child.error, undefined);
    const completed = JSON.parse(readFileSync(join(output, "completed-case.json"), "utf8"));
    assert.equal(existsSync(join(output, "report.json")), false);
    const checkpoint = JSON.parse(readFileSync(join(output, "regression-ui.json"), "utf8"));
    assert.equal(checkpoint.schema, "cybergold.trade-regression.v1");
    assert.equal(checkpoint.target, target); assert.equal(checkpoint.mode, "quotes");
    assert.deepEqual(checkpoint.scenarios, [completed]);
    assert.equal(checkpoint.matrix.scenarioCount, 48); assert.equal(checkpoint.matrix.providerAssessmentCount, 96);
    assert.equal(checkpoint.runnerOutcome, "unavailable");
    assert.equal(checkpoint.finishedAt, undefined);
    assert.equal(checkpoint.runnerDiagnostics.stage, "ui-report");
    assert.deepEqual(checkpoint.context, { appRevision: "a".repeat(40), backendRevision: "b".repeat(40) });
    assert.equal(checkpoint.valuation.id, "synthetic-valuation");
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test("normal quote completion keeps the final48-case report separate from its incomplete checkpoint", () => {
  const { output, child } = quoteRunner("sandbox", false);
  try {
    assert.equal(child.status, 0, child.stderr); assert.equal(child.signal, null);
    const final = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
    const checkpoint = JSON.parse(readFileSync(join(output, "regression-ui.json"), "utf8"));
    assert.equal(final.runnerOutcome, "pass"); assert.equal(final.runnerDiagnostics.stage, "complete");
    assert.ok(final.finishedAt); assert.equal(final.scenarios.length, 48);
    assert.deepEqual(final.scenarios, checkpoint.scenarios);
    assert.equal(checkpoint.runnerOutcome, "unavailable"); assert.equal(checkpoint.finishedAt, undefined);
  } finally { rmSync(output, { recursive: true, force: true }); }
});
