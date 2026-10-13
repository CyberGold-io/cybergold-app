import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "@playwright/test";
import type { Address, Hex } from "viem";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { protocolConfigurationFixture, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";
import { failureResult, RegressionAssertionError, resultFor, type QuoteObservation } from "../../tests/trading/regression.ts";
import { tradeScenarios } from "../../tests/trading/scenarios.ts";

const { executeScenario } = await withEnvironment(appEnvironment, () => import("../../tests/trading/walletExecution.ts"));
const owner = `0x${"a".repeat(40)}` as Address;
const approvalHash = `0x${"b".repeat(64)}` as Hex;

function basketObservation(mode: "exact-in" | "exact-out" = "exact-in"): QuoteObservation {
  const scenario = tradeScenarios.find(row => row.id === `core-issue-basket-${mode}`)!;
  const envelope = { helpers: protocolConfigurationFixture.contracts.helpers!, context: { chainId: protocolConfigurationFixture.chainId,
    blockNumber: "1", blockHash: `0x${"c".repeat(64)}`, observedAt: "2026-10-13T00:00:00Z" } };
  return { scenario, request: mode === "exact-in" ? { mode: "issue-exact-in", maximumAmountsIn: ["100", "200"] }
    : { mode: "issue-exact-out", netCygldOut: "50" },
  value: mode === "exact-in"
    ? { ...envelope, mode: "issue-exact-in", result: { amountsInExact: ["100", "200"], orderedCoreAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT],
      netCygldOut: "50", fees: { protocolFeeCygld: "0", helperFeeCygld: "0" } } }
    : { ...envelope, mode: "issue-exact-out", result: { amountsInExact: ["100", "200"], orderedCoreAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT],
      fees: { protocolFeeCygld: "0", helperFeeCygld: "0" } } },
  result: { ...resultFor(scenario, "execution"), actualStrategy: "core", bounds: { inputMaximum: ["100", "200"], outputMinimum: "50" } } };
}

function walletPage(request: () => Promise<unknown>): Page {
  return { bringToFront: async () => undefined, evaluate: request } as unknown as Page;
}

const installedBasket = () => Response.json({ configuration: {
  basketPermitIssuanceExactIn: { status: "success", value: true }, basketPermitIssuanceExactOut: { status: "success", value: true },
  permit2: { status: "success", value: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
} });

test("basket availability failures preserve the original exception and export only a fixed stage and safe class", async () => {
  for (const mode of ["exact-in", "exact-out"] as const) {
    const observation = basketObservation(mode);
    const error = Object.assign(new Error("private-wallet-seed signature private-provider-url"),
      { name: "private-error-name", code: "private-error-code" });
    const page = walletPage(async () => { assert.fail("A failed availability read must not request a wallet action"); });
    const fetcher = (async () => { throw error; }) as typeof fetch;
    await assert.rejects(executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher), cause => cause === error);
    assert.equal(observation.result.executionStage, "authorization-availability");
    assert.equal(observation.result.errorClass, "UnknownError");
    assert.equal(observation.result.errorCode, undefined);
    assert.equal(observation.result.transactionHash, undefined);
    assert.equal(observation.result.approvalTransactionHashes, undefined);
    assert.doesNotMatch(JSON.stringify(failureResult(observation.result, error)), /private-wallet-seed|signature|private-provider-url|private-error-name|private-error-code/);
  }
});

test("a basket allowance read failure is distinguished from approval and retains its safe system code", async () => {
  const observation = basketObservation();
  const error = Object.assign(new TypeError("private-rpc-response"), { code: "EACCES" });
  const page = walletPage(async () => { assert.fail("A failed allowance read must not request approval"); });
  const fetcher = (async path => String(path).startsWith("/api/governance/helpers-facts") ? installedBasket()
    : Promise.reject(error)) as typeof fetch;
  await assert.rejects(executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher), cause => cause === error);
  assert.equal(observation.result.executionStage, "allowance-read");
  assert.equal(observation.result.errorClass, "TypeError");
  assert.equal(observation.result.errorCode, "EACCES");
  assert.equal(observation.result.approvalTransactionHashes, undefined);
  assert.doesNotMatch(JSON.stringify(observation.result), /private-rpc-response/);
});

