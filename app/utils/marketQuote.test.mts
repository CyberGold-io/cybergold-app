import assert from "node:assert/strict";
import test from "node:test";
import { fetchMarketQuote, marketModelFamily, marketQuoteResult, marketRouteProtocols,
  preferMarketQuote, type MarketQuoteModelPacket } from "./marketQuote.ts";
import { clearQuoteModels, getMarketQuoteModel, getProtocolModel, getQuoteModel,
  receiveMarketQuoteModel, receiveQuoteModel } from "./quoteModelStore.ts";
import { modelFamily, type QuoteModelPacket } from "./quoteModels.ts";

import { address, context, marketFixtureQuote, marketFixtureRequest } from "../../tests/fixtures/market-quote.mts";

test("market preserves explicit routed input, dust, fee and complete protocol plan without Core conversion", () => {
  const wire = structuredClone(marketFixtureQuote), wide = 2n ** 220n;
  wire.params.amount = String(wide + 2n); wire.params.routedInput = String(wide);
  const result = marketQuoteResult(wire);
  assert.equal(result.params.amount, wide + 2n); assert.equal(result.params.routedInput, wide);
  assert.equal(result.params.feeCygld, 1n); assert.equal(result.refundDust, 1n);
  assert.equal(result.value.plan, wire.plan); assert.deepEqual(marketRouteProtocols(wire.plan.route), ["v4"]);
  assert.equal(result.params.data, "0xab");
});

test("market completion cannot promote an estimate or hide a worse retained net quote", async () => {
  const observed: unknown[] = [];
  const result = await fetchMarketQuote(marketFixtureRequest, new AbortController().signal, event => observed.push(event),
    (async (url, options) => {
      assert.equal(url, "/api/quotes/market/stream");
      assert.deepEqual(JSON.parse(String(options?.body)), marketFixtureRequest);
      return new Response([JSON.stringify({ type: "estimate", amount: "1900" }),
        JSON.stringify({ type: "qualified", value: marketFixtureQuote }),
        JSON.stringify({ type: "complete", value: marketFixtureQuote })].join("\n"));
    }) as typeof fetch);
  assert.equal(observed.length, 2); assert.equal(result.netOutput, 2000n);
  assert.equal(preferMarketQuote(result, { ...result, netOutput: 1999n }), result);
  assert.equal(preferMarketQuote(result, { ...result, totalInput: 1002n }), result);
  const better = { ...result, netOutput: 2001n };
  assert.equal(preferMarketQuote(result, better), better);
});

test("market-only packets do not erase Core models or the current basket snapshot", () => {
  clearQuoteModels();
  const core: QuoteModelPacket = { revision: 1, routes: [], whole: [],
    intent: { mode: "issue-exact-in", token: address, quoteToken: address, native: false, adapter: address,
      amount: "1002", targets: [], orderedAssets: [address], slippageBps: 100 },
    protocol: { context, state: { assets: [address], weights: ["1000000"], conversions: ["1000000000000000000"],
      available: ["100"], recoveryShares: [], recoveryValues: [], supply: "100", maxSupply: "1000", effectiveCap: "1000",
      issueFee: "0", helperFee: "0", redeemFee: "0", descriptors: [{ kind: 0, token: address, id: "0" }] } } };
  receiveQuoteModel(core);
  const market: MarketQuoteModelPacket = { namespace: "market", family: marketModelFamily(marketFixtureRequest),
    intent: { side: "sell", mode: "exact-in", counterToken: address, adapter: address },
    cygld: marketFixtureQuote.tokenIn, feeRatePpm: 1000,
    context, routes: [{ route: marketFixtureQuote.plan.route, amountIn: "1000", amountOut: "2000", points: [] }] };
  receiveMarketQuoteModel(market);
  assert.equal(getMarketQuoteModel(market.family), market);
  assert.equal(getQuoteModel(modelFamily(core.intent)), core); assert.equal(getProtocolModel(), core.protocol);
  assert.notEqual(marketModelFamily(marketFixtureRequest), marketModelFamily({ ...marketFixtureRequest, side: "buy" }));
  assert.notEqual(marketModelFamily(marketFixtureRequest), marketModelFamily({ ...marketFixtureRequest, mode: "exact-out" }));
  clearQuoteModels(); assert.equal(getMarketQuoteModel(market.family), undefined);
});
