import assert from "node:assert/strict";
import test from "node:test";
import { expect, type Page } from "@playwright/test";
import { type Address, type Hex } from "viem";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { protocolConfigurationFixture as config, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";
import { failureResult, resultFor, type QuoteObservation } from "../../tests/trading/regression.ts";
import { tradeScenarios, ScenarioUnavailableError } from "../../tests/trading/scenarios.ts";
import { isWalletRequestCleanupError } from "../../tests/trading/walletRequestLifecycle.ts";
import { transactionDisposition } from "../../tests/trading/providerEvidence.ts";

const { executeScenario, waitReceipt } = await withEnvironment(appEnvironment, () => import("../../tests/trading/walletExecution.ts"));
const owner = `0x${"a".repeat(40)}` as Address;
const hash = `0x${"b".repeat(64)}` as Hex;
const blockHash = `0x${"c".repeat(64)}` as Hex;

async function originalDeadlines<T>(run: () => Promise<T>, observedReceiptDeadlineRace = false) {
  const poll = expect.poll;
  expect.poll = ((read: () => Promise<boolean>, options: { timeout: number; intervals: number[] }) => ({ toBe: async () => {
    assert.equal(options.timeout, 90_000);
    if (options.intervals[0] === 250) { assert.equal(await read(), true); return; }
    assert.deepEqual(options.intervals, [500, 1000, 2000]);
    for (let attempt = 0; attempt < 3; attempt++) if (await read()) {
      if (observedReceiptDeadlineRace) throw new Error("poll deadline rejected after its callback observed the receipt");
      return;
    }
    throw new Error("represented passage of original receipt deadline");
  } })) as unknown as typeof expect.poll;
  try { return await run(); } finally { expect.poll = poll; }
}

function fixture(kind: "business" | "approval", receipt: "missing" | "read-error" | "transient-error-success" | "success" | "late-success" | "reverted", closeError?: Error) {
  const scenario = tradeScenarios.find(row => row.id === (kind === "business" ? "core-redeem-usdc-exact-in" : "core-issue-basket-exact-in"))!;
  const result = { ...resultFor(scenario, "execution"), executionAttempted: true, bounds: kind === "business"
    ? { inputMaximum: "100", outputMinimum: "90" } : { inputMaximum: ["100", "200"], outputMinimum: "50" } };
  const observation = { scenario, result, request: kind === "business" ? { native: false, counterToken: tokenAddresses.USDC }
    : { mode: "issue-exact-in", maximumAmountsIn: ["100", "200"] },
  value: kind === "business" ? { executionAmount: "100", expectedCoreOutputs: [], preview: {}, quotes: [] }
    : { mode: "issue-exact-in", result: { amountsInExact: ["100", "200"], orderedCoreAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT],
      netCygldOut: "50", fees: { protocolFeeCygld: "0", helperFeeCygld: "0" } } } } as unknown as QuoteObservation;
  let sends = 0, closes = 0, receiptReads = 0, transactionReads = 0, sent: Hex | undefined;
  const page = { bringToFront: async () => {}, context: () => ({ close: async () => { closes++; if (closeError) throw closeError; } }),
    evaluate: async (_callback: unknown, request: { params: { data?: Hex }[] }) => { sends++; sent = request.params[0].data; return hash; } } as unknown as Page;
  const fetcher = (async (path: string | URL | Request) => {
    const url = String(path);
    if (url.startsWith("/api/governance/helpers-facts")) return Response.json({ configuration: {
      basketPermitIssuanceExactIn: { status: "success", value: true },
      basketPermitIssuanceExactOut: { status: "success", value: true },
      permit2: { status: "success", value: "0x000000000022D473030F116dDEE9F6B43aC78BA3" } } });
    if (url.startsWith("/api/account/token-permit")) return Response.json({ allowance: { status: "success", value: kind === "approval" ? "0" : "1000" } });
    if (url.startsWith("/api/transaction/helpers-execution")) return Response.json({ helpers: config.contracts.helpers, gas: "100000" });
    if (url.startsWith("/api/transaction/receipt")) {
      receiptReads++;
      assert.equal(new URL(url, "http://fixture.invalid").searchParams.get("hash"), hash);
      if (receipt === "read-error" || receipt === "transient-error-success" && receiptReads === 1) return Response.json({ error: "unavailable" }, { status: 503 });
      if (receipt === "missing" || receipt === "late-success" && receiptReads < 3) return Response.json({ receipt: null });
      return Response.json({ receipt: { status: receipt === "reverted" ? "reverted" : "success", transactionHash: hash,
        blockHash, blockNumber: "1", logs: [] } });
    }
    if (url.startsWith("/api/transaction/wait/transaction")) {
      transactionReads++;
      return Response.json({ transaction: { from: owner, to: config.contracts.helpers, input: sent } });
    }
    assert.fail(`Unexpected fixture read ${url}`);
  }) as typeof fetch;
  return { observation, page, fetcher, counts: () => ({ sends, closes, receiptReads, transactionReads }) };
}

