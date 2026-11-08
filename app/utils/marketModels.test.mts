import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { QueryClient } from "@tanstack/react-query";
import { fetchMarketModel } from "../../tests/fixtures/legacy-market-model.mts";
import { marketFixtureQuote, marketFixtureRequest } from "../../tests/fixtures/market-quote.mts";
import { marketModelFamily, type MarketQuoteModelPacket } from "./marketQuote.ts";
import { fetchTradeModel, receiveTradeModel, type TradeModelRequest, type TradeQuoteModelPacket } from "./tradeQuote.ts";
import { clearQuoteModels, getMarketQuoteModel, getTradeBudgetRange, subscribeQuoteModels, tradeDisplayModelScope } from "./quoteModelStore.ts";
import { economicQuoteKey, type EconomicQuote } from "./economicQuotes.ts";

const model: MarketQuoteModelPacket = { namespace: "market", family: marketModelFamily(marketFixtureRequest),
  intent: { side: "sell", mode: "exact-in", counterToken: marketFixtureRequest.counterToken, adapter: marketFixtureRequest.adapter },
  cygld: marketFixtureQuote.tokenIn, feeRatePpm: 1000,
  routes: [{ route: marketFixtureQuote.plan.route, amountIn: "0", amountOut: "0", points: [],
    exchangeRate: { numerator: "1", denominator: "1" }, feeRetention: { numerator: "1", denominator: "1" },
    localImpact: { numerator: "0", denominator: "1" } }] };

test("baseline acquisition needs neither a wallet, amount nor a previous market quote", async () => {
  const request = model.intent;
  const value = await fetchMarketModel(request, new AbortController().signal,
    (async (url, options) => {
      assert.equal(url, "/api/quotes/market/model"); assert.deepEqual(JSON.parse(String(options?.body)), request);
      assert.equal(options?.cache, "no-store"); return Response.json(model);
    }) as typeof fetch);
  assert.deepEqual(value, model);
});

