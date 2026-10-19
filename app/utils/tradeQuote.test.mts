import assert from "node:assert/strict";
import test from "node:test";
import { submitTradeQuote } from "./tradeExecution.ts";
import { captureTradeQuote, fetchTradeQuote, retainedTradePlan, tradeQuoteResult, withTradeProviderEvent } from "./tradeQuote.ts";
import { coreTrade, marketTrade, tradeCore, tradeCounter, tradeHelpers, tradeOwner } from "../../tests/fixtures/trade-quote.mts";

function executors() {
  const calls: { family: string; args: unknown[] }[] = [];
  const handlers: Parameters<typeof submitTradeQuote>[2] = {
    tokenPurchase: async (...args) => { calls.push({ family: "issue", args }); return "0x01"; },
    redemption: async (...args) => { calls.push({ family: "redeem", args }); return "0x02"; },
    market: async (...args) => { calls.push({ family: "market", args }); return "0x03"; },
  };
  return { calls, handlers };
}
const deployment = { core: tradeCore, helpers: tradeHelpers };
const params = { owner: tradeOwner, recipient: tradeOwner };

test("losing-provider updates refresh evidence without replacing the selected economic tuple", () => {
  const winner = coreTrade(), alternate = marketTrade();
  const observed = withTradeProviderEvent(winner, { type: "provider-qualified", strategy: "market", value: alternate });
  assert.equal(observed.strategy, "core");
  assert.equal(observed.providerQuote, winner.providerQuote);
  assert.equal(observed.providerRequest, winner.providerRequest);
  assert.equal(observed.quotedOutput, winner.quotedOutput);
  alternate.quotedInput = "999";
  assert.notEqual(observed.providerCandidates?.market?.quotedInput, "999");
  const terminal = withTradeProviderEvent(observed, { type: "provider-assessment", strategy: "market", value: { availability: "qualified", searchOutcome: "timeout" } });
  assert.equal(terminal.providerAssessments?.market.availability, "qualified");
  assert.equal(terminal.providerAssessments?.market.searchOutcome, "timeout");
  assert.ok(terminal.providerCandidates?.market);
  const invalidated = withTradeProviderEvent(terminal, { type: "provider-assessment", strategy: "market", value: { availability: "unavailable", searchOutcome: "error" } });
  assert.equal(invalidated.providerCandidates?.market, undefined);
  assert.equal(invalidated.providerQuote, winner.providerQuote);
  assert.ok(terminal.providerCandidates?.market);
});

for (const side of ["buy", "sell"] as const) for (const mode of ["exact-in", "exact-out"] as const) {
  test(`${side}/${mode}: dispatch prepares only the selected market executor`, async () => {
    const value = executors(), quote = { ...tradeQuoteResult(marketTrade(side, mode)), deployment };
    await submitTradeQuote(quote, params, value.handlers);
    assert.deepEqual(value.calls.map(row => row.family), ["market"]);
    const observed = value.calls[0].args[0] as { deployment: typeof deployment; params: { data: string } };
    assert.deepEqual(observed.deployment, deployment);
    assert.equal(observed.params.data, quote.value.providerQuote.params.data);
  });
  test(`${side}/${mode}: Core execution retains its actual funded lot and output protection`, async () => {
    const value = executors(), quote = { ...tradeQuoteResult(coreTrade(side, mode)), deployment };
    await submitTradeQuote(quote, params, value.handlers);
    assert.deepEqual(value.calls.map(row => row.family), [side === "buy" ? "issue" : "redeem"]);
    const observed = value.calls[0].args[0] as Record<string, unknown>;
    assert.deepEqual(observed.deployment, deployment);
    if (side === "buy") { assert.equal(observed.maximumInputAmount, 30n); assert.equal(observed.netCygldOut, 25n); }
    else { assert.equal(observed.grossCygldIn, 20n); assert.equal((observed.request as Record<string, unknown>).minimumAmountOut, 24n); }
  });
}

test("native Core purchase retains WETH when the existing fallback funds through ERC20", async () => {
  const quote = coreTrade(); quote.providerRequest.native = true;
  quote.providerRequest.token = `0x${"00".repeat(20)}`; quote.providerRequest.quoteToken = tradeCounter;
  const value = executors();
  await submitTradeQuote(tradeQuoteResult(quote), { ...params, inputFundingMode: "erc20" }, value.handlers);
  assert.equal((value.calls[0].args[0] as Record<string, unknown>).inputToken, tradeCounter);
  assert.equal((value.calls[0].args[0] as Record<string, unknown>).nativeInput, false);
});

test("capture preserves family, calldata, fees and deployment when a later result changes", () => {
  const source = { ...tradeQuoteResult(marketTrade()), deployment: { ...deployment } }, captured = captureTradeQuote(source);
  source.value.providerQuote.params.data = "0x9999"; source.value.providerQuote.fee.amount = "9999";
  Object.assign(source.deployment, { helpers: tradeOwner });
  assert.notEqual(captured.value.providerQuote.params.data, source.value.providerQuote.params.data);
  assert.notEqual(captured.value.providerQuote.fee.amount, source.value.providerQuote.fee.amount);
  assert.equal(captured.deployment?.helpers, tradeHelpers);
  assert.equal(retainedTradePlan(captured).strategy, "market");
});

test("normalized economics remain lossless and never use Core provisional display", () => {
  const value = coreTrade("sell", "exact-out"); value.quotedInput = String(2n ** 100n);
  const result = tradeQuoteResult(value);
  assert.equal(result.quotedInput, 2n ** 100n); assert.equal(result.quotedOutput, 25n);
  assert.notEqual(result.quotedInput, BigInt(value.providerQuote.expectedInputAmount!));
});

test("unified stream publishes a winner before a competitor error and the terminal result", async () => {
  const quote = marketTrade(), events: string[] = [];
  const response = new ReadableStream<Uint8Array>({ start(controller) {
    for (const event of [{ type: "qualified", value: quote }, { type: "provider-error", strategy: "core", code: "issuance-cap-exceeded" }, { type: "complete", value: quote }])
      controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
    controller.close();
  } });
  const result = await fetchTradeQuote({ side: "sell", mode: "exact-in", counterToken: tradeCounter, native: false,
    amount: "10", recipient: tradeOwner, deadline: "1900000000" }, new AbortController().signal,
  event => events.push(event.type), (async (path, init) => {
    assert.equal(path, "/api/quotes/trade/stream"); assert.equal(init?.cache, "no-store");
    assert.equal("orderedAssets" in JSON.parse(String(init?.body)), false);
    return new Response(response, { headers: { "Content-Type": "application/x-ndjson" } });
  }) as typeof fetch);
  assert.deepEqual(events, ["qualified", "provider-error"]); assert.equal(result.value.strategy, "market");
});
