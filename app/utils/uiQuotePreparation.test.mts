import assert from "node:assert/strict";
import test from "node:test";
import { zeroAddress } from "viem";
import { uiQuoteReady } from "../../tests/trading/uiQuotePreparation.ts";
import { createUiQuoteDiagnostics } from "../../tests/trading/uiDiagnostics.ts";
import { tokenRequest } from "../../tests/trading/regression.ts";
import { tradeScenarios, type Scenario } from "../../tests/trading/scenarios.ts";
import { protocolConfigurationFixture as config, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";
import type { QuoteObservation } from "../../tests/trading/quoteObservation.ts";
import { privateSandboxSelection } from "../../tests/trading/privateSandbox.ts";
import type { MatrixScenario } from "../../tests/trading/matrix.ts";
import type { UniversalExactInputQuote } from "./universalExactInput.ts";

const assets = [tokenAddresses.PAXG, tokenAddresses.XAUT];
const attempt = "e9eb96b2-8ecf-429d-9e08-244f43257e8e";
for (const asset of ["PAXG", "USDC", "ETH", "BASKET"] as const) for (const side of ["buy", "sell"] as const) {
  test(`ordinary UI preparation follows the original ${asset} ${side} universal terminal without another request`, () => {
    const template = tradeScenarios.find(row => row.asset === asset && row.side === side && row.inputMode === "exact-in" && row.requestedStrategy === "core")!;
    const scenario: Scenario = { ...template, amountRaw: "200", ...(asset === "BASKET" ? { basketAssets: assets, basketAmounts: ["200", "0"] } : {}) };
    const counter = asset === "BASKET" ? zeroAddress : asset === "ETH" ? zeroAddress : tokenRequest(scenario, config, config.contracts.helpers!).counterToken;
    const request = { intent: asset === "BASKET" ? side === "buy" ? 2 : 3 : side === "buy" ? 0 : 1,
      inputs: asset === "BASKET" && side === "buy" ? assets.map((currency, index) => ({ currency, amount: index ? "0" : "200" }))
        : [{ currency: side === "buy" ? counter : config.contracts.core!, amount: "200" }],
      outputCurrency: side === "buy" ? config.contracts.core! : counter };
    const observed: QuoteObservation = { path: "/api/quotes/universal-exact-input", request, status: 200, terminal: { type: "complete", value: {} } };
    assert.equal(uiQuoteReady([observed], scenario, config, true), true);
    assert.equal(uiQuoteReady([observed], scenario, config, false), false);
    assert.equal(uiQuoteReady([{ ...observed, terminal: undefined }], scenario, config, true), false);
    assert.equal(uiQuoteReady([{ ...observed, request: { ...request, intent: 99 } }], scenario, config, true), false);
    assert.equal(uiQuoteReady([observed, { ...observed, terminal: undefined }], scenario, config, true), false);
    const diagnostics = createUiQuoteDiagnostics(scenario, config);
    assert.equal(diagnostics.request(observed.path, request, attempt), true);
    assert.equal(diagnostics.diagnostic({ operation: "quote", attemptId: attempt, outcome: "failed", errorClassification: "quote-timeout" }), true);
    assert.equal(diagnostics.snapshot().reason, "quote-timeout");
    const value = { strategy: "universal", operation: "executeExactInput", plan: { ...request,
      recipient: config.contracts.helpers!, deadline: "2000000000", minimumOutput: "0", body: "0x" } } as unknown as UniversalExactInputQuote;
    const retained = privateSandboxSelection([{ ...observed, terminal: { type: "complete", value } },
      { ...observed, terminal: { type: "complete", value }, request: { ...request, intent: 99 } }],
    { ...scenario, size: "small", nominalUsd: "1", valuationId: "fixture" } as MatrixScenario, config);
    assert.deepEqual(retained?.universalQuote, value);
    retained!.universalQuote!.plan.minimumOutput = "77";
    assert.notEqual(value.plan.minimumOutput, "77");
  });
}
