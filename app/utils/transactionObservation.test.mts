import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { Page } from "@playwright/test";
import { CLIENT_DIAGNOSTIC_EVENT, createSwapDiagnostics, type ClientDiagnostic } from "./clientDiagnostics.ts";
import { installUiSwapObservation, uiSwapObservation } from "../../tests/trading/uiSwapObservation.ts";
import { uiCompletionAssertion, uiSwapTerminalFailure } from "../../tests/trading/uiDiagnostics.ts";
import { hasUiReceiptOutcome, recoverUiTransaction } from "../../tests/trading/uiTransactionRecovery.ts";
import type { ScenarioResult } from "../../tests/trading/regression.ts";

const hash = `0x${"a".repeat(64)}` as const;
const original = `0x${"b".repeat(64)}` as const;

function localPage() {
  const scope = new EventTarget() as unknown as Window;
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: scope });
  const page = { evaluate: async (read: (argument?: string) => unknown, argument?: string) => read(argument) } as unknown as Page;
  return { scope, page, restore() {
    if (before) Object.defineProperty(globalThis, "window", before);
    else Reflect.deleteProperty(globalThis, "window");
  } };
}

test("primary and later receipt recheck share one attempt and retain the confirmed hash", async () => {
  const events: ClientDiagnostic[] = [];
  const swap = createSwapDiagnostics({}, undefined, value => events.push(value));
  const broadcasts = 1;
  let reads = 0;
  swap.submitted(original);
  await assert.rejects(swap.confirm(async () => { reads++; throw new Error("observation unavailable"); }));
  swap.failed({ name: "TimeoutError" });
  const result = await swap.confirm(async () => { reads++; return { transactionHash: hash, logs: [] }; });
  assert.equal(result.transactionHash, hash);
  assert.equal(broadcasts, 1); assert.equal(reads, 2);
  assert.deepEqual(events.map(value => value.outcome), ["started", "submitted", "unconfirmed", "succeeded"]);
  assert.equal(new Set(events.map(value => value.attemptId)).size, 1);
  assert.equal(events.at(-1)?.transactionHash, hash);
  assert.equal(events.at(-1)?.stage, "confirmation");
});

test("synchronous local observation survives telemetry failure and cannot mutate its producer", async () => {
  const local = localPage();
  try {
    installUiSwapObservation(local.scope);
    const network: ClientDiagnostic[] = [];
    local.scope.addEventListener(CLIENT_DIAGNOSTIC_EVENT, event => {
      (event as CustomEvent<ClientDiagnostic>).detail.transactionHash = "private-listener-mutation";
    });
    const swap = createSwapDiagnostics({}, undefined, value => { network.push(value); throw new Error("collector unavailable"); });
    swap.submitted(hash);
    assert.equal((await uiSwapObservation(local.page, swap.id))?.transactionHash, hash);
    assert.equal(network.at(-1)?.transactionHash, hash);
    assert.doesNotMatch(JSON.stringify(network), /private-listener/);
  } finally { local.restore(); }
});

test("late predecessor events retain their own identity and no raw payload is captured", async () => {
  const local = localPage();
  try {
    installUiSwapObservation(local.scope);
    const old = createSwapDiagnostics({}, undefined, () => {});
    const current = createSwapDiagnostics({}, undefined, () => {});
    current.submitted(hash);
    old.submitted(original);
    assert.deepEqual(await uiSwapObservation(local.page), { attemptId: current.id, outcome: "submitted", transactionHash: hash, stage: "submission" });
    assert.deepEqual(await uiSwapObservation(local.page, old.id), { attemptId: old.id, outcome: "submitted", transactionHash: original, stage: "submission" });
    local.scope.dispatchEvent(new CustomEvent(CLIENT_DIAGNOSTIC_EVENT, { detail: {
      operation: "swap", attemptId: current.id, outcome: "unconfirmed", transactionHash: "private-calldata",
      message: "private-wallet-url", signature: "private-signature", params: ["private-request"],
    } }));
    assert.deepEqual(await uiSwapObservation(local.page, current.id), { attemptId: current.id, outcome: "unconfirmed", transactionHash: hash, stage: "submission" });
    assert.doesNotMatch(JSON.stringify(local.scope), /private-/);
  } finally { local.restore(); }
});

