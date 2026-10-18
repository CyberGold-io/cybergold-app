import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, type Page } from "@playwright/test";
import { createSwapDiagnostics } from "./clientDiagnostics.ts";
import { installUiSwapObservation, uiSwapObservation } from "../../tests/trading/uiSwapObservation.ts";
import { hasUiReceiptOutcome, observeUiReceiptUntilDeadline, recoverUiTransaction, uiWalletRequestSettled } from "../../tests/trading/uiTransactionRecovery.ts";
import { cleanupOwnedWalletRequest, closeOwnedWalletContext, isWalletRequestCleanupError, walletRequestContextClosedError } from "../../tests/trading/walletRequestLifecycle.ts";
import { isUiCompletionDeadlineError, uiObservationFailure, uiSwapTerminalFailure } from "../../tests/trading/uiDiagnostics.ts";
import { requireInvariant, type ScenarioResult } from "../../tests/trading/regression.ts";
import { transactionDisposition } from "../../tests/trading/providerEvidence.ts";
import { executeAlternate, type AlternateExecution, type SelectionCapture } from "../../tests/trading/providerEvidence.ts";
import { protocolConfigurationFixture as config } from "../../tests/fixtures/protocol-configuration.ts";
import { coreTrade, marketTrade } from "../../tests/fixtures/trade-quote.mts";
import { matrixTemplates } from "../../tests/trading/matrix.ts";
import { tokenRequest } from "../../tests/trading/regression.ts";
import { scenarioIsolation, type SandboxIsolation } from "../../tests/trading/privateSandbox.ts";
import { ScenarioUnavailableError } from "../../tests/trading/scenarios.ts";

const hash = `0x${"a".repeat(64)}` as const;
const blockHash = `0x${"b".repeat(64)}` as const;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const source = readFileSync(new URL("../../tests/metamask/fixed-api-roundtrips.spec.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("suite.ts", source, ts.ScriptTarget.Latest, true);
const declarations = new Map<string, string>();
let caseCatch: string;
let fixtureCatch: string;
let independentAlternateCheckpoint: string;
let sequentialAlternateCheckpoint: string;
const visit = (node: ts.Node) => {
  if (ts.isFunctionDeclaration(node) && node.name && ["releaseUiRequest", "finishUiRequest", "submit"].includes(node.name.text))
    declarations.set(node.name.text, node.getText(parsed));
  if (ts.isCatchClause(node) && node.block.getText(parsed).includes("uiObservationFailure(results[index]"))
    caseCatch = node.block.getText(parsed);
  if (ts.isCatchClause(node) && node.block.getText(parsed).includes("uiObservationFailure(fixtures[0]"))
    fixtureCatch = node.block.getText(parsed);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "retainAlternate" && node.initializer)
    independentAlternateCheckpoint = node.initializer.getText(parsed);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "executeAlternate"
    && node.arguments.at(-1) && ts.isArrowFunction(node.arguments.at(-1)!)) sequentialAlternateCheckpoint = node.arguments.at(-1)!.getText(parsed);
  ts.forEachChild(node, visit);
};
visit(parsed);
assert.equal(declarations.size, 3); assert.ok(caseCatch!); assert.ok(fixtureCatch!);
assert.ok(independentAlternateCheckpoint!); assert.ok(sequentialAlternateCheckpoint!);

/** Execute the real submit/release/case-catch call sites with a native request
 * whose lifetime is independent of the UI observer's deadline. */
