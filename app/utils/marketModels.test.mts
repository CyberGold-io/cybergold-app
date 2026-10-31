import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { QueryClient, notifyManager } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { fetchMarketModel } from "../../tests/fixtures/legacy-market-model.mts";
import { marketFixtureQuote, marketFixtureRequest } from "../../tests/fixtures/market-quote.mts";
import { marketModelFamily, type MarketQuoteModelPacket } from "./marketQuote.ts";
import { fetchTradeModel, receiveTradeModel, type TradeModelRequest, type TradeQuoteModelPacket } from "./tradeQuote.ts";
import { clearQuoteModels, getMarketQuoteModel, getTradeBudgetRange, subscribeQuoteModels, tradeDisplayModelScope } from "./quoteModelStore.ts";
import { arithmeticEconomicEstimate, upperEconomicQuote } from "./nearbyEconomicEstimate.ts";
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

test("the unified hook retains Backend families and prefers optional cached arithmetic without bootstrap adapter selection", async () => {
  const request: TradeModelRequest = { side: "sell", mode: "exact-in", counterToken: model.intent.counterToken,
    native: false, amount: "1002", slippageBps: 100 };
  const packet: TradeQuoteModelPacket = { namespace: "trade", intent: request,
    models: [{ strategy: "market", value: model }], estimate: { strategy: "market", amount: "42" } };
  const identity = "configured-roots-adapter-unavailable";
  const client = new QueryClient();
  let observedKey: unknown[] = [], acquire!: (input: { signal: AbortSignal }) => Promise<TradeQuoteModelPacket>;
  const dependencies: Record<string, unknown> = {
    react: { useEffect: (effect: () => void) => effect(), useCallback: (callback: () => unknown) => callback,
      useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() },
    "@tanstack/react-query": { notifyManager, useQuery: (options: { queryKey: unknown[]; queryFn: typeof acquire }) => {
      observedKey = options.queryKey; acquire = options.queryFn; return { data: packet };
    }, useQueryClient: () => client },
    viem: { zeroAddress },
    "@/app/context/protocolConfigurationContext": { useProtocolConfiguration: () => ({ identity, addresses: { core: model.cygld } }) },
    "@/app/config/chain": { targetChainId: 1 },
    "@/app/context/sandboxForkContext": { useSandboxForkGeneration: () => null },
    "@/app/context/chainHeadContext": { useQuoteCacheScope: () => "1:head" },
    "@/app/hooks/usePageVisible": { usePageVisible: () => true },
    "@/app/utils/quoteModelStore": { getTradeBudgetRange, subscribeQuoteModels, tradeDisplayModelScope },
    "@/app/utils/nearbyEconomicEstimate": { arithmeticEconomicEstimate, upperEconomicQuote },
    "@/app/utils/economicQuotes": { economicQuoteKey },
    "@/app/utils/tradeQuote": { receiveTradeModel, fetchTradeModel: (input: TradeModelRequest, signal: AbortSignal) =>
      fetchTradeModel(input, signal, (async (url, options) => {
        assert.equal(url, "/api/economic-estimates"); assert.deepEqual(JSON.parse(String(options?.body)), request);
        assert.equal(options?.signal, signal); return Response.json(packet);
      }) as typeof fetch) },
  };
  const source = readFileSync(new URL("../hooks/flows/quotes/useTradeModel.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: { useTradeModel?: (input: TradeModelRequest, enabled: boolean) => {
    quotedOutput: bigint; quotedInput?: bigint; inputMaximum?: bigint;
    upperDisplay?: { requestKey: string; quotedOutput: bigint };
    fees?: { protocolFeeCygld: bigint; helperFeeCygld: bigint; marketFeeCygld: bigint };
  } | undefined } = {};
  runInNewContext(output, { exports, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key]; } });
  clearQuoteModels();
  try {
    assert.equal(exports.useTradeModel!(request, true)?.quotedOutput, 42n, "a cache miss retains the Backend-ranked estimate");
    assert.equal(exports.useTradeModel!(request, true)?.upperDisplay,undefined,"ordinary models do not impose an upper visibility threshold");
    assert.equal(getMarketQuoteModel(model.family, identity), model, "retain the concrete producer adapter family");
    assert.equal(getMarketQuoteModel(model.family, "other-deployment"), undefined);
    assert.deepEqual(observedKey[4], request, "the unified request requires no caller adapter");
    assert.equal(observedKey[5], identity);
    assert.deepEqual(await acquire({ signal: new AbortController().signal }), packet);

    const source = { request: { intent: 1, inputs: [{ currency: model.cygld, amount: "2000" }],
      outputCurrency: request.counterToken }, reuseSample: { referenceInput: "600", netOutput: "99",
      fees: { coreProtocolFeeCygld: "7", coreHelpersFeeCygld: "3", marketFeeCygld: "1" },
      basis: "observed-nonretained" } } as EconomicQuote;
    const scope = { chainId: 1, generation: null, configuration: identity };
    client.setQueryData(economicQuoteKey(source.request, scope), source);
    const plateau = exports.useTradeModel!(request, true)!;
    assert.equal(plateau.quotedOutput, 99n, "compare the budget to consumed600, not requested2000");
    assert.equal(plateau.fees?.protocolFeeCygld, 7n, "net output is not charged its displayed fees again");
    assert.equal(plateau.quotedInput, undefined, "the hint does not supply execution funding");
    assert.equal(plateau.inputMaximum, undefined);
    assert.equal(plateau.upperDisplay?.quotedOutput,99n);
    assert.equal(plateau.upperDisplay?.requestKey,JSON.stringify(economicQuoteKey({intent:1,inputs:[{currency:model.cygld,amount:request.amount}],
      outputCurrency:request.counterToken},scope)),"visibility policy belongs to this exact requested budget and scope");
    const smaller = exports.useTradeModel!({ ...request, amount: "300" }, true)!;
    assert.equal(smaller.quotedOutput, 49n);
    assert.equal(smaller.fees?.marketFeeCygld, 0n);
    assert.equal(client.getQueryCache().getAll().length, 1, "arithmetic hints never become cached exact observations");
    assert.equal(exports.useTradeModel!({ ...request, native: true }, true)?.quotedOutput, 42n,
      "native output cannot reuse an ERC20-output family");
    client.clear();
    packet.estimate={strategy:"universal",source:"cached-upper",amount:"77",referenceInput:"600",basis:"observed-nonretained",
      fees:{coreProtocolFeeCygld:"7",coreHelpersFeeCygld:"3",marketFeeCygld:"1"},context:marketFixtureQuote.context};
    const backendUpper=exports.useTradeModel!(request,true)!;
    assert.equal(backendUpper.quotedOutput,77n);assert.equal(backendUpper.upperDisplay?.quotedOutput,77n);
    assert.equal(backendUpper.upperDisplay?.requestKey,plateau.upperDisplay?.requestKey,"Backend and local cached upper share this budget's existing quote key");
    assert.equal(backendUpper.quotedInput,undefined);assert.equal(backendUpper.inputMaximum,undefined);
    assert.equal(exports.useTradeModel!(request, false), undefined);
  } finally { client.clear(); clearQuoteModels(); }
});
