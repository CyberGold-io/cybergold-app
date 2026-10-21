import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, parseAbiParameters, zeroAddress, zeroHash } from "viem";
import { browserQuoteMatcher } from "../../tests/trading/browserQuoteObservation.ts";
import { applyUniversalExactInputQuote, resultFor, tokenRequest } from "../../tests/trading/regression.ts";
import { tradeScenarios, type Scenario } from "../../tests/trading/scenarios.ts";
import { protocolConfigurationFixture as config, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";
import type { QuoteObservation } from "../../tests/trading/quoteObservation.ts";
import type { UniversalExactInputQuote, UniversalExactInputRequest } from "./universalExactInput.ts";
import { installQuoteObservation } from "../../tests/trading/quoteObservation.ts";

const assets = [tokenAddresses.PAXG, tokenAddresses.XAUT];
const observation = (request: Record<string, unknown>, path = "/api/quotes/universal-exact-input"): QuoteObservation => ({ path, request, status: 200 });
const scenarioFor = (asset: Scenario["asset"], side: Scenario["side"], inputMode: Scenario["inputMode"] = "exact-in") =>
  tradeScenarios.find(row => row.asset === asset && row.side === side && row.inputMode === inputMode && row.requestedStrategy === "core")!;

for (const asset of ["PAXG", "USDC", "ETH"] as const) for (const side of ["buy", "sell"] as const) {
  test(`browser observer matches actual ${asset} ${side} exact-input wire terms and excludes obsolete/wrong intents`, () => {
    const scenario = scenarioFor(asset, side), scalar = tokenRequest(scenario, config, config.contracts.helpers!);
    const counter = asset === "ETH" ? zeroAddress : scalar.counterToken;
    const request = { intent: side === "buy" ? 0 : 1, inputs: [{ currency: side === "buy" ? counter : config.contracts.core!, amount: scalar.amount }],
      outputCurrency: side === "buy" ? config.contracts.core! : counter };
    const matches = browserQuoteMatcher(scenario, config, "0", []);
    assert.equal(matches(observation(request)), true);
    assert.equal(matches(observation({ ...request, intent: 2 })), false);
    assert.equal(matches(observation({ ...request, outputCurrency: tokenAddresses.USDT })), false);
    assert.equal(matches(observation({ ...request, inputs: [{ ...request.inputs[0], amount: "0" }] })), false);
    assert.equal(matches(observation({ ...request, inputs: [{ ...request.inputs[0], amount: String(BigInt(scalar.amount) + 1n) }] })), false);
    assert.equal(matches(observation({ ...request, inputs: [{ ...request.inputs[0], currency: tokenAddresses.USDT }] })), false);
    assert.equal(matches(observation(request, "/api/quotes/trade/stream")), false);
  });
}

test("basket browser matcher follows its complete declared vector, including zero components", () => {
  const scenario = { ...scenarioFor("BASKET", "buy"), basketAmounts: ["200", "0"], basketAssets: [...assets] };
  const inputs = assets.map((currency, index) => ({ currency, amount: scenario.basketAmounts[index] }));
  const request = { intent: 2, inputs, outputCurrency: config.contracts.core! };
  const matches = browserQuoteMatcher(scenario, config, "200", assets);
  assert.equal(matches(observation(request)), true);
  assert.equal(matches(observation({ ...request, inputs: [...inputs].reverse() })), false);
  assert.equal(matches(observation({ ...request, inputs: inputs.slice(0, 1) })), false);
  assert.equal(matches(observation({ ...request, inputs: [inputs[0], { ...inputs[1], amount: "1" }] })), false);
  const driver = browserQuoteMatcher(scenarioFor("BASKET", "buy"), config, "200", assets);
  assert.equal(driver(observation(request)), true);
  assert.equal(driver(observation({ ...request, inputs: [{ ...inputs[0], amount: "0" }, inputs[1]] })), false);
});

test("basket redemption matches its CYGLD input and keeps the legacy exact-output matcher", () => {
  const scenario = scenarioFor("BASKET", "sell"), request = { intent: 3, inputs: [{ currency: config.contracts.core!, amount: "300" }], outputCurrency: zeroAddress };
  assert.equal(browserQuoteMatcher(scenario, config, "300", assets)(observation(request)), true);
  assert.equal(browserQuoteMatcher(scenario, config, "301", assets)(observation(request)), false);
  const exactOut = scenarioFor("PAXG", "buy", "exact-out"), oldRequest = tokenRequest(exactOut, config, config.contracts.helpers!);
  const matches = browserQuoteMatcher(exactOut, config, "0", []);
  assert.equal(matches(observation(oldRequest, "/api/quotes/trade/stream")), true);
  assert.equal(matches(observation(oldRequest)), false);
});

function quote(request: UniversalExactInputRequest, intent = request.intent): UniversalExactInputQuote {
  return { strategy: "universal", operation: "executeExactInput", routeFamily: "mixed", settlementPolicy: "protocol-retained-input",
    inputs: [...request.inputs], plan: { ...request, inputs: [...request.inputs], intent, minimumOutput: "39", body: "0x" }, quotedInput: request.inputs[0].amount,
    inputMaximum: request.inputs[0].amount, quotedOutput: "40", outputMinimum: "39",
    fees: { coreProtocolFeeCygld: "1", coreHelpersFeeCygld: "2", marketFeeCygld: "3" },
    estimatedRecipientOutputs: [{ kind: 0, token: request.outputCurrency, id: "0", amount: "40" }],
    estimatedRetainedInputCharges: [], recoveryShares: [], deployment: { helpers: config.contracts.helpers!, adapter: config.contracts.uniswapAdapter!, encoding: "uniswap-routing-v1" },
    context: { chainId: 31337, blockNumber: "1", blockHash: zeroHash, observedAt: "2026-10-21" }, planDescription: {},
    retentionDisclosure: { custodian: config.contracts.helpers!, beneficiary: "helpers-owner-at-settlement" },
    searchCoverage: { coreSharesPercent: [0,25,50,75,100], orders: ["core-first", "market-first"], maxCoreInvocations: 1, maxAmmHops: 3, scope: "selected-inventory" } };
}

test("a JSON-only universal response supplies checked bounds, fees, exact inputs and route evidence without invented provider winners", async () => {
  const scenario = scenarioFor("ETH", "buy"), amount = tokenRequest(scenario, config, config.contracts.helpers!).amount;
  const request: UniversalExactInputRequest = { intent: 0, inputs: [{ currency: zeroAddress, amount }], outputCurrency: config.contracts.core!,
    recipient: config.contracts.helpers!, deadline: "2000000000", slippageBps: 100 };
  let calls = 0;
  const scope = { location: { href: "https://fixture.invalid/en" }, fetch: async () => { calls++; return Response.json(quote(request)); } } as unknown as NonNullable<Parameters<typeof installQuoteObservation>[0]>;
  installQuoteObservation(scope);
  await scope.fetch("/api/quotes/universal-exact-input", { method: "POST", body: JSON.stringify(request) });
  await new Promise(resolve => setImmediate(resolve));
  const observed = scope.__cybergoldTradeObservations!.find(browserQuoteMatcher(scenario, config, "0", []))!;
  const result = resultFor(scenario, "browser");
  applyUniversalExactInputQuote(result, observed.terminal!.value as UniversalExactInputQuote, request.inputs);
  assert.equal(calls, 1); assert.equal(result.quotedOperation, "executeExactInput"); assert.equal(result.actualStrategy, "mixed");
  assert.equal(result.selectedProvider, "universal"); assert.equal(result.providers, undefined);
  assert.deepEqual(result.bounds, { inputMaximum: amount, outputMinimum: "39", protocolFeeCygld: "1", helperFeeCygld: "2", marketFeeCygld: "3" });
  assert.deepEqual(result.quoteTerms!.inputSpent, [{ asset: zeroAddress, amount }]);
  assert.match(result.planDigest!, /^[0-9a-f]{64}$/);
  assert.equal(result.selectedPlan!.provider, "universal");
  assert.throws(() => applyUniversalExactInputQuote(result, quote(request), [{ currency: zeroAddress, amount: "1" }]), /universal-exact-input-mismatch/);
});

test("universal basket reporting preserves the full acquisition and complete decoded output minimum vector", () => {
  const request: UniversalExactInputRequest = { intent: 2, inputs: assets.map((currency, i) => ({ currency, amount: i ? "0" : "200" })),
    outputCurrency: config.contracts.core!, recipient: config.contracts.helpers!, deadline: "2000000000", slippageBps: 100 };
  const issued = resultFor(scenarioFor("BASKET", "buy"), "browser");
  applyUniversalExactInputQuote(issued, quote(request), request.inputs);
  assert.deepEqual(issued.bounds!.inputMaximum, ["200", "0"]);
  const redemption = { ...request, intent: 3 as const, inputs: [{ currency: config.contracts.core!, amount: "300" }], outputCurrency: zeroAddress };
  const value = quote(redemption);
  value.plan.body = encodeAbiParameters(parseAbiParameters("((uint8 kind,address token,uint256 id,uint256 minimumAmount)[] expectedOutputs)"),
    [{ expectedOutputs: [...assets.map((token, i) => ({ kind: 0, token, id: 0n, minimumAmount: BigInt(i + 1) })), { kind: 1, token: tokenAddresses.CYGLD, id: 7n, minimumAmount: 3n }] }]);
  value.outputMinimum = value.plan.minimumOutput = "0";
  const redeemed = resultFor(scenarioFor("BASKET", "sell"), "browser");
  applyUniversalExactInputQuote(redeemed, value, redemption.inputs);
  assert.deepEqual(redeemed.bounds!.outputMinimum, ["1", "2", "3"]);
});
