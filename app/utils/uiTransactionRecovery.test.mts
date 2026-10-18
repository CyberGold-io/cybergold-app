import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { Page } from "@playwright/test";
import { createSwapDiagnostics } from "./clientDiagnostics.ts";
import { uiCompletionAssertion } from "../../tests/trading/uiDiagnostics.ts";
import { installUiSwapObservation, uiSwapObservation } from "../../tests/trading/uiSwapObservation.ts";
import { recoverUiTransaction, uiWalletRequestSettled } from "../../tests/trading/uiTransactionRecovery.ts";
import { failureResult, type ScenarioResult } from "../../tests/trading/regression.ts";

const hash = `0x${"a".repeat(64)}` as const;
const previousHash = `0x${"b".repeat(64)}` as const;
const blockHash = `0x${"c".repeat(64)}` as const;
const blockNumber = 2n ** 60n + 1n;

function localPage() {
  const scope = new EventTarget() as unknown as Window;
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: scope });
  const page = { evaluate: async (read: (argument?: string) => unknown, argument?: string) => read(argument) } as unknown as Page;
  installUiSwapObservation(scope);
  return { scope, page, restore() {
    if (before) Object.defineProperty(globalThis, "window", before);
    else Reflect.deleteProperty(globalThis, "window");
  } };
}

const failedResult = (): ScenarioResult => ({ id: "ui-core-issue-usdc-exact-in-small", family: "issue-token", asset: "USDC", inputMode: "exact-in",
  requestedStrategy: "auto", actualStrategy: "core", layer: "execution", executionAttempted: true,
  executionStage: "ui-confirmation", status: "fail", code: "ui-completion-not-observed", transactionDisposition: "unknown" });

function receiptFetcher(status: "success" | "reverted", count = { reads: 0 }, receiptHash = hash) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    count.reads++;
    assert.equal(String(url), `/api/transaction/receipt?hash=${hash}`);
    assert.equal(init?.method, undefined); assert.equal(init?.cache, "no-store");
    return Response.json({ chainId: 31338, observedAt: "2026-10-18T19:42:00Z", transactionHash: hash,
      receipt: { transactionHash: receiptHash, blockHash, blockNumber: String(blockNumber), status, logs: [] } });
  }) as typeof fetch;
}

test("reproduce a hashless UI deadline followed by the original wallet returning its broadcast hash", async () => {
  const local = localPage();
  try {
    const swap = createSwapDiagnostics({}, undefined, () => {});
    swap.walletStep("transaction");
    let broadcastCount = 0, finishOriginal!: (value: typeof hash) => void;
    const originalRequest = new Promise<typeof hash>(resolve => { finishOriginal = resolve; });
    const productCompletion = originalRequest.then(value => { broadcastCount++; swap.submitted(value); swap.confirmed(value); });
    const matcherError = Object.assign(new Error("UI deadline"), { matcherResult: {} });
    let error: unknown;
    try { await uiCompletionAssertion(async () => { throw matcherError; }, () => false); } catch (value) { error = value; }
    const result = failureResult(failedResult(), error);
    assert.equal(result.code, "ui-completion-not-observed");
    assert.equal(result.transactionHash, undefined);
    assert.equal(uiWalletRequestSettled(await uiSwapObservation(local.page, swap.id), swap.id), false);
    // The old suite advanced here although this same native request was live.
    finishOriginal(hash); await productCompletion;
    const observed = await uiSwapObservation(local.page, swap.id), reads = { reads: 0 };
    assert.equal(uiWalletRequestSettled(observed, swap.id), true);
    await recoverUiTransaction(result, swap.id, observed, receiptFetcher("success", reads));
    assert.equal(broadcastCount, 1); assert.equal(reads.reads, 1);
    assert.equal(result.transactionHash, hash); assert.equal(result.transactionDisposition, "confirmed");
    assert.equal(result.receipt?.status, "success"); assert.equal(result.receipt?.blockNumber, String(blockNumber));
    assert.equal(result.status, "fail"); assert.equal(result.code, "ui-completion-not-observed");
  } finally { local.restore(); }
});

test("App-reported revert retains an independently observed reverted receipt without becoming pass", async () => {
  const local = localPage();
  try {
    const swap = createSwapDiagnostics({}, undefined, () => {});
    swap.submitted(hash); swap.failed({ name: "TransactionRevertedError" });
    const result = { ...failedResult(), code: "product-reported-revert" };
    await recoverUiTransaction(result, swap.id, await uiSwapObservation(local.page, swap.id), receiptFetcher("reverted"));
    assert.equal(result.receipt?.status, "reverted"); assert.equal(result.receipt?.transactionHash, hash);
    assert.equal(result.receipt?.blockHash, blockHash); assert.equal(result.transactionDisposition, "confirmed");
    assert.equal(result.status, "fail"); assert.equal(result.code, "product-reported-revert");
  } finally { local.restore(); }
});

test("a successful mined receipt preserves failed economic/UI assertions and their existing evidence", async () => {
  const result = { ...failedResult(), transactionHash: hash, code: "wallet-receipt-paid-mismatch",
    receipt: { netPaid: ["100"], netReceived: ["99"] }, bounds: { inputMaximum: "100" }, reason: "ui-balance-postchecks" as const };
  await recoverUiTransaction(result, undefined, undefined, receiptFetcher("success"));
  assert.equal(result.status, "fail"); assert.equal(result.code, "wallet-receipt-paid-mismatch");
  assert.equal(result.reason, "ui-balance-postchecks"); assert.deepEqual(result.receipt?.netPaid, ["100"]);
  assert.deepEqual(result.bounds, { inputMaximum: "100" }); assert.equal(result.transactionDisposition, "confirmed");
});