test("UI confirmation exercises receipt-only recovery inside its existing deadline without resubmitting", async () => {
  const source = readFileSync(new URL("../../tests/metamask/fixed-api-roundtrips.spec.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("suite.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === "approveUntilMined");
  assert.ok(declaration && ts.isFunctionDeclaration(declaration));
  let confirmed = false, recoveries = 0, observations = 0;
  const approve = vm.runInNewContext(ts.transpile(declaration.getText(parsed), { target: ts.ScriptTarget.ES2022 }) + "; approveUntilMined", {
    errors: { TimeoutError: class extends Error {} },
    confirmedTransactionText: () => ({ isVisible: async () => confirmed }),
    getSwapButton: () => { throw new Error("must not resubmit Swap or touch an unrelated wallet request"); },
    uiCompletionAssertion: async (action: () => Promise<unknown>) => action(),
    expect: { poll: (read: () => Promise<boolean>, options: { timeout: number; intervals: number[] }) => {
      assert.equal(options.timeout, 90_000); assert.deepEqual(Array.from(options.intervals), [250, 500, 1000]);
      return { toBe: async (value: boolean) => { assert.equal(await read(), false); assert.equal(await read(), value); } };
    } },
  }) as (page: Page, submitted: () => boolean, observe: () => Promise<void>) => Promise<void>;
  const page = {
    getByText: () => ({ isVisible: async () => false }),
    getByRole: (_role: string, options: { name: RegExp }) => {
      assert.match("Check confirmation", options.name);
      return { isVisible: async () => !confirmed, isEnabled: async () => true,
        click: async () => { recoveries++; confirmed = true; } };
    },
  } as unknown as Page;
  await approve(page, () => true, async () => { observations++; });
  assert.equal(recoveries, 1); assert.equal(observations, 2);
});

/** Execute the actual submit callback, including its optional-read catch. */
function submitObserver(page: Page, result: ScenarioResult, attemptId: string) {
  const source = readFileSync(new URL("../../tests/metamask/fixed-api-roundtrips.spec.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("suite.ts", source, ts.ScriptTarget.Latest, true);
  let callback: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "approveUntilMined")
      callback = node.arguments[2];
    ts.forEachChild(node, visit);
  };
  visit(parsed); assert.ok(callback);
  const scope = { page, uiSwapObservation, uiSwapTerminalFailure, activeSwapAttempt: attemptId,
    helpersHash: undefined as string | undefined, activeResult: () => result,
    currentResult: result, hasUiReceiptOutcome, recoverUiTransaction,
    activeConfirmationDeadline: performance.now() - 1, AbortSignal,
    fetcher: (async () => { throw new Error("No receipt read may start after the original deadline."); }) as typeof fetch,
    confirmation: { elapsedMs: 0, clickAttempts: 0, clickCompleted: 0 }, confirmationStarted: performance.now(), performance };
  const observe = vm.runInNewContext(ts.transpile(`const observe = ${callback.getText(parsed)}; observe;`,
    { target: ts.ScriptTarget.ES2022 }), scope) as () => Promise<void>;
  return { observe, scope };
}

test("current App-reported revert cannot become a deadline error or pass on a stale success toast", async () => {
  const local = localPage();
  try {
    installUiSwapObservation(local.scope);
    const current = createSwapDiagnostics({}, undefined, () => {});
    current.submitted(hash); current.failed({ name: "TransactionRevertedError" });
    const result = { status: "unavailable", transactionDisposition: "unknown", refs: { attemptId: "e9eb96b2-8ecf-429d-9e08-244f43257e8e" } } as ScenarioResult;
    const page = { evaluate: local.page.evaluate, getByText: () => ({ isVisible: async () => false }) } as unknown as Page;
    const { observe, scope } = submitObserver(page, result, current.id!);
    const source = readFileSync(new URL("../../tests/metamask/fixed-api-roundtrips.spec.ts", import.meta.url), "utf8");
    const parsed = ts.createSourceFile("suite.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = parsed.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === "approveUntilMined");
    assert.ok(declaration);
    let polls = 0, staleSuccessReads = 0;
    const approve = vm.runInNewContext(ts.transpile(declaration.getText(parsed), { target: ts.ScriptTarget.ES2022 }) + "; approveUntilMined", {
      errors: { TimeoutError: class extends Error {} }, uiCompletionAssertion,
      confirmedTransactionText: () => ({ isVisible: async () => { staleSuccessReads++; return true; } }),
      expect: { poll: (read: () => Promise<boolean>, options: { timeout: number }) => {
        assert.equal(options.timeout, 90_000);
        return { toBe: async () => { polls++; await read(); } };
      } },
    }) as (page: Page, submitted: () => boolean, observer: () => Promise<void>) => Promise<void>;
    await assert.rejects(approve(page, () => Boolean(scope.helpersHash), observe),
      (error: { code?: string }) => error.code === "product-reported-revert");
    assert.equal(polls, 1); assert.equal(staleSuccessReads, 0);
    assert.equal(scope.helpersHash, hash); assert.equal(result.refs?.attemptId, current.id);
    assert.equal(result.transactionDisposition, "unknown");
    assert.equal(result.receipt, undefined); assert.notEqual(result.status, "pass");
  } finally { local.restore(); }
});

test("a late predecessor revert cannot retarget the current UI case or its hash", async () => {
  const local = localPage();
  try {
    installUiSwapObservation(local.scope);
    const old = createSwapDiagnostics({}, undefined, () => {});
    const current = createSwapDiagnostics({}, undefined, () => {});
    old.submitted(original); old.failed({ name: "TransactionRevertedError" });
    const result = { status: "unavailable", transactionDisposition: "unknown" } as ScenarioResult;
    const { observe, scope } = submitObserver(local.page, result, current.id!);
    await observe();
    assert.equal(scope.activeSwapAttempt, current.id); assert.equal(scope.helpersHash, undefined);
    assert.equal(result.refs?.attemptId, current.id); assert.equal(result.transactionDisposition, "unknown");
    assert.equal(uiSwapTerminalFailure(await uiSwapObservation(local.page, current.id)), undefined);
  } finally { local.restore(); }
});

test("missing hash or a non-reverted observation cannot establish a product-reported revert", () => {
  const attemptId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
  assert.equal(uiSwapTerminalFailure({ attemptId, outcome: "reverted" }), undefined);
  for (const outcome of ["started", "submitted", "succeeded", "failed", "unconfirmed"] as const)
    assert.equal(uiSwapTerminalFailure({ attemptId, outcome, transactionHash: hash }), undefined);
  assert.equal(uiSwapTerminalFailure(undefined), undefined);
});

test("hashless native authorization progress is retained for this attempt without claiming settlement", async () => {
  const local = localPage();
  try {
    installUiSwapObservation(local.scope);
    const old = createSwapDiagnostics({}, undefined, () => {});
    const current = createSwapDiagnostics({}, undefined, () => {});
    current.walletStep("signature"); old.walletStep("transaction");
    const result = { status: "unavailable", transactionDisposition: "unknown" } as ScenarioResult;
    const { observe, scope } = submitObserver(local.page, result, current.id!);
    await observe();
    assert.equal(scope.helpersHash, undefined);
    assert.deepEqual(scope.confirmation, { elapsedMs: scope.confirmation.elapsedMs, clickAttempts: 0,
      clickCompleted: 0, appStage: "authorization", appOutcome: "started", walletStep: "signature" });
    assert.equal(result.transactionDisposition, "unknown");
    local.scope.dispatchEvent(new CustomEvent(CLIENT_DIAGNOSTIC_EVENT, { detail: { operation: "wallet",
      attemptId: current.id, walletStep: "private-signature", stage: "private-url", params: ["private-calldata"] } }));
    assert.doesNotMatch(JSON.stringify(await uiSwapObservation(local.page, current.id)), /private-/);
  } finally { local.restore(); }
});

test("the actual confirmation observer cancels its original bounded receipt read and never starts another after deadline", async () => {
  const local = localPage();
  try {
    installUiSwapObservation(local.scope);
    const current = createSwapDiagnostics({}, undefined, () => {}); current.submitted(hash);
    const result = { status: "fail", code: "ui-completion-not-observed", transactionDisposition: "unknown" } as ScenarioResult;
    const { observe, scope } = submitObserver(local.page, result, current.id!);
    const abort = new AbortController(), started = Promise.withResolvers<void>();
    let reads = 0, boundedMs = 0;
    scope.activeConfirmationDeadline = performance.now() + 50_000;
    scope.AbortSignal = { timeout: (remaining: number) => { boundedMs = remaining; return abort.signal; }, abort: () => AbortSignal.abort() } as unknown as typeof AbortSignal;
    scope.fetcher = (async (_url, init) => {
      reads++; assert.equal(init?.signal, abort.signal); started.resolve();
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("original window ended")), { once: true }));
    }) as typeof fetch;
    const pending = observe(); await started.promise;
    assert.ok(boundedMs > 0 && boundedMs <= 50_000);
    scope.activeConfirmationDeadline = performance.now() - 1; abort.abort(); await pending;
    await observe();
    assert.equal(reads, 1); assert.equal(result.transactionHash, hash); assert.equal(result.receipt, undefined);
    assert.equal(result.transactionDisposition, "unknown"); assert.equal(result.status, "fail");
    assert.equal(result.code, "ui-completion-not-observed");
  } finally { local.restore(); }
});