function fixture(mode: "reject" | "late-hash" | "revert" | "confirmed-display-failure" | "stuck" | "close-error",
  clickFailure?: "bound" | "unbound") {
  const localWindow = new EventTarget() as unknown as Window;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: localWindow });
  installUiSwapObservation(localWindow);
  const original = Promise.withResolvers<void>(), allowCleanup = Promise.withResolvers<void>();
  let swap: ReturnType<typeof createSwapDiagnostics>;
  let broadcasts = 0, swaps = 0, rejects = 0, closes = 0, persisted = 0, receipts = 0, approvalObservers = 0;
  const closeError = new Error("ordinary browser cleanup failure");
  const clickError = new Error("native request opened before click observation failed");
  const reject = { or() { return this; }, isVisible: async () => true, click: async () => {
    rejects++;
    await allowCleanup.promise;
    if (mode === "reject") { swap.failed({ code: 4001 }); original.resolve(); }
    if (mode === "late-hash") { broadcasts++; swap.submitted(hash); original.resolve(); }
    await tick();
  } };
  const popup = { url: () => "chrome-extension://owned/notification.html", getByTestId: () => reject, locator: () => reject };
  const context = { serviceWorkers: () => [{ url: () => "chrome-extension://owned/background.js" }], pages: () => [popup],
    close: async () => { closes++; if (mode === "close-error") throw closeError; original.resolve(); } };
  const page = { context: () => context,
    evaluate: async (read: (argument?: string) => unknown, argument?: string) => read(argument) } as unknown as Page;
  const result: ScenarioResult = { id: "ui-core-issue-usdc-exact-in-small", family: "issue-token", asset: "USDC", inputMode: "exact-in",
    requestedStrategy: "auto", actualStrategy: "core", layer: "execution", status: "unavailable", code: "not-exercised",
    transactionDisposition: "not-submitted" };
  const click = async () => {
    swaps++; swap = createSwapDiagnostics({}, undefined, () => {}); swap.walletStep("transaction");
    if (mode === "revert") { broadcasts++; swap.submitted(hash); swap.failed({ name: "TransactionRevertedError" }); original.resolve(); }
    if (mode === "confirmed-display-failure") { broadcasts++; swap.submitted(hash); swap.confirmed(hash); original.resolve(); }
    if (clickFailure) {
      if (clickFailure === "bound") scope.activeSwapAttempt = swap.id;
      throw clickError;
    }
  };
  const scope = {
    page, performance, AbortSignal, Hex: undefined, helpersHash: undefined as string | undefined, activeSwapAttempt: undefined as string | undefined,
    activeConfirmationDeadline: undefined as number | undefined,
    activeScenarioIndex: 0 as number | undefined, results: [result], fixtures: [] as ScenarioResult[], index: 0, scenarios: [{}], config: {}, observationPhase: "ui-prepare",
    clickedSelection: undefined, uiSwapObservation, uiWalletRequestSettled, uiSwapTerminalFailure,
    cleanupOwnedWalletRequest, closeOwnedWalletContext, isWalletRequestCleanupError, walletRequestContextClosedError,
    hasUiReceiptOutcome, observeUiReceiptUntilDeadline, recoverUiTransaction, isUiCompletionDeadlineError,
    uiObservationFailure, requireInvariant, transactionDisposition,
    activeResult: (): ScenarioResult => scope.activeScenarioIndex === undefined ? scope.fixtures[0] : scope.results[0],
    checkpoint: async (stage: string) => { scope.activeResult().executionStage = stage as ScenarioResult["executionStage"]; },
    bootstrapStarted: performance.now(), started: performance.now(),
    persist: async () => { persisted++; }, getSwapButton: async () => ({ click }), armUiQuoteCapture: async () => {},
    gasObservation: { begin() {} }, selectionCaptures: async () => [{ attemptId: swap.id, quote: {} }],
    assertMatrixIntent() {}, captureSelection: () => ({ primary: {} }), captureBasketSelection: () => ({}),
    capturedUiQuote: async () => ({ input: [], output: [] }), safeWalletClickError: () => ({}), readWalletUiState: async () => undefined,
    approveUntilMined: async (_page: Page, _submitted: () => boolean, observe: () => Promise<void>) => {
      approvalObservers++;
      await observe(); throw new Error("original UI completion deadline");
    },
    fetcher: (async (url: string | URL | Request) => {
      receipts++; assert.equal(String(url), `/api/transaction/receipt?hash=${hash}`);
      return Response.json({ receipt: { transactionHash: hash, blockHash, blockNumber: "26190100",
        status: mode === "revert" ? "reverted" : "success", logs: [] } });
    }) as typeof fetch,
  };
  const compiled = vm.runInNewContext(ts.transpile([...declarations.values(), `async function capture(error) ${caseCatch!}`,
    `async function captureFixture(error) ${fixtureCatch!}`, "({ submit, capture, captureFixture });"].join("\n"), { target: ts.ScriptTarget.ES2022 }), scope) as {
      submit: (assets: unknown, mode: string) => Promise<unknown>; capture: (error: unknown) => Promise<void>;
      captureFixture: (error: unknown) => Promise<void> };
  return { ...compiled, scope, allowCleanup, original, closeError, clickError,
    counts: () => ({ broadcasts, swaps, rejects, closes, persisted, receipts, approvalObservers }), restore() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    } };
}

