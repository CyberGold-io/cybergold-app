import assert from "node:assert/strict";
import test from "node:test";
import { errors } from "@playwright/test";
import type { Address } from "viem";
import { fundSandboxWallet, SandboxFundingError } from "../../tests/trading/sandboxFunding.ts";
import { createUiQuoteDiagnostics, uiSetupFailure } from "../../tests/trading/uiDiagnostics.ts";
import { failureResult, resultFor } from "../../tests/trading/regression.ts";
import { setupPurchase } from "../../tests/trading/setupPurchase.ts";
import { protocolConfigurationFixture as config, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";
import type { ValuationSnapshot } from "../../tests/trading/matrix.ts";

const correlationId = "a87aa638-976c-489b-ab1a-ab6f5f0029ca", requestId = "76e288ac-e314-4b3c-8769-680b509ae023";
const scenario = { id: "fixture", family: "issue-token", requestedStrategy: "core", side: "buy", inputMode: "exact-in", asset: "PAXG", displayAmount: "1" } as const;

test("Sandbox funding retains canonical TIMEOUT and UUID references without changing its single request or failure code", async () => {
  const mode = process.env.TRADE_REGRESSION_MODE, identity = process.env.TRADE_REGRESSION_FAUCET_REQUEST_ID;
  process.env.TRADE_REGRESSION_MODE = "sandbox-execution"; process.env.TRADE_REGRESSION_FAUCET_REQUEST_ID = requestId;
  let calls = 0, error: unknown;
  try {
    await fundSandboxWallet(config.contracts.helpers! as Address, (async (_url, init) => {
      calls++; assert.equal(JSON.parse(String(init?.body)).requestId, requestId);
      return Response.json({ code: "TIMEOUT", correlationId, error: "private-upstream-text", rawTransaction: "private-signed-data" },
        { status: 504, headers: { "X-CyberGold-Request-Id": requestId } });
    }) as typeof fetch).catch(cause => { error = cause; });
  } finally {
    if (mode === undefined) delete process.env.TRADE_REGRESSION_MODE; else process.env.TRADE_REGRESSION_MODE = mode;
    if (identity === undefined) delete process.env.TRADE_REGRESSION_FAUCET_REQUEST_ID; else process.env.TRADE_REGRESSION_FAUCET_REQUEST_ID = identity;
  }
  assert.equal(calls, 1); assert.ok(error instanceof SandboxFundingError);
  const failed = failureResult(resultFor(scenario, "execution"), error);
  assert.equal(failed.status, "fail"); assert.equal(failed.code, "sandbox-wallet-funding-unavailable");
  assert.equal(failed.reason, "TIMEOUT"); assert.deepEqual(failed.refs, { correlationId, requestId });
  const setup = uiSetupFailure(resultFor(scenario, "execution"), error, {});
  assert.equal(setup.code, "ui-setup-failed"); assert.equal(setup.reason, "TIMEOUT");
  assert.doesNotMatch(JSON.stringify(setup), /private-|rawTransaction/);
});

test("unknown faucet codes retain only HTTP status while malformed references and payload fields are discarded", () => {
  const failed = failureResult(resultFor(scenario, "execution"), new SandboxFundingError(new Response(null, { status: 503 }),
    { code: "private-code", correlationId: "private-reference", error: "private-provider-url" }));
  assert.equal(failed.reason, "HTTP_503"); assert.deepEqual(failed.refs, {});
  assert.doesNotMatch(JSON.stringify(failed), /private-/);
});

test("the latest original setup quote keeps its safe reason, work snapshot and references through the unchanged setup catch", () => {
  const valuation = { id: "fixture", prices: { [tokenAddresses.PAXG.toLowerCase()]: { numerator: "1", denominator: "1" },
    [tokenAddresses.CYGLD.toLowerCase()]: { numerator: "1", denominator: "1" } } } as unknown as ValuationSnapshot;
  const setup = setupPurchase(config, valuation, "0.25", "fixture-wallet-rejection"), observer = createUiQuoteDiagnostics(setup, config);
  const attemptId = "484c0d1a-0000-4000-8000-000000000001";
  assert.equal(observer.request("/api/quotes/universal-exact-input", { intent: 0, inputs: [{ currency: tokenAddresses.PAXG, amount: setup.amountRaw }],
    outputCurrency: config.contracts.core }, attemptId), true);
  assert.equal(observer.diagnostic({ operation: "quote", attemptId, requestId, outcome: "failed", errorClassification: "quote-timeout",
    quoteDiagnostics: { phase: "initial-search", elapsedMs: 15000, privateMessage: "private-provider-token" } }), true);
  const failed = uiSetupFailure(resultFor(setup, "execution"), new errors.TimeoutError("private-error-message"), observer.snapshot());
  assert.equal(failed.status, "fail"); assert.equal(failed.code, "ui-setup-timeout"); assert.equal(failed.reason, "quote-timeout");
  assert.deepEqual(failed.refs, { attemptId, requestId });
  assert.deepEqual(failed.quoteDiagnostics, { phase: "initial-search", elapsedMs: 15000 });
  assert.equal(failed.errorClass, "TimeoutError"); assert.doesNotMatch(JSON.stringify(failed), /private-/);
  assert.equal(observer.diagnostic({ operation: "quote", attemptId: correlationId, outcome: "failed", errorClassification: "rpc-timeout" }), false);
  assert.equal(observer.snapshot().reason, "quote-timeout");
});
