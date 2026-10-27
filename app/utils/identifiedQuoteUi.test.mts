import assert from "node:assert/strict";
import test from "node:test";
import { expect } from "@playwright/test";
import { QuotePreviewError } from "./quoteErrors.ts";
import { createUiQuoteDiagnostics, uiPreparationAssertion, uiSetupFailure } from "../../tests/trading/uiDiagnostics.ts";
import { failureResult, resultFor } from "../../tests/trading/regression.ts";
import { tradeScenarios } from "../../tests/trading/scenarios.ts";
import { protocolConfigurationFixture as config, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";

const scenario = { ...tradeScenarios.find(row => row.asset === "USDC" && row.side === "buy"
  && row.inputMode === "exact-in" && row.requestedStrategy === "core")!, amountRaw: "100" };
const request = { intent: 0, inputs: [{ currency: tokenAddresses.USDC, amount: "100" }], outputCurrency: config.contracts.core! };
const attemptId = "e9eb96b2-8ecf-429d-9e08-244f43257e8e", requestId = "eb3e6932-a2af-4303-a09e-35831f864a1d";
const pendingAmount = () => expect.poll(async () => false, { timeout: 10 }).toBe(true);

function observer(code: string) {
  const diagnostics = createUiQuoteDiagnostics(scenario, config);
  assert.equal(diagnostics.request("/api/economic-quotes", request, attemptId), true);
  assert.equal(diagnostics.diagnostic({ operation: "quote", attemptId, requestId, outcome: "failed", errorClassification: code,
    quoteDiagnostics: { phase: "initial-search", elapsedMs: 15000 } }), true);
  return diagnostics;
}

async function prepareFailure(diagnostics: ReturnType<typeof createUiQuoteDiagnostics>) {
  let failure: unknown;
  try { await uiPreparationAssertion("ui-quoted-amount-not-ready", pendingAmount, () => diagnostics.snapshot()); }
  catch (error) { failure = error; }
  return { failure, result: failureResult(resultFor(scenario, "execution"), failure) };
}

test("an original matched economic quote rejection retains its typed cause instead of an amount readiness failure", async () => {
  const { failure, result } = await prepareFailure(observer("redemption-supply-exceeded"));
  assert.ok(failure instanceof QuotePreviewError);
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "redemption-supply-exceeded");
  assert.deepEqual(result.refs, { attemptId, requestId });
  assert.deepEqual(result.quoteDiagnostics, { phase: "initial-search", elapsedMs: 15000 });
});

test("a matched technical quote failure remains a failed case with its actual cause", async () => {
  const { failure, result } = await prepareFailure(observer("quote-timeout"));
  assert.ok(failure instanceof QuotePreviewError);
  assert.equal(result.status, "fail");
  assert.equal(result.code, "quote-timeout");
});

test("basket issuance follows its actual asset vector and retains its identified rejection", async () => {
  const basket = { ...tradeScenarios.find(row => row.asset === "BASKET" && row.side === "buy"
    && row.inputMode === "exact-in")!, amountRaw: "100", basketAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT],
    basketAmounts: ["100", "200"] };
  const diagnostics = createUiQuoteDiagnostics(basket, config);
  const inputs = basket.basketAssets.map((currency, i) => ({ currency, amount: basket.basketAmounts[i] }));
  assert.equal(diagnostics.request("/api/economic-quotes", { intent: 2, inputs,
    outputCurrency: config.contracts.core! }, attemptId), true);
  assert.equal(diagnostics.diagnostic({ operation: "quote", attemptId, requestId, outcome: "failed",
    errorClassification: "issuance-cap-exceeded" }), true);
  const { result } = await prepareFailure(diagnostics);
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "issuance-cap-exceeded");
  assert.deepEqual(result.refs, { attemptId, requestId });
  assert.equal(diagnostics.request("/api/economic-quotes", { intent: 2,
    inputs: inputs.toReversed(), outputCurrency: config.contracts.core! }, attemptId), false);
});

test("unknown and superseded quote diagnostics do not excuse an amount readiness failure", async () => {
  const unknown = await prepareFailure(observer("private-unknown-code"));
  assert.equal(unknown.result.status, "fail");
  assert.equal(unknown.result.code, "ui-quoted-amount-not-ready");
  const diagnostics = observer("redemption-supply-exceeded");
  const latest = "484c0d1a-0000-4000-8000-000000000001";
  assert.equal(diagnostics.request("/api/economic-quotes", request, latest), true);
  assert.equal(diagnostics.diagnostic({ operation: "quote", attemptId, outcome: "failed",
    errorClassification: "redemption-supply-exceeded" }), false);
  const superseded = await prepareFailure(diagnostics);
  assert.equal(superseded.result.status, "fail");
  assert.equal(superseded.result.code, "ui-quoted-amount-not-ready");
});

test("quote evidence does not replace unrelated errors or participate in a successful readiness assertion", async () => {
  const readError = new Error("ordinary UI read failure");
  let evidenceReads = 0;
  const evidence = () => { evidenceReads++; return observer("redemption-supply-exceeded").snapshot(); };
  await assert.rejects(uiPreparationAssertion("ui-swap-not-enabled", async () => { throw readError; }, evidence), error => error === readError);
  await uiPreparationAssertion("ui-swap-not-enabled", async () => {}, evidence);
  assert.equal(evidenceReads, 0);
});

test("a domain rejection cannot satisfy a required UI setup trade", () => {
  const diagnostics = observer("redemption-supply-exceeded");
  const failed = uiSetupFailure(resultFor(scenario, "execution"), new QuotePreviewError("redemption-supply-exceeded", "rejected"), diagnostics.snapshot());
  assert.equal(failed.status, "fail");
  assert.equal(failed.code, "ui-setup-failed");
  assert.equal(failed.reason, "redemption-supply-exceeded");
  assert.deepEqual(failed.refs, { attemptId, requestId });
});