async function cleanupDeadline<T>(run: () => Promise<T>) {
  const poll = expect.poll;
  expect.poll = ((read: () => Promise<boolean>, options: { timeout: number; intervals: number[] }) => ({ toBe: async () => {
    assert.deepEqual(options, { timeout: 5000, intervals: [100, 250, 500] });
    for (let attempt = 0; attempt < 3; attempt++) { if (await read()) return; await tick(); }
    throw new Error("native cleanup deadline");
  } })) as unknown as typeof expect.poll;
  try { return await run(); } finally { expect.poll = poll; }
}

test("actual UI submit cannot reach the next case while the original native request is pending", async () => cleanupDeadline(async () => {
  const f = fixture("reject");
  try {
    let nextCase = false;
    const pipeline = f.submit([], "exact-in").catch(error => f.capture(error)).then(() => { nextCase = true; });
    while (!f.counts().rejects) await tick();
    assert.equal(nextCase, false); assert.equal(f.counts().swaps, 1);
    f.allowCleanup.resolve(); await pipeline; await f.original.promise;
    assert.equal(nextCase, true); assert.equal(f.scope.results[0].status, "fail");
    assert.equal(f.scope.results[0].transactionDisposition, "not-submitted");
    assert.equal(f.scope.results[0].walletRequestErrorCode, 4001); assert.equal(f.counts().broadcasts, 0);
    assert.equal(f.scope.results[0].uiConfirmation?.cleanup, "settled");
  } finally { f.restore(); }
}));

test("actual UI caller retains its original late hash and receipt but preserves the failed UI assertion", async () => cleanupDeadline(async () => {
  const f = fixture("late-hash");
  try {
    f.allowCleanup.resolve();
    await f.submit([], "exact-in").catch(error => f.capture(error));
    const result = f.scope.results[0];
    assert.equal(result.status, "fail"); assert.equal(result.transactionHash, hash);
    assert.equal(result.transactionDisposition, "confirmed"); assert.equal(result.receipt?.status, "success");
    assert.equal(f.scope.helpersHash, hash); assert.equal(f.counts().swaps, 1); assert.equal(f.counts().broadcasts, 1);
  } finally { f.restore(); }
}));

test("actual App-revert branch independently recovers its reverted receipt before failure capture", async () => cleanupDeadline(async () => {
  const f = fixture("revert");
  try {
    await f.submit([], "exact-in").catch(error => f.capture(error));
    const result = f.scope.results[0];
    assert.equal(result.code, "product-reported-revert"); assert.equal(result.status, "fail");
    assert.equal(result.transactionDisposition, "confirmed"); assert.equal(result.receipt?.status, "reverted");
    assert.equal(result.receipt?.transactionHash, hash); assert.equal(f.counts().rejects, 0); assert.equal(f.counts().swaps, 1);
  } finally { f.restore(); }
}));

