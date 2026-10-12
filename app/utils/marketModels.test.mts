import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { predictMarketModel, fetchMarketModel } from "./marketModels.ts";
import { marketFixtureQuote, marketFixtureRequest } from "../../tests/fixtures/market-quote.mts";
import { marketModelFamily, type MarketQuoteModelPacket } from "./marketQuote.ts";
import { fetchTradeModel, receiveTradeModel, type TradeModelRequest, type TradeQuoteModelPacket } from "./tradeQuote.ts";
import { clearQuoteModels, getMarketQuoteModel } from "./quoteModelStore.ts";

const model: MarketQuoteModelPacket = { namespace: "market", family: marketModelFamily(marketFixtureRequest),
  intent: { side: "sell", mode: "exact-in", counterToken: marketFixtureRequest.counterToken, adapter: marketFixtureRequest.adapter },
  cygld: marketFixtureQuote.tokenIn, feeRatePpm: 1000,
  routes: [{ route: marketFixtureQuote.plan.route, amountIn: "0", amountOut: "0", points: [],
    exchangeRate: { numerator: "1", denominator: "1" }, feeRetention: { numerator: "1", denominator: "1" },
    localImpact: { numerator: "0", denominator: "1" } }] };

test("cold market baselines compose all four ceiling-fee cases without quote history", () => {
  const expectations = { "buy:exact-in": 1000n, "buy:exact-out": 1004n,
    "sell:exact-in": 1000n, "sell:exact-out": 1004n };
  for (const side of ["buy", "sell"] as const) for (const mode of ["exact-in", "exact-out"] as const) {
    const packet = { ...model, intent: { ...model.intent, side, mode } };
    assert.equal(predictMarketModel(packet, 1002n), expectations[`${side}:${mode}`]);
  }
  const changedPolicy = { ...model, feeRatePpm: 2000, intent: { ...model.intent, side: "buy" as const } };
  assert.equal(predictMarketModel(changedPolicy, 1000n), 998n, "Backend policy facts determine displayed fee economics");
  assert.equal(predictMarketModel(model, 0n), undefined);
  assert.equal(predictMarketModel({ ...model, routes: [] }, 1000n), undefined);
});

test("baseline acquisition needs neither a wallet, amount nor a previous market quote", async () => {
  const request = model.intent;
  const value = await fetchMarketModel(request, new AbortController().signal,
    (async (url, options) => {
      assert.equal(url, "/api/quotes/market/model"); assert.deepEqual(JSON.parse(String(options?.body)), request);
      assert.equal(options?.cache, "no-store"); return Response.json(model);
    }) as typeof fetch);
  assert.deepEqual(value, model);
});

test("the unified hook retains a Backend-resolved family and uses only its ranked estimate without bootstrap adapter selection", async () => {
  const request: TradeModelRequest = { side: "sell", mode: "exact-in", counterToken: model.intent.counterToken,
    native: false, amount: "1002", slippageBps: 100 };
  const packet: TradeQuoteModelPacket = { namespace: "trade", intent: request,
    models: [{ strategy: "market", value: model }], estimate: { strategy: "market", amount: "42" } };
  const identity = "configured-roots-adapter-unavailable";
  let observedKey: unknown[] = [], acquire!: (input: { signal: AbortSignal }) => Promise<TradeQuoteModelPacket>;
  const dependencies: Record<string, unknown> = {
    react: { useEffect: (effect: () => void) => effect() },
    "@tanstack/react-query": { useQuery: (options: { queryKey: unknown[]; queryFn: typeof acquire }) => {
      observedKey = options.queryKey; acquire = options.queryFn; return { data: packet };
    }, useQueryClient: () => ({}) },
    "@/app/context/protocolConfigurationContext": { useProtocolConfiguration: () => ({ identity }) },
    "@/app/config/chain": { targetChainId: 1 },
    "@/app/context/sandboxForkContext": { useSandboxForkGeneration: () => null },
    "@/app/context/chainHeadContext": { useQuoteCacheScope: () => "1:head" },
    "@/app/hooks/usePageVisible": { usePageVisible: () => true },
    "@/app/utils/tradeQuote": { receiveTradeModel, fetchTradeModel: (input: TradeModelRequest, signal: AbortSignal) =>
      fetchTradeModel(input, signal, (async (url, options) => {
        assert.equal(url, "/api/quotes/trade/model"); assert.deepEqual(JSON.parse(String(options?.body)), request);
        assert.equal(options?.signal, signal); return Response.json(packet);
      }) as typeof fetch) },
  };
  const source = readFileSync(new URL("../hooks/flows/quotes/useTradeModel.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: { useTradeModel?: (input: TradeModelRequest, enabled: boolean) => bigint } = {};
  runInNewContext(output, { exports, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key]; } });
  clearQuoteModels();
  try {
    assert.equal(predictMarketModel(model, 1002n), 1000n, "the family arithmetic differs from Backend ranking");
    assert.equal(exports.useTradeModel!(request, true), 42n, "the App does not rank or reconstruct family estimates");
    assert.equal(getMarketQuoteModel(model.family, identity), model, "retain the concrete producer adapter family");
    assert.equal(getMarketQuoteModel(model.family, "other-deployment"), undefined);
    assert.deepEqual(observedKey[4], request, "the unified request requires no caller adapter");
    assert.equal(observedKey[5], identity);
    assert.deepEqual(await acquire({ signal: new AbortController().signal }), packet);
  } finally { clearQuoteModels(); }
});
