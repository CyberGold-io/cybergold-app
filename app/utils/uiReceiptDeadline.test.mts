import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { Page } from "@playwright/test";
import { hasUiReceiptOutcome, recoverUiTransaction, uiWalletRequestSettled } from "../../tests/trading/uiTransactionRecovery.ts";
import { closeOwnedWalletContext, isWalletRequestCleanupError, walletRequestContextClosedError } from "../../tests/trading/walletRequestLifecycle.ts";
import { isUiCompletionDeadlineError, uiCompletionAssertion, uiObservationFailure } from "../../tests/trading/uiDiagnostics.ts";
import { RegressionAssertionError, type ScenarioResult } from "../../tests/trading/regression.ts";
import { transactionDisposition } from "../../tests/trading/providerEvidence.ts";

const hash = `0x${"a".repeat(64)}` as const, blockHash = `0x${"b".repeat(64)}` as const;
const attemptId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
const matrixSource = readFileSync(new URL("../../tests/metamask/fixed-api-roundtrips.spec.ts", import.meta.url), "utf8");
const matrixParsed = ts.createSourceFile("matrix.ts", matrixSource, ts.ScriptTarget.Latest, true);
const declarations = new Map<string, string>();
const normalReceiptReads: string[] = [];
let caseCatch: string;
let fixtureCatch: string;
const visit = (node: ts.Node) => {
  if (ts.isFunctionDeclaration(node) && node.name && ["releaseUiRequest", "finishUiRequest"].includes(node.name.text)) declarations.set(node.name.text, node.getText(matrixParsed));
  if (ts.isCatchClause(node) && node.block.getText(matrixParsed).includes("uiObservationFailure(results[index]")) caseCatch = node.block.getText(matrixParsed);
  if (ts.isCatchClause(node) && node.block.getText(matrixParsed).includes("uiObservationFailure(fixtures[0]")) fixtureCatch = node.block.getText(matrixParsed);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "receipt" && node.initializer
    && node.initializer.getText(matrixParsed).includes("receiptRemaining")) normalReceiptReads.push(node.initializer.getText(matrixParsed));
  ts.forEachChild(node, visit);
};
visit(matrixParsed); assert.equal(declarations.size, 2); assert.ok(caseCatch!); assert.ok(fixtureCatch!); assert.equal(normalReceiptReads.length, 2);
const recoverySource = readFileSync(new URL("../../tests/trading/uiTransactionRecovery.ts", import.meta.url), "utf8");
const recoveryParsed = ts.createSourceFile("recovery.ts", recoverySource, ts.ScriptTarget.Latest, true);
const observation = recoveryParsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "observeUiReceiptUntilDeadline");
assert.ok(observation);
const observationSource = observation.getText(recoveryParsed).replace(/^export\s+/, "");

