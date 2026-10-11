import assert from "node:assert/strict";
import test from "node:test";
import { fetchProtocolFacts } from "./protocolFacts.ts";
import { fetchBasketPreview } from "./basketPreview.ts";
import { clearQuoteModels, receiveQuoteModel, getQuoteModel, receiveMarketQuoteModel, getMarketQuoteModel,
  getProtocolModel, receiveProtocolModel } from "./quoteModelStore.ts";
import { modelFamily, type QuoteModelPacket } from "./quoteModels.ts";
import { marketFixtureQuote, marketFixtureRequest } from "../../tests/fixtures/market-quote.mts";
import { marketModelFamily, type MarketQuoteModelPacket } from "./marketQuote.ts";
import { protocolAddresses } from "../../tests/fixtures/protocol-configuration.ts";

test("request association retains a Backend-resolved adapter packet under the omitted-adapter model lookup", () => {
  clearQuoteModels();
  const packet: QuoteModelPacket = { revision: 1, intent: { mode: "issue-exact-in", token: protocolAddresses.core,
    quoteToken: protocolAddresses.core, native: false, adapter: protocolAddresses.adapter, amount: "100", slippageBps: 100, orderedAssets: [], targets: [] },
    protocol: null, routes: [], whole: [] };
  const request = { ...packet.intent, adapter: undefined };
  const key = modelFamily(request);
  receiveQuoteModel(packet, key);
  assert.equal(getQuoteModel(key), packet);
  assert.equal(getQuoteModel(key)?.intent.adapter, protocolAddresses.adapter);
  assert.notEqual(key, modelFamily(packet.intent));
  clearQuoteModels(); assert.equal(getQuoteModel(key), undefined, "existing configuration/fork retirement removes the association");
});

test("Core, market and protocol model banks isolate configuration changes and late old-request frames", () => {
  clearQuoteModels();
  const protocol = { context: marketFixtureQuote.context, state: { assets: [], descriptors: [], weights: [], conversions: [], available: [],
    recoveryShares: [], recoveryValues: [], supply: "0", maxSupply: "100", effectiveCap: "100", issueFee: "0", helperFee: "0", redeemFee: "0" } };
  const packet: QuoteModelPacket = { revision: 1, intent: { mode: "issue-exact-in", token: protocolAddresses.core,
    quoteToken: protocolAddresses.core, native: false, adapter: protocolAddresses.adapter, amount: "100", slippageBps: 100, orderedAssets: [], targets: [] },
    protocol, routes: [], whole: [] };
  const market: MarketQuoteModelPacket = { namespace: "market", family: marketModelFamily(marketFixtureRequest),
    intent: { side: "sell", mode: "exact-in", counterToken: marketFixtureRequest.counterToken, adapter: marketFixtureRequest.adapter },
    cygld: marketFixtureQuote.tokenIn, feeRatePpm: 1000, routes: [] };
  const family = modelFamily(packet.intent), oldScope = "old-Core-Helpers-generation", currentScope = "new-Core-Helpers-generation";
  receiveQuoteModel(packet, family, oldScope); receiveMarketQuoteModel(market, oldScope);
  assert.equal(getQuoteModel(family, currentScope), undefined);
  assert.equal(getMarketQuoteModel(market.family, currentScope), undefined);
  assert.equal(getProtocolModel(currentScope), undefined);
  // A response started before refresh keeps its captured scope even after retirement.
  clearQuoteModels();
  receiveQuoteModel(packet, family, oldScope); receiveMarketQuoteModel(market, oldScope); receiveProtocolModel(protocol, oldScope);
  assert.equal(getQuoteModel(family, currentScope), undefined);
  assert.equal(getMarketQuoteModel(market.family, currentScope), undefined);
  assert.equal(getProtocolModel(currentScope), undefined);
  receiveQuoteModel({ ...packet, revision: 2 }, family, currentScope);
  receiveMarketQuoteModel({ ...market, feeRatePpm: 2000 }, currentScope);
  assert.equal(getQuoteModel(family, currentScope)?.revision, 2);
  assert.equal(getMarketQuoteModel(market.family, currentScope)?.feeRatePpm, 2000);
  receiveProtocolModel(null, oldScope);
  assert.equal(getProtocolModel(currentScope), protocol);
  clearQuoteModels();
});

test("late actual facts and basket responses keep their captured model namespace after configuration refresh", async () => {
  clearQuoteModels();
  const oldScope = "old-Core-Helpers", currentScope = "new-Core-Helpers";
  const protocol = { context: marketFixtureQuote.context, state: { assets: [], descriptors: [], weights: [], conversions: [], available: [],
    recoveryShares: [], recoveryValues: [], supply: "0", maxSupply: "100", effectiveCap: "100", issueFee: "0", helperFee: "0", redeemFee: "0" } };
  const current = { ...protocol, state: { ...protocol.state, helperFee: "1000" } };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const facts = fetchProtocolFacts(undefined, (async () => { await pending;
    return Response.json({ basketModel: protocol }); }) as typeof fetch, oldScope);
  const basket = fetchBasketPreview({ mode: "issue-exact-in", maximumAmountsIn: [] }, undefined,
    (async () => { await pending; return Response.json({ mode: "issue-exact-in", basketModel: protocol,
      result: { fees: { protocolFeeCygld: "0", helperFeeCygld: "0" }, netCygldOut: "1", amountsInExact: [], orderedCoreAssets: [] } }); }) as typeof fetch, oldScope);
  receiveProtocolModel(current, currentScope);
  release(); await Promise.all([facts, basket]);
  assert.equal(getProtocolModel(currentScope), current);
  assert.deepEqual(getProtocolModel(oldScope), protocol);
  clearQuoteModels();
});