test("an already confirmed original trade retains its failed display assertion and is never cancelled or replayed", async () => cleanupDeadline(async () => {
  const f = fixture("confirmed-display-failure");
  try {
    await f.submit([], "exact-in").catch(error => f.capture(error));
    const result = f.scope.results[0];
    assert.equal(result.status, "fail"); assert.equal(result.transactionDisposition, "confirmed");
    assert.equal(result.receipt?.status, "success"); assert.equal(result.receipt?.transactionHash, hash);
    assert.equal(f.counts().rejects, 0); assert.equal(f.counts().closes, 0);
    assert.equal(f.counts().swaps, 1); assert.equal(f.counts().broadcasts, 1);
  } finally { f.restore(); }
}));

test("failed optional attempt capture still cleans the already-clicked UI request before another case", async () => cleanupDeadline(async () => {
  const f = fixture("close-error");
  try {
    f.allowCleanup.resolve();
    f.scope.selectionCaptures = async () => [];
    f.scope.uiSwapObservation = async () => undefined;
    let nextCase = false;
    await assert.rejects(f.submit([], "exact-in").catch(error => f.capture(error)).then(() => { nextCase = true; }),
      error => error === f.closeError && isWalletRequestCleanupError(error));
    assert.equal(f.scope.activeSwapAttempt, undefined); assert.equal(nextCase, false);
    assert.equal(f.counts().closes, 1); assert.equal(f.counts().swaps, 1);
  } finally { f.restore(); }
}));

test("actual per-case capture persists and rethrows a native context-close failure", async () => cleanupDeadline(async () => {
  const f = fixture("close-error");
  try {
    f.allowCleanup.resolve();
    let nextCase = false;
    await assert.rejects(f.submit([], "exact-in").catch(error => f.capture(error)).then(() => { nextCase = true; }),
      error => error === f.closeError && isWalletRequestCleanupError(error));
    assert.equal(nextCase, false); assert.equal(f.counts().persisted, 1); assert.equal(f.counts().closes, 1);
    assert.equal(f.scope.results[0].status, "fail"); assert.equal(f.scope.results[0].uiConfirmation?.cleanup, "unresolved");
  } finally { f.restore(); }
}));

test("successful disposal ends the actual owning fixture instead of running more cases on a closed context", async () => cleanupDeadline(async () => {
  const f = fixture("stuck");
  try {
    f.allowCleanup.resolve();
    let nextCase = false;
    await assert.rejects(f.submit([], "exact-in").catch(error => f.capture(error)).then(() => { nextCase = true; }), isWalletRequestCleanupError);
    assert.equal(nextCase, false); assert.equal(f.counts().closes, 1); assert.equal(f.counts().persisted, 1);
    assert.equal(f.scope.results[0].status, "fail"); assert.equal(f.scope.results[0].transactionDisposition, "unknown");
    assert.equal(f.scope.results[0].uiConfirmation?.cleanup, "context-closed");
    assert.equal(f.scope.results[0].walletRequestErrorCode, undefined); assert.equal(f.scope.results[0].transactionHash, undefined);
  } finally { f.restore(); }
}));

test("actual bootstrap caller marks its attempt and persists the unresolved fixture before resource unwind", async () => cleanupDeadline(async () => {
  const f = fixture("close-error");
  try {
    f.scope.activeScenarioIndex = undefined;
    f.scope.fixtures = [{ ...f.scope.results[0], id: "fixture-cygld-bootstrap" }];
    f.allowCleanup.resolve();
    let nextCase = false;
    await assert.rejects(f.submit([], "exact-in").catch(error => f.captureFixture(error)).then(() => { nextCase = true; }),
      error => error === f.closeError && isWalletRequestCleanupError(error));
    const bootstrap = f.scope.fixtures[0];
    assert.equal(nextCase, false); assert.equal(bootstrap.executionAttempted, true); assert.equal(bootstrap.status, "fail");
    assert.equal(bootstrap.transactionDisposition, "unknown"); assert.equal(bootstrap.uiConfirmation?.cleanup, "unresolved");
    assert.ok(typeof bootstrap.durationMs === "number"); assert.equal(f.counts().persisted, 1);
    assert.equal(f.scope.results[0].executionAttempted, undefined, "Unexercised matrix inventory is not a fixture attempt.");
  } finally { f.restore(); }
}));