for (const kind of ["business", "approval"] as const)
  for (const receipt of ["missing", "read-error"] as const)
  test(`actual ${kind} caller closes its owned run after the original unobserved receipt deadline (${receipt})`, async () => originalDeadlines(async () => {
    const f = fixture(kind, receipt);
    let nextCase = false, captured: unknown;
    await assert.rejects(executeScenario(f.observation, f.page, owner, config, f.fetcher).catch(error => {
      captured = error;
      if (isWalletRequestCleanupError(error)) throw error;
    }).then(() => { nextCase = true; }), error => error instanceof ScenarioUnavailableError
      && error.code === "submitted-unconfirmed" && isWalletRequestCleanupError(error));
    assert.equal(nextCase, false);
    assert.equal(f.counts().sends, 1);
    assert.equal(f.counts().closes, 1);
    assert.equal(f.counts().receiptReads, 3);
    assert.equal(f.counts().transactionReads, 0);
    const result = failureResult(f.observation.result, captured);
    assert.equal(result.status, "fail"); assert.equal(result.code, "submitted-unconfirmed");
    assert.equal(result.receipt, undefined);
    assert.equal(result.walletRequest?.cleanup, "context-closed");
    assert.equal(result.walletRequest?.settlement, "fulfilled");
    assert.equal(result.walletRequest?.cleanupClickAttempts, 0);
    assert.ok((result.walletRequest?.cleanupElapsedMs ?? -1) >= 0);
    if (kind === "business") {
      assert.equal(result.transactionHash, hash);
      assert.equal(transactionDisposition(result), "unknown");
      assert.equal(result.approvalTransactionHashes, undefined);
    } else {
      assert.deepEqual(result.approvalTransactionHashes, [hash]);
      assert.equal(result.transactionHash, undefined, "An unresolved approval is not a submitted business trade.");
      assert.equal(result.executionStage, "approval-confirmation");
    }
  }));

for (const receipt of ["success", "late-success", "transient-error-success", "reverted"] as const)
  test(`actual direct business ${receipt} receipt follows existing assertions without closing the run`, async () => originalDeadlines(async () => {
    const f = fixture("business", receipt);
    await assert.rejects(executeScenario(f.observation, f.page, owner, config, f.fetcher), error => {
      assert.equal(isWalletRequestCleanupError(error), false);
      assert.equal((error as Error & { code: string }).code, receipt === "reverted" ? "receipt-reverted" : "operation-event-missing");
      return true;
    });
    assert.equal(f.counts().sends, 1); assert.equal(f.counts().closes, 0);
    assert.equal(f.observation.result.transactionHash, hash);
    assert.equal(f.observation.result.receipt?.status, receipt === "reverted" ? "reverted" : "success");
    assert.equal(f.observation.result.transactionDisposition, "confirmed");
    assert.equal(f.counts().receiptReads, receipt === "late-success" ? 3 : receipt === "transient-error-success" ? 2 : 1);
  }));

test("receipt-deadline disposal failure keeps ordinary error identity and original unresolved hash", async () => originalDeadlines(async () => {
  const closeError = new Error("ordinary context close failure"), f = fixture("business", "missing", closeError);
  await assert.rejects(executeScenario(f.observation, f.page, owner, config, f.fetcher), error => error === closeError && isWalletRequestCleanupError(error));
  assert.equal(f.observation.result.transactionHash, hash);
  assert.equal(f.observation.result.transactionDisposition, "unknown");
  assert.equal(f.observation.result.receipt, undefined);
  assert.equal(f.observation.result.walletRequest?.cleanup, "unresolved");
  assert.equal(f.observation.result.walletRequest?.settlement, "fulfilled");
  assert.equal(f.counts().closes, 1);
}));

test("a receipt already observed at a poll deadline race keeps its normal success/revert assertions and no close", async () => originalDeadlines(async () => {
  for (const receipt of ["success", "reverted"] as const) {
    const f = fixture("business", receipt);
    await assert.rejects(executeScenario(f.observation, f.page, owner, config, f.fetcher), error => {
      assert.equal(isWalletRequestCleanupError(error), false);
      assert.equal((error as Error & { code: string }).code, receipt === "reverted" ? "receipt-reverted" : "operation-event-missing");
      return true;
    });
    assert.equal(f.counts().closes, 0); assert.equal(f.counts().receiptReads, 1);
    assert.equal(f.observation.result.transactionDisposition, "confirmed");
    assert.equal(f.observation.result.receipt?.status, receipt);
  }
}, true));

test("pure receipt utility without a browser owner keeps its existing submitted-unconfirmed error", async () => originalDeadlines(async () => {
  await assert.rejects(waitReceipt(hash, (async () => Response.json({ receipt: null })) as typeof fetch),
    error => error instanceof ScenarioUnavailableError && error.code === "submitted-unconfirmed" && !isWalletRequestCleanupError(error));
}));