test("a returned approval hash is retained before its receipt completes and survives a reverted approval", async () => {
  const observation = basketObservation();
  const receiptRequested = Promise.withResolvers<void>();
  const receiptResponse = Promise.withResolvers<Response>();
  let walletRequests = 0;
  const page = walletPage(async () => { walletRequests++; return approvalHash; });
  const fetcher = (async path => {
    if (String(path).startsWith("/api/governance/helpers-facts")) return installedBasket();
    if (String(path).startsWith("/api/account/token-permit")) return Response.json({ allowance: { status: "success", value: "0" } });
    if (String(path).startsWith("/api/transaction/receipt")) {
      receiptRequested.resolve();
      return receiptResponse.promise;
    }
    assert.fail("No Helpers simulation or submission should follow a reverted approval");
  }) as typeof fetch;
  const execution = executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher);
  void execution.catch(() => undefined);
  await receiptRequested.promise;
  assert.equal(observation.result.executionStage, "approval-confirmation");
  assert.deepEqual(observation.result.approvalTransactionHashes, [approvalHash]);
  assert.equal(observation.result.transactionHash, undefined);
  assert.equal(walletRequests, 1);
  receiptResponse.resolve(Response.json({ receipt: { status: "reverted", transactionHash: approvalHash,
    blockNumber: "1", blockHash: `0x${"c".repeat(64)}`, logs: [] } }));
  let failure: unknown;
  try { await execution; } catch (error) { failure = error; }
  assert.ok(failure instanceof RegressionAssertionError);
  assert.equal(failure.code, "receipt-reverted");
  assert.equal(observation.result.executionStage, "approval-confirmation");
  assert.deepEqual(failureResult(observation.result, failure).approvalTransactionHashes, [approvalHash]);
  assert.equal(walletRequests, 1);
});

test("a rejected approval request retains its submission stage without inventing a transaction hash", async () => {
  const observation = basketObservation();
  const error = Object.assign(new Error("private-wallet-response"), { code: 4001 });
  const page = walletPage(async () => { throw error; });
  const fetcher = (async path => String(path).startsWith("/api/governance/helpers-facts") ? installedBasket()
    : Response.json({ allowance: { status: "success", value: "0" } })) as typeof fetch;
  await assert.rejects(executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher), cause => cause === error);
  assert.equal(observation.result.executionStage, "approval-submission");
  assert.equal(observation.result.approvalTransactionHashes, undefined);
  assert.equal(observation.result.transactionHash, undefined);
  assert.doesNotMatch(JSON.stringify(observation.result), /private-wallet-response/);
});

test("a later mixed-basket approval failure preserves every already returned approval hash", async () => {
  const observation = basketObservation();
  const secondHash = `0x${"d".repeat(64)}` as Hex;
  let walletRequests = 0;
  const page = walletPage(async () => ++walletRequests === 1 ? approvalHash : secondHash);
  const fetcher = (async path => {
    const url = String(path);
    if (url.startsWith("/api/governance/helpers-facts")) return installedBasket();
    if (url.startsWith("/api/account/token-permit")) return Response.json({ allowance: { status: "success", value: "0" } });
    if (url.startsWith("/api/transaction/receipt")) {
      const hash = new URL(url, "http://fixture.invalid").searchParams.get("hash");
      return Response.json({ receipt: { status: hash === approvalHash ? "success" : "reverted", transactionHash: hash,
        blockNumber: "1", blockHash: `0x${"c".repeat(64)}`, logs: [] } });
    }
    assert.fail("A reverted Permit2 approval must stop before nonce/signature or Helpers submission");
  }) as typeof fetch;
  await assert.rejects(executeScenario(observation, page, owner, protocolConfigurationFixture, fetcher),
    error => error instanceof RegressionAssertionError && error.code === "receipt-reverted");
  assert.equal(walletRequests, 2);
  assert.equal(observation.result.executionStage, "approval-confirmation");
  assert.deepEqual(observation.result.approvalTransactionHashes, [approvalHash, secondHash]);
  assert.equal(observation.result.transactionHash, undefined);
});