test("explicit native rejection settles this attempt, whereas a generic hashless failure remains unknown", async () => {
  const local = localPage();
  const noRead = (async () => { throw new Error("must not invent a hash or query any transaction"); }) as typeof fetch;
  try {
    const rejected = createSwapDiagnostics({}, undefined, () => {});
    rejected.walletStep("signature"); rejected.failed({ code: 4001 });
    const observation = await uiSwapObservation(local.page, rejected.id), result = failedResult();
    assert.equal(uiWalletRequestSettled(observation, rejected.id), true);
    await recoverUiTransaction(result, rejected.id, observation, noRead);
    assert.equal(result.walletRequestErrorCode, 4001); assert.equal(result.transactionDisposition, "not-submitted");
    assert.equal(result.status, "fail"); assert.equal(result.transactionHash, undefined);
    const failed = createSwapDiagnostics({}, undefined, () => {});
    failed.walletStep("transaction"); failed.failed(new Error("unknown failure"));
    const unknown = failedResult(), generic = await uiSwapObservation(local.page, failed.id);
    assert.equal(uiWalletRequestSettled(generic, failed.id), false);
    await recoverUiTransaction(unknown, failed.id, generic, noRead);
    assert.equal(unknown.transactionDisposition, "unknown"); assert.equal(unknown.walletRequestErrorCode, undefined);
  } finally { local.restore(); }
});

test("a late predecessor hash or cancellation cannot retarget the current attempt", async () => {
  const local = localPage();
  try {
    const previous = createSwapDiagnostics({}, undefined, () => {}), current = createSwapDiagnostics({}, undefined, () => {});
    previous.submitted(previousHash); previous.failed({ code: 4001 });
    const old = await uiSwapObservation(local.page, previous.id), result = failedResult();
    assert.equal(uiWalletRequestSettled(old, current.id), false);
    await recoverUiTransaction(result, current.id, old, (async () => { throw new Error("unrelated receipt read"); }) as typeof fetch);
    assert.equal(result.transactionHash, undefined); assert.equal(result.walletRequestErrorCode, undefined);
    assert.equal(result.transactionDisposition, "unknown"); assert.equal(result.refs?.attemptId, undefined);
  } finally { local.restore(); }
});

test("the actual redemption flow awaits its signature before reaching a pre-submission failure", async () => {
  const local = localPage();
  try {
    const source = readFileSync(new URL("../hooks/flows/shared/useRedemptionExecution.ts", import.meta.url), "utf8");
    const parsed = ts.createSourceFile("flow.ts", source, ts.ScriptTarget.Latest, true);
    let callback: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "submitRedemption"
        && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(parsed); assert.ok(callback);
    const swap = createSwapDiagnostics({}, undefined, () => {});
    let finishSignature!: () => void, signatureStarted!: () => void, broadcasts = 0;
    const signature = new Promise<void>(resolve => { finishSignature = resolve; });
    const requested = new Promise<void>(resolve => { signatureStarted = resolve; });
    const submit = vm.runInNewContext(ts.transpile(`const submit = ${callback.getText(parsed)}; submit;`,
      { target: ts.ScriptTarget.ES2022 }), {
      HELPERS_DIAMOND_ADDRESS: `0x${"1".repeat(40)}`, requireProtocolAddress: (value: unknown) => value,
      signCygldPermit: async (args: { walletConfirmationTracker: { requestNext: (kind: string) => void } }) => {
        args.walletConfirmationTracker.requestNext("signature"); signatureStarted(); await signature;
        return { value: 1n };
      },
      estimateSignedContractFee: async () => { throw new Error("pre-submission read failed"); },
      writeContractAsync: async () => { broadcasts++; throw new Error("must not broadcast"); },
    }) as (args: unknown) => Promise<unknown>;
    const pending = submit({ owner: `0x${"2".repeat(40)}`, operation: "redeemToTokenExactIn", grossCygldIn: 1n,
      request: {}, diagnosticStage: swap.stage, walletConfirmationTracker: { requestNext: swap.walletStep } })
      .catch(error => { swap.failed(error); });
    await requested;
    const waiting = await uiSwapObservation(local.page, swap.id);
    assert.equal(waiting?.stage, "authorization"); assert.equal(uiWalletRequestSettled(waiting, swap.id), false);
    finishSignature(); await pending;
    const failed = await uiSwapObservation(local.page, swap.id);
    assert.equal(failed?.outcome, "failed"); assert.equal(failed?.stage, "simulation");
    assert.equal(failed?.walletStep, "signature"); assert.equal(uiWalletRequestSettled(failed, swap.id), true);
    assert.equal(broadcasts, 0);
    const result = failedResult();
    await recoverUiTransaction(result, swap.id, failed, (async () => { throw new Error("no receipt without a hash"); }) as typeof fetch);
    // Native lifecycle completion alone does not invent a no-submission result.
    assert.equal(result.transactionDisposition, "unknown"); assert.equal(result.walletRequestErrorCode, undefined);
  } finally { local.restore(); }
});

test("missing receipt, service error, or unrelated returned receipt cannot invent settlement", async () => {
  for (const fetcher of [
    (async () => Response.json({ receipt: null })) as typeof fetch,
    (async () => Response.json({ error: "unavailable" }, { status: 503 })) as typeof fetch,
    receiptFetcher("success", undefined, previousHash),
  ]) {
    const result = { ...failedResult(), transactionHash: hash };
    await recoverUiTransaction(result, undefined, undefined, fetcher);
    assert.equal(result.transactionHash, hash); assert.equal(result.transactionDisposition, "unknown");
    assert.equal(result.receipt, undefined); assert.equal(result.status, "fail");
  }
});
