import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { regressionPolicy, unexpectedFailure } from "../../tests/trading/runPolicy.ts";
import { resultFor, requireInvariant, RegressionAssertionError, type ScenarioResult } from "../../tests/trading/regression.ts";
import { matrixTemplates, type MatrixScenario } from "../../tests/trading/matrix.ts";
import { notAttemptedAlternate, transactionDisposition, type AlternateExecution } from "../../tests/trading/providerEvidence.ts";
import { isWalletRequestCleanupError, walletRequestContextClosedError } from "../../tests/trading/walletRequestLifecycle.ts";
import { uiObservationFailure } from "../../tests/trading/uiDiagnostics.ts";
import { protocolConfigurationFixture as config } from "../../tests/fixtures/protocol-configuration.ts";

const source = readFileSync(new URL("../../tests/metamask/fixed-api-roundtrips.spec.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("wallet-suite.ts", source, ts.ScriptTarget.Latest, true);
let loop: string, alternateBranch: string, bootstrap: string, persist: string;
const visit = (node: ts.Node) => {
  if (ts.isForOfStatement(node) && node.expression.getText(parsed) === "scenarios.entries()") loop = node.getText(parsed);
  if (ts.isIfStatement(node) && node.expression.getText(parsed) === "privatePhase === 'alternate'") alternateBranch = node.getText(parsed);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "persist") persist = node.getText(parsed);
  // Exercise the actual fixture catch/cleanup, then the actual diagnostic guard.
  if (ts.isTryStatement(node) && node.catchClause?.block.getText(parsed).includes("uiObservationFailure(fixtures[0]")) {
    const after = source.indexOf("  if (privatePhase === 'prepare')", node.end);
    assert.ok(after > node.end);
    bootstrap = source.slice(node.pos, after);
  }
  ts.forEachChild(node, visit);
};
visit(parsed); assert.ok(loop!); assert.ok(alternateBranch!); assert.ok(bootstrap!); assert.ok(persist!);

const hash = `0x${"a".repeat(64)}`;
const owner = `0x${"1".repeat(40)}`;
const assertion = (value: unknown) => ({
  toBe: (expected: unknown) => assert.equal(value, expected),
  not: { toBe: (expected: unknown) => assert.notEqual(value, expected) },
});
const expect = Object.assign(assertion, { poll: (read: () => unknown) => ({
  toBeTruthy: async () => assert.ok(await read()),
}) });

/** Run the actual suite loop with controlled native-action callbacks. No
 * wallet, network, or clock deadline is replaced in production source. */
function fixture(policy: "diagnostic" | "full", failure: "winner" | "alternate" | "resource" | "none", privatePhase?: "winner" | "alternate") {
  const scenarios = matrixTemplates().slice(0, privatePhase ? 1 : 3) as MatrixScenario[];
  const results: ScenarioResult[] = scenarios.map(scenario => ({ ...resultFor(scenario, "execution"), id: `ui-${scenario.id}`,
    requestedStrategy: "auto", executionAttempted: false, transactionDisposition: "not-submitted" }));
  const completed = { completedScenarioIds: [] as string[] };
  const cleanupStarted = Promise.withResolvers<void>(), releaseCleanup = Promise.withResolvers<void>();
  const resourceError = walletRequestContextClosedError();
  const actions = { winner: [] as string[], alternate: [] as string[], cleanup: 0 };
  const snapshots: { completed: string[]; status: string[]; stop?: unknown }[] = [];
  const scope = {
    scenarios, results, config, owner, page: {}, performance, AbortSignal, process: { env: {} as Record<string, string> },
    runPolicy: regressionPolicy(policy), progress: completed, diagnosticStop: undefined as unknown,
    privatePhase, isolation: undefined, fetcher: undefined, observationPhase: "ui-prepare",
    helpersHash: undefined as string | undefined, activeSwapAttempt: undefined,
    activeScenarioIndex: undefined as number | undefined, activeFixtureIndex: 0 as number | undefined,
    activeQuoteDiagnostics: undefined, clickedSelection: undefined as unknown,
    activeConfirmationDeadline: performance.now() + 90_000,
    fixtures: [] as ScenarioResult[], bootstrap: scenarios[0], bootstrapStarted: performance.now(),
    setupComplete: true, setupRefs: {},
    expect, requireInvariant, notAttemptedAlternate, transactionDisposition, uiObservationFailure,
    unexpectedFailure, isWalletRequestCleanupError,
    test: { step: async (_name: string, action: () => Promise<void>) => action() },
    createUiQuoteDiagnostics: () => ({}),
    checkpoint: async (stage: ScenarioResult["executionStage"]) => {
      const row = scope.activeScenarioIndex === undefined ? scope.fixtures[0] : scope.results[scope.activeScenarioIndex];
      if (row) row.executionStage = stage;
    },
    prepare: async () => {},
    configuredToken: () => ({ id: "paxg" }),
    readWalletBalances: async () => ({}), fetchWalletBalances: async () => ({}),
    quoteAssets: () => [],
    submit: async () => {
      const index = scope.activeScenarioIndex ?? 0, row = scope.activeScenarioIndex === undefined ? scope.fixtures[0] : results[index];
      actions.winner.push(row.id); row.executionAttempted = true;
      row.executionStage = "ui-confirmation"; scope.observationPhase = "ui-confirmation";
      scope.clickedSelection = { quote: { strategy: "core" }, intent: {} };
      if (index === 0 && ["winner", "resource"].includes(failure)) throw new RegressionAssertionError("ui-completion-not-observed");
      scope.helpersHash = hash;
      return { input: [{ amount: "1" }], output: [{ amount: "1" }] };
    },
    hasUiReceiptOutcome: () => true, fetchTransactionReceipt: async () => ({ transactionHash: hash, status: "success" }),
    readJson: async () => ({ transaction: { input: "0x", to: config.contracts.helpers!, from: owner } }),
    observeUiReceipt: (_scenario: unknown, _config: unknown, _owner: unknown, _input: unknown, _receipt: unknown,
      _amount: unknown, _basket: unknown, _quote: unknown, row: ScenarioResult) => {
      row.status = "pass"; delete row.code; row.actualStrategy = "core";
      return { validate() {} };
    },
    assertCapturedTradeInput: async () => {}, walletPostcheck: async () => async () => {},
    finishUiRequest: async (row: ScenarioResult) => {
      actions.cleanup++; cleanupStarted.resolve(); await releaseCleanup.promise;
      if (failure === "resource") {
        row.uiConfirmation = { cleanup: "context-closed", elapsedMs: 90_000, clickAttempts: 1, clickCompleted: 1 };
        throw resourceError;
      }
      // This original owned request was explicitly rejected; no replacement send.
      row.walletRequestErrorCode = 4001; row.transactionDisposition = "not-submitted";
    },
    quoteObservations: async () => [],
    captureSelection: () => ({ primary: { refs: {} } }),
    privateSandboxSelection: () => undefined,
    scenarioIsolation: () => ({}),
    executeAlternate: async (...args: unknown[]) => {
      const scenario = args[1] as MatrixScenario;
      actions.alternate.push(scenario.id);
      const alternate = { ...notAttemptedAlternate(scenario), attempted: true, executionAttempted: true,
        status: "pass", code: undefined, transactionDisposition: "confirmed" } as AlternateExecution;
      if (actions.alternate.length === 1 && failure === "alternate") {
        cleanupStarted.resolve(); await releaseCleanup.promise;
        Object.assign(alternate, { status: "fail", code: "execution-receipt-assertions", transactionDisposition: "confirmed" });
      }
      return alternate;
    },
    readFile: async () => JSON.stringify({ quote: {}, intent: {} }), writeFile: async () => {},
    persist: async () => { snapshots.push({ completed: [...completed.completedScenarioIds], status: results.map(row => row.status), stop: scope.diagnosticStop }); },
  };
  const compiled = vm.runInNewContext(ts.transpile(`async function run() { ${loop!} }
    async function runAlternate() { ${alternateBranch!} }
    async function runBootstrap() { ${bootstrap!} }
    ({ run, runAlternate, runBootstrap });`, { target: ts.ScriptTarget.ES2022 }), scope) as {
    run: () => Promise<void>; runAlternate: () => Promise<void>; runBootstrap: () => Promise<void> };
  return { ...compiled, scope, actions, snapshots, cleanupStarted, releaseCleanup, resourceError };
}

test("diagnostic winner failure waits for native cleanup, publishes that case, and starts neither alternate nor next case", async () => {
  const f = fixture("diagnostic", "winner");
  const run = f.run(); await f.cleanupStarted.promise;
  assert.deepEqual(f.actions.winner, [f.scope.results[0].id]); assert.deepEqual(f.actions.alternate, []);
  assert.deepEqual(f.scope.progress.completedScenarioIds, []); assert.equal(f.scope.diagnosticStop, undefined);
  assert.ok(f.snapshots.every(row => row.completed.length === 0));
  f.releaseCleanup.resolve(); await run;
  assert.deepEqual(f.scope.progress.completedScenarioIds, [f.scope.results[0].id]);
  assert.deepEqual({ ...f.scope.diagnosticStop as unknown as object }, { scenarioId: f.scope.results[0].id, role: "winner" });
  assert.equal(f.scope.results[0].status, "fail"); assert.equal(f.scope.results[0].alternateExecution?.code, "not-attempted");
  assert.equal(f.scope.results[0].transactionDisposition, "not-submitted");
  assert.ok(f.scope.results.slice(1).every(row => row.code === "not-exercised" && !row.executionAttempted));
});

test("full mode retains an ordinary failed winner and continues alternates and later scenarios", async () => {
  const f = fixture("full", "winner"); f.releaseCleanup.resolve(); await f.run();
  assert.equal(f.scope.results[0].status, "fail"); assert.equal(f.scope.diagnosticStop, undefined);
  assert.equal(f.actions.winner.length, 3); assert.equal(f.actions.alternate.length, 3);
  assert.deepEqual(f.scope.progress.completedScenarioIds, f.scope.results.map(row => row.id));
  assert.ok(f.scope.results.slice(1).every(row => row.status === "pass"));
});

test("diagnostic alternate failure is retained after its cleanup and stops the next case", async () => {
  const f = fixture("diagnostic", "alternate");
  const run = f.run(); await f.cleanupStarted.promise;
  assert.equal(f.actions.winner.length, 1); assert.equal(f.actions.alternate.length, 1);
  assert.deepEqual(f.scope.progress.completedScenarioIds, []);
  f.releaseCleanup.resolve(); await run;
  assert.equal(f.scope.results[0].status, "pass"); assert.equal(f.scope.results[0].alternateExecution?.status, "fail");
  assert.deepEqual({ ...f.scope.diagnosticStop as object }, { scenarioId: f.scope.results[0].id, role: "alternate" });
  assert.deepEqual(f.scope.progress.completedScenarioIds, [f.scope.results[0].id]);
  assert.ok(f.scope.results.slice(1).every(row => row.code === "not-exercised"));
});

test("full mode preserves an ordinary alternate failure and continues the remaining cases", async () => {
  const f = fixture("full", "alternate"); f.releaseCleanup.resolve(); await f.run();
  assert.equal(f.scope.results[0].status, "pass"); assert.equal(f.scope.results[0].alternateExecution?.status, "fail");
  assert.equal(f.scope.diagnosticStop, undefined); assert.equal(f.actions.winner.length, 3); assert.equal(f.actions.alternate.length, 3);
  assert.deepEqual(f.scope.progress.completedScenarioIds, f.scope.results.map(row => row.id));
});

for (const policy of ["diagnostic", "full"] as const) test(`${policy} preserves mandatory owned-context unwind before any alternate or next case`, async () => {
  const f = fixture(policy, "resource"); f.releaseCleanup.resolve();
  await assert.rejects(f.run(), error => error === f.resourceError && isWalletRequestCleanupError(error));
  assert.equal(f.actions.winner.length, 1); assert.equal(f.actions.alternate.length, 0);
  assert.equal(f.scope.results[0].transactionDisposition, "unknown");
  assert.deepEqual(f.scope.progress.completedScenarioIds, [f.scope.results[0].id]);
  assert.ok(f.scope.results.slice(1).every(row => row.code === "not-exercised"));
});

for (const policy of ["diagnostic", "full"] as const) test(`${policy} bootstrap failure completes original cleanup before its policy decision`, async () => {
  const f = fixture(policy, "winner"); f.scope.fixtures.push({ ...f.scope.results[0], id: "fixture-cygld-bootstrap" });
  const run = f.runBootstrap();
  // Attach the rejection handler before releasing the controlled original request.
  const observed = run.then(() => undefined, error => error);
  await f.cleanupStarted.promise;
  assert.deepEqual(f.scope.progress.completedScenarioIds, []);
  assert.equal(f.scope.activeFixtureIndex, 0);
  f.releaseCleanup.resolve(); const error = await observed;
  assert.equal(f.scope.fixtures[0].status, "fail"); assert.equal(f.scope.activeFixtureIndex, undefined);
  if (policy === "diagnostic") assert.ok(error instanceof Error);
  else assert.equal(error, undefined);
  assert.deepEqual(f.scope.progress.completedScenarioIds, [], "A setup fixture is never a completed matrix scenario.");
});

test("the private winner phase publishes only its role and never invokes its alternate inline", async () => {
  const f = fixture("diagnostic", "none", "winner"); await f.run();
  assert.equal(f.actions.winner.length, 1); assert.equal(f.actions.alternate.length, 0);
  assert.deepEqual(f.scope.progress.completedScenarioIds, [f.scope.results[0].id]);
  assert.equal(f.scope.results[0].alternateExecution?.comparisonState, "restored-baseline");
});

test("the private alternate phase publishes its retained role only after cleanup and preserves failed status", async () => {
  const f = fixture("diagnostic", "alternate", "alternate");
  f.scope.process.env.TRADE_REGRESSION_PRIVATE_SELECTION = "owned-selection.json";
  const run = f.runAlternate(), observed = run.then(() => undefined, error => error);
  await f.cleanupStarted.promise; assert.deepEqual(f.scope.progress.completedScenarioIds, []);
  f.releaseCleanup.resolve(); assert.ok(await observed instanceof Error);
  assert.equal(f.scope.results[0].status, "skipped"); assert.equal(f.scope.results[0].alternateExecution?.status, "fail");
  assert.deepEqual({ ...f.scope.diagnosticStop as object }, { scenarioId: f.scope.results[0].id, role: "alternate" });
  assert.deepEqual(f.scope.progress.completedScenarioIds, [f.scope.results[0].id]);
});

test("a private alternate with no retained plan is explicitly completed as not-attempted without a diagnostic failure", async () => {
  const f = fixture("diagnostic", "none", "alternate"); await f.runAlternate();
  assert.equal(f.actions.alternate.length, 0); assert.equal(f.scope.results[0].status, "skipped");
  assert.equal(f.scope.results[0].alternateExecution?.code, "not-attempted");
  assert.equal(f.scope.diagnosticStop, undefined);
  assert.deepEqual(f.scope.progress.completedScenarioIds, [f.scope.results[0].id]);
});

test("a private selection-read failure is not published as a completed alternate or scenario", async () => {
  const f = fixture("diagnostic", "none", "alternate"), error = new Error("selection read failed before native execution");
  f.scope.process.env.TRADE_REGRESSION_PRIVATE_SELECTION = "owned-selection.json";
  f.scope.readFile = async () => { throw error; };
  await assert.rejects(f.runAlternate(), caught => caught === error);
  assert.equal(f.actions.alternate.length, 0); assert.deepEqual(f.scope.progress.completedScenarioIds, []);
  assert.equal(f.scope.results[0].code, "not-exercised"); assert.equal(f.scope.diagnosticStop, undefined);
});

test("actual native persistence writes the completed-ID snapshot and selected policy without inferring completion from initialized rows", async () => {
  const f = fixture("diagnostic", "winner"); f.releaseCleanup.resolve(); await f.run();
  const writes: string[] = [];
  const scope = { ...f.scope, config: undefined, process: { env: { TRADE_REGRESSION_UI_OUTPUT: "native.json" } },
    matrixCounts: { scenarioCount: 48 }, executionCoverage: () => ({}), valuation: undefined,
    writeFile: async (_path: string, data: string) => { writes.push(data); }, rename: async () => {} };
  const save = vm.runInNewContext(ts.transpile(`${persist!}; persist;`, { target: ts.ScriptTarget.ES2022 }), scope) as () => Promise<void>;
  await save(); const saved = JSON.parse(writes[0]);
  assert.equal(saved.runPolicy, "diagnostic"); assert.equal(saved.suite, "sequential");
  assert.deepEqual(saved.progress.completedScenarioIds, [f.scope.results[0].id]);
  assert.deepEqual(saved.diagnosticStop, { scenarioId: f.scope.results[0].id, role: "winner" });
  assert.equal(saved.scenarios.length, 3); assert.equal(saved.scenarios[1].code, "not-exercised");
});