test("a click failure after opening its original native request waits for cleanup and retains the late hash", async () => cleanupDeadline(async () => {
  const f = fixture("late-hash", "bound");
  try {
    let nextCase = false;
    const pipeline = f.submit([], "exact-in").catch(error => {
      assert.equal(error, f.clickError); return f.capture(error);
    }).then(() => { nextCase = true; });
    while (!f.counts().rejects) await tick();
    assert.equal(nextCase, false); f.allowCleanup.resolve(); await pipeline;
    assert.equal(nextCase, true); assert.equal(f.counts().approvalObservers, 0);
    assert.equal(f.counts().swaps, 1); assert.equal(f.counts().broadcasts, 1); assert.equal(f.counts().rejects, 1);
    assert.equal(f.scope.results[0].status, "fail"); assert.equal(f.scope.results[0].transactionHash, hash);
    assert.equal(f.scope.results[0].receipt?.status, "success"); assert.equal(f.scope.results[0].uiConfirmation?.requestStage, "ui-submit");
  } finally { f.restore(); }
}));

test("an unbound click failure still disposes its unresolved owned request and never starts confirmation or another case", async () => cleanupDeadline(async () => {
  const f = fixture("stuck", "unbound");
  try {
    f.allowCleanup.resolve();
    let nextCase = false;
    await assert.rejects(f.submit([], "exact-in").catch(error => f.capture(error)).then(() => { nextCase = true; }), isWalletRequestCleanupError);
    assert.equal(nextCase, false); assert.equal(f.counts().approvalObservers, 0); assert.equal(f.counts().closes, 1);
    assert.equal(f.counts().swaps, 1); assert.equal(f.scope.results[0].transactionDisposition, "unknown");
    assert.equal(f.scope.results[0].uiConfirmation?.cleanup, "context-closed");
  } finally { f.restore(); }
}));

test("normal UI confirmation owns the existing 90s window starting after click and quote capture", async () => cleanupDeadline(async () => {
  const f = fixture("reject");
  try {
    let now = 1000;
    f.scope.performance = { now: () => now } as Performance;
    const button = await f.scope.getSwapButton();
    f.scope.getSwapButton = async () => ({ click: async () => { await button.click(); now += 3000; } });
    f.scope.capturedUiQuote = async () => { now += 5000; return { input: [], output: [] }; };
    f.allowCleanup.resolve();
    await f.submit([], "exact-in").catch(error => f.capture(error));
    assert.equal(f.scope.activeConfirmationDeadline, 99_000, "The normal 90s poll begins at 9s, after click/capture.");
    assert.equal(f.counts().approvalObservers, 1); assert.equal(f.counts().swaps, 1);
  } finally { f.restore(); }
}));

test("a click failure that never enters confirmation keeps its original flow's configured budget anchor", async () => cleanupDeadline(async () => {
  const f = fixture("late-hash", "bound");
  try {
    let now = 1000;
    f.scope.performance = { now: () => now } as Performance;
    const button = await f.scope.getSwapButton();
    f.scope.getSwapButton = async () => ({ click: async () => { now += 3000; await button.click(); } });
    f.allowCleanup.resolve();
    await f.submit([], "exact-in").catch(error => f.capture(error));
    assert.equal(f.scope.activeConfirmationDeadline, 91_000, "Click failure must not restart another 90s confirmation window.");
    assert.equal(f.counts().approvalObservers, 0); assert.equal(f.counts().broadcasts, 1);
  } finally { f.restore(); }
}));