test("the unified hook uses only Backend estimate packets and retains producer model families", async () => {
  const request: TradeModelRequest = { side: "sell", mode: "exact-in", counterToken: model.intent.counterToken,
    native: false, amount: "1002", slippageBps: 100 };
  const packet: TradeQuoteModelPacket = { namespace: "trade", intent: request,
    models: [{ strategy: "market", value: model }], estimate: { strategy: "market", amount: "42" } };
  let identity = "configured-roots-adapter-unavailable", cacheScope = "1:head", generation: string | null = null;
  const client = new QueryClient();
  const subscriptions: ((changed: () => void) => () => void)[] = [];
  let observedKey: unknown[] = [], acquire!: (input: { signal: AbortSignal }) => Promise<TradeQuoteModelPacket>;
  const dependencies: Record<string, unknown> = {
    react: { useEffect: (effect: () => void) => effect(), useCallback: (callback: () => unknown) => callback,
      useSyncExternalStore: (subscribe: (changed: () => void) => () => void, snapshot: () => unknown) => { subscriptions.push(subscribe); return snapshot(); } },
    "@tanstack/react-query": { useQuery: (options: { queryKey: unknown[]; queryFn: typeof acquire }) => {
      observedKey = options.queryKey; acquire = options.queryFn; return { data: packet };
    }, useQueryClient: () => client },
    "@/app/context/protocolConfigurationContext": { useProtocolConfiguration: () => ({ identity, addresses: { core: model.cygld } }) },
    "@/app/config/chain": { targetChainId: 1 },
    "@/app/context/sandboxForkContext": { useSandboxForkGeneration: () => generation },
    "@/app/context/chainHeadContext": { useQuoteCacheScope: () => cacheScope },
    "@/app/hooks/usePageVisible": { usePageVisible: () => true },
    "@/app/utils/quoteModelStore": { getTradeBudgetRange, subscribeQuoteModels, tradeDisplayModelScope },
    "@/app/utils/tradeQuote": { receiveTradeModel, fetchTradeModel: (input: TradeModelRequest, signal: AbortSignal) =>
      fetchTradeModel(input, signal, (async (url, options) => {
        assert.equal(url, "/api/economic-estimates"); assert.deepEqual(JSON.parse(String(options?.body)), request);
        assert.equal(options?.signal, signal); return Response.json(packet);
      }) as typeof fetch) },
  };
  const source = readFileSync(new URL("../hooks/flows/quotes/useTradeModel.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: { useTradeModel?: (input: TradeModelRequest, enabled: boolean) => {
    quotedOutput: bigint; quotedInput?: bigint; inputMaximum?: bigint; fullBudget?: true;
    fees?: { protocolFeeCygld: bigint; helperFeeCygld: bigint; marketFeeCygld: bigint };
  } | undefined } = {};
  runInNewContext(output, { exports, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key]; } });
  clearQuoteModels();
  try {
    assert.equal(exports.useTradeModel!(request, true)?.quotedOutput, 42n, "a cache miss retains the Backend-ranked estimate");
    assert.equal(subscriptions.length, 1, "only Backend model packets are subscribed; no quote-cache scans");
    assert.equal(getMarketQuoteModel(model.family, identity), model, "retain the concrete producer adapter family");
    assert.equal(getMarketQuoteModel(model.family, "other-deployment"), undefined);
    assert.deepEqual(observedKey[4], request, "the unified request requires no caller adapter");
    assert.equal(observedKey[5], identity);
    assert.deepEqual(await acquire({ signal: new AbortController().signal }), packet);
    const unchanged = JSON.stringify(observedKey);
    cacheScope = "1:next-head"; exports.useTradeModel!(request, true);
    assert.equal(JSON.stringify(observedKey), unchanged, "advisory exact-in arithmetic has no head identity");
    generation = "replacement-fork"; exports.useTradeModel!(request, true);
    assert.equal(observedKey[2], generation);
    generation = null; identity = "replacement-configuration"; exports.useTradeModel!(request, true);
    assert.equal(observedKey[5], identity);
    identity = "configured-roots-adapter-unavailable";
    const legacy = { ...request, mode: "exact-out" as const }; exports.useTradeModel!(legacy, true);
    const legacyKey = JSON.stringify(observedKey);
    cacheScope = "1:another-head"; exports.useTradeModel!(legacy, true);
    assert.notEqual(JSON.stringify(observedKey), legacyKey, "legacy exact-out head identity remains unchanged");

    const source = { request: { intent: 1, inputs: [{ currency: model.cygld, amount: "2000" }],
      outputCurrency: request.counterToken }, inputs: [{ currency: model.cygld, amount: "473" }], quotedOutput: "8355",
      reuseSample: { referenceInput: "473", netOutput: "8355", inputLimitObserved: true } } as EconomicQuote;
    client.setQueryData(economicQuoteKey(source.request, { chainId: 1, generation: null, configuration: identity }), source);
    assert.equal(exports.useTradeModel!(request, true)?.quotedOutput, 42n, "historical whole quotes cannot override the Backend estimate");
    assert.equal(exports.useTradeModel!({ ...request, amount: "300" }, true)?.quotedOutput, 42n,
      "the client does not retarget or scale historical whole quotes");
    packet.budgetRange = { minimumBudget: "900", maximumBudget: "2000", quotedInput: "800", quotedOutput: "99" };
    exports.useTradeModel!(request, true);
    const range = exports.useTradeModel!(request, true)!;
    assert.equal(range.quotedOutput, 99n); assert.equal(range.quotedInput, 800n); assert.equal(range.inputMaximum, 900n);
    delete packet.budgetRange; exports.useTradeModel!(request, true);
    packet.estimate={strategy:"universal",source:"cached-upper",amount:"77",referenceInput:"600",basis:"observed-nonretained",fullBudget:true,
      fees:{coreProtocolFeeCygld:"7",coreHelpersFeeCygld:"3",marketFeeCygld:"1"},context:marketFixtureQuote.context};
    const backendUpper=exports.useTradeModel!(request,true)!;
    assert.equal(backendUpper.quotedOutput,77n); assert.equal(backendUpper.fullBudget,true);
    assert.equal(backendUpper.quotedInput,undefined);assert.equal(backendUpper.inputMaximum,undefined);
    assert.equal(exports.useTradeModel!(request, false), undefined);
  } finally { client.clear(); clearQuoteModels(); }
});