function fixture(options: { now: number; deadline: number; values: ("missing" | "error" | "success" | "reverted")[]; advance?: number; closeFails?: boolean }) {
  let now = options.now, reads = 0, closes = 0, polls = 0, persisted = 0, pageReads = 0;
  const pollBudgets: number[] = [], timerBudgets: number[] = [];
  const closeError = new Error("ordinary wallet resource close failure");
  const result: ScenarioResult = { id: "ui-original", family: "issue-token", inputMode: "exact-in", asset: "USDC", requestedStrategy: "auto",
    actualStrategy: "core", layer: "execution", status: "unavailable", code: "execution-not-completed", executionAttempted: true,
    transactionHash: hash, transactionDisposition: "unknown", executionStage: "ui-hash",
    uiConfirmation: { elapsedMs: 15_000, clickAttempts: 1, clickCompleted: 1 } };
  const untouched: ScenarioResult = { ...result, id: "future-case", executionAttempted: false, status: "unavailable", code: "not-exercised", transactionHash: undefined, receipt: undefined };
  const rows = [result, untouched];
  const page = { context: () => ({ close: async () => { closes++; if (options.closeFails) throw closeError; } }) } as unknown as Page;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), `/api/transaction/receipt?hash=${hash}`); assert.equal(init?.method, undefined);
    const value = options.values[Math.min(reads, options.values.length - 1)]; reads++;
    if (reads > 1) now += options.advance ?? 0;
    if (value === "error") return Response.json({ error: "unavailable" }, { status: 503 });
    return Response.json({ receipt: value === "missing" ? null : { transactionHash: hash, blockHash, blockNumber: "123",
      status: value, logs: [] } });
  }) as typeof fetch;
  const performance = { now: () => now };
  const observeReceipt = vm.runInNewContext(ts.transpile(`${observationSource}; observeUiReceiptUntilDeadline;`,
    { target: ts.ScriptTarget.ES2022 }), {
    performance, hasUiReceiptOutcome, recoverUiTransaction, transactionHash: (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value),
    AbortController, setTimeout: (_action: () => void, delay: number) => { timerBudgets.push(delay); return 1; }, clearTimeout: () => {},
    expect: { poll: (read: () => Promise<boolean>, args: { timeout: number; intervals: number[] }) => ({ toBe: async () => {
      polls++; pollBudgets.push(args.timeout); assert.deepEqual(Array.from(args.intervals), [250, 500, 1000]);
      assert.equal(args.timeout, options.deadline - now, "Receipt recovery must use only the original remaining window.");
      for (let count = 0; count < 10 && now < options.deadline; count++) if (await read()) return;
      throw new Error("original confirmation deadline exhausted");
    } }) },
  }) as (result: ScenarioResult, deadline: number, fetcher: typeof fetch) => Promise<boolean>;
  const scope = { page, performance, AbortSignal, helpersHash: hash, activeSwapAttempt: attemptId, activeConfirmationDeadline: options.deadline,
    uiSwapObservation: async () => { pageReads++; return { attemptId, transactionHash: hash, outcome: "submitted" }; }, uiWalletRequestSettled,
    cleanupOwnedWalletRequest: async (_page: Page, settled: () => Promise<boolean>, record: (value: unknown) => void) => {
      assert.equal(await settled(), true); const value = { cleanup: "settled", cleanupElapsedMs: 0, cleanupClickAttempts: 0, cleanupClickCompleted: 0 };
      record(value); return value;
    }, hasUiReceiptOutcome, recoverUiTransaction, observeUiReceiptUntilDeadline: observeReceipt, closeOwnedWalletContext,
    walletRequestContextClosedError, isWalletRequestCleanupError, fetcher, results: rows, fixtures: [result], index: 0,
    started: options.now - 15_000, bootstrapStarted: options.now - 15_000,
    observationPhase: "ui-hash", uiObservationFailure, transactionDisposition, persist: async () => { persisted++; } };
  const compiled = vm.runInNewContext(ts.transpile([...declarations.values(), `async function capture(error) ${caseCatch!}`,
    `async function captureFixture(error) ${fixtureCatch!}`, "({ finishUiRequest, capture, captureFixture });"].join("\n"),
    { target: ts.ScriptTarget.ES2022 }), scope) as { finishUiRequest: (result: ScenarioResult, error: unknown) => Promise<void>;
      capture: (error: unknown) => Promise<void>; captureFixture: (error: unknown) => Promise<void> };
  return { ...compiled, result, rows, untouched, closeError, pollBudgets, timerBudgets, fixtureResult: () => scope.fixtures[0], pageReads: () => pageReads, counts: () => ({ reads, closes, polls, persisted, now }) };
}

test("only the actual completion assertion deadline receives the deadline marker", async () => {
  let deadline: unknown;
  try { await uiCompletionAssertion(async () => { throw { matcherResult: {} }; }, () => true); } catch (error) { deadline = error; }
  assert.equal(isUiCompletionDeadlineError(deadline), true); assert.equal((deadline as { code: string }).code, "submitted-unconfirmed");
  const immediate = new RegressionAssertionError("product-reported-revert");
  await assert.rejects(uiCompletionAssertion(async () => { throw immediate; }, () => true), error => error === immediate);
  assert.equal(isUiCompletionDeadlineError(immediate), false);
});

test("a known original hash with no receipt at the original deadline closes this run and preserves its failure", async () => {
  const f = fixture({ now: 90_000, deadline: 90_000, values: ["missing"] });
  const error = new RegressionAssertionError("ui-completion-not-observed");
  await assert.rejects(f.capture(error), value => value === error && isWalletRequestCleanupError(value));
  assert.deepEqual(f.counts(), { reads: 0, closes: 1, polls: 0, persisted: 1, now: 90_000 });
  assert.equal(f.pageReads(), 0, "A known original hash needs no optional DOM read after the deadline.");
  assert.equal(f.rows[0].transactionHash, hash); assert.equal(f.rows[0].transactionDisposition, "unknown");
  assert.equal(f.rows[0].code, error.code); assert.equal(f.rows[0].status, "fail");
  assert.equal(f.rows[0].uiConfirmation?.deadlineExpired, true); assert.equal(f.rows[0].uiConfirmation?.cleanup, "context-closed");
  assert.ok(typeof f.rows[0].durationMs === "number"); assert.equal(f.rows[1], f.untouched); assert.equal(f.rows[1].code, "not-exercised");
});