for (const phase of ["sequential", "independent"] as const) test(`fatal ${phase} alternate retains partial role evidence through its actual caller checkpoint`, async () => {
  const scenario = { ...matrixTemplates()[0], amountRaw: "100", sizingError: undefined };
  const primary = coreTrade("buy", "exact-in"), losing = { ...marketTrade("buy", "exact-in"), quotedInput: "100", quotedOutput: "200", inputMaximum: "100", outputMinimum: "1" };
  const capture = { quote: { ...primary, providerAssessments: { core: { availability: "qualified", searchOutcome: "complete" },
    market: { availability: "qualified", searchOutcome: "complete" } }, providerCandidates: { core: primary, market: losing } } } as SelectionCapture;
  const isolation = { source: "sandbox", sourceBlockNumber: "100", sourceBlockHash: blockHash,
    baselineBlockNumber: "101", baselineBlockHash: hash, cacheGeneration: 2, reset: "snapshot-reverted",
    chain: "owned-fork", cache: "recreated-per-attempt", wallet: "fresh-profile-per-attempt" } as SandboxIsolation;
  const rows = [{ id: "ui-primary", status: "pass" }] as ScenarioResult[];
  let persisted: ScenarioResult[] | undefined, executions = 0, continued = false, closes = 0;
  const scope = { results: rows, index: 0, isolation, scenarioIsolation,
    persist: async () => { persisted = structuredClone(rows); } };
  const callback = vm.runInNewContext(ts.transpile(`const checkpoint = ${phase === "sequential" ? sequentialAlternateCheckpoint! : independentAlternateCheckpoint!}; checkpoint;`,
    { target: ts.ScriptTarget.ES2022 }), scope) as (result: AlternateExecution) => Promise<void>;
  const resourceError = new ScenarioUnavailableError("submitted-unconfirmed");
  const resourcePage = { context: () => ({ close: async () => { closes++; } }) } as unknown as Page;
  await assert.rejects(executeAlternate(capture, scenario, tokenRequest(scenario, config, config.contracts.helpers!), resourcePage,
    config.contracts.helpers as `0x${string}`, config, (async () => new Response(JSON.stringify({ type: "complete", value: losing }) + "\n")) as typeof fetch,
    async observation => {
      executions++;
      Object.assign(observation.result, { transactionHash: hash, executionStage: "execution-submission", walletRequest: {
        method: "eth_sendTransaction", settlement: "fulfilled", elapsedMs: 1, pendingBefore: 0, pendingAfter: 0,
        clickAttempts: 1, clickCompleted: 1, cleanup: "context-closed", cleanupElapsedMs: 2,
        cleanupClickAttempts: 1, cleanupClickCompleted: 1, requestStage: "execution-submission" } });
      return await closeOwnedWalletContext(resourcePage, resourceError);
    }, "confirmed", phase === "sequential" ? "sequential-state" : "restored-baseline", callback).then(() => { continued = true; }),
  error => error === resourceError && isWalletRequestCleanupError(error));
  assert.equal(continued, false); assert.equal(executions, 1); assert.equal(closes, 1);
  const retained = persisted?.[0].alternateExecution;
  assert.equal(retained?.attempted, true); assert.equal(retained?.provider, "market"); assert.equal(retained?.status, "fail");
  assert.equal(retained?.transactionHash, hash); assert.equal(retained?.transactionDisposition, "unknown");
  assert.equal(retained?.code, "submitted-unconfirmed");
  assert.equal(retained?.walletRequest?.cleanup, "context-closed"); assert.ok(typeof retained?.durationMs === "number");
  if (phase === "independent") {
    assert.equal(persisted?.[0].status, "skipped"); assert.equal(persisted?.[0].code, "independent-alternate-only");
    assert.equal(retained?.isolation?.baselineBlockHash, hash); assert.equal(retained?.isolation?.attemptRole, "alternate");
  } else assert.equal(persisted?.[0].status, "pass", "An alternate failure cannot rewrite the primary result.");
});