for (const status of ["success", "reverted"] as const) test(`a 15s hash/UI failure uses only the remaining window and retains a later ${status} receipt`, async () => {
  const f = fixture({ now: 15_000, deadline: 90_000, values: ["missing", "error", "missing", status], advance: 1000 });
  const error = new RegressionAssertionError("ui-completion-not-observed");
  await f.capture(error);
  assert.equal(f.counts().closes, 0); assert.deepEqual(f.pollBudgets, [75_000]); assert.deepEqual(f.timerBudgets, [75_000]);
  assert.equal(f.rows[0].transactionHash, hash); assert.equal(f.rows[0].receipt?.status, status);
  assert.equal(f.rows[0].transactionDisposition, "confirmed"); assert.equal(f.rows[0].status, "fail"); assert.equal(f.rows[0].code, error.code);
  assert.equal(f.rows[0].uiConfirmation?.deadlineExpired, undefined);
});

test("read errors before the original deadline do not close early or start a fresh 90s window", async () => {
  const f = fixture({ now: 15_000, deadline: 90_000, values: ["error", "missing"], advance: 37_500 });
  const error = new RegressionAssertionError("receipt-unavailable");
  await assert.rejects(f.capture(error), value => value === error && isWalletRequestCleanupError(value));
  assert.equal(f.counts().now, 90_000); assert.equal(f.counts().closes, 1); assert.equal(f.counts().reads, 3);
  assert.deepEqual(f.pollBudgets, [75_000]); assert.deepEqual(f.timerBudgets, [75_000]);
  assert.equal(f.rows[0].code, "receipt-unavailable"); assert.equal(f.rows[0].transactionDisposition, "unknown");
});

test("the ordinary close failure retains its own identity and the original unknown hash", async () => {
  const f = fixture({ now: 90_000, deadline: 90_000, values: ["missing"], closeFails: true });
  await assert.rejects(f.capture(new RegressionAssertionError("ui-completion-not-observed")), value => value === f.closeError && isWalletRequestCleanupError(value));
  assert.equal(f.rows[0].transactionHash, hash); assert.equal(f.rows[0].transactionDisposition, "unknown");
  assert.equal(f.rows[0].uiConfirmation?.cleanup, "unresolved"); assert.equal(f.counts().persisted, 1);
});

test("the actual bootstrap caller also preserves its original failed code/hash when its receipt window ends the run", async () => {
  const f = fixture({ now: 90_000, deadline: 90_000, values: ["missing"] });
  const error = new RegressionAssertionError("receipt-unavailable");
  await assert.rejects(f.captureFixture(error), value => value === error && isWalletRequestCleanupError(value));
  const bootstrap = f.fixtureResult();
  assert.equal(bootstrap.status, "fail"); assert.equal(bootstrap.code, "receipt-unavailable");
  assert.equal(bootstrap.transactionHash, hash); assert.equal(bootstrap.transactionDisposition, "unknown");
  assert.equal(bootstrap.uiConfirmation?.deadlineExpired, true); assert.equal(bootstrap.uiConfirmation?.cleanup, "context-closed");
  assert.ok(typeof bootstrap.durationMs === "number"); assert.equal(f.counts().persisted, 1);
  assert.equal(f.rows[1], f.untouched); assert.equal(f.rows[1].code, "not-exercised");
});

test("normal winner/bootstrap receipt reads after expiry require an already observed independent receipt", async () => {
  for (const reader of normalReceiptReads) for (const observed of [false, true]) {
    let reads = 0;
    const result = { transactionHash: hash, receipt: observed ? { status: "success", transactionHash: hash } : undefined };
    const read = vm.runInNewContext(ts.transpile(`async function read() { return ${reader}; } read;`, { target: ts.ScriptTarget.ES2022 }), {
      hasUiReceiptOutcome, results: [result], fixtures: [result], index: 0, receiptRemaining: 0, helpersHash: hash, AbortSignal,
      fetcher: undefined, fetchTransactionReceipt: async () => { reads++; return { status: "success", transactionHash: hash }; },
    }) as () => Promise<unknown>;
    const value = await read();
    assert.equal(reads, observed ? 1 : 0); assert.equal(Boolean(value), observed);
  }
});
