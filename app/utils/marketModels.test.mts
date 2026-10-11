import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { predictMarketModel, fetchMarketModel } from "./marketModels.ts";
import { marketFixtureQuote, marketFixtureRequest } from "../../tests/fixtures/market-quote.mts";
import { marketModelFamily, type MarketQuoteModelPacket } from "./marketQuote.ts";

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

test("a Backend-resolved adapter family supplies the local estimate when bootstrap selection was unavailable", () => {
  const { adapter: _, ...request } = model.intent;
  void _;
  let observedKey: unknown[] = [], lookedUp = "";
  const dependencies: Record<string, unknown> = {
    react: { useEffect: (effect: () => void) => effect(), useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get() },
    "@tanstack/react-query": { useQuery: (options: { queryKey: unknown[] }) => { observedKey = options.queryKey; return { data: model }; }, useQueryClient: () => ({}) },
    "@/app/context/protocolConfigurationContext": { useProtocolConfiguration: () => ({ identity: "configured-roots-adapter-unavailable" }) },
    "@/app/config/chain": { targetChainId: 1 },
    "@/app/context/sandboxForkContext": { useSandboxForkGeneration: () => null },
    "@/app/context/chainHeadContext": { useQuoteCacheScope: () => "1:head" },
    "@/app/hooks/usePageVisible": { usePageVisible: () => true },
    "@/app/utils/marketQuote": { marketModelFamily },
    "@/app/utils/marketModels": { fetchMarketModel, predictMarketModel },
    "@/app/utils/quoteModelStore": { subscribeQuoteModels: () => () => {}, receiveMarketQuoteModel: () => {},
      getMarketQuoteModel: (family: string) => { lookedUp = family; return family === model.family ? model : undefined; } },
  };
  const source = readFileSync(new URL("../hooks/flows/quotes/useMarketModel.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: { useMarketModel?: (input: typeof request, amount: bigint) => bigint } = {};
  runInNewContext(output, { exports, require: (key: string) => { assert.ok(key in dependencies, key); return dependencies[key]; } });
  assert.equal(exports.useMarketModel!(request, 1002n), 1000n);
  assert.equal(lookedUp, model.family);
  assert.equal(observedKey[4], marketModelFamily(request), "request lookup remains scoped to its original default selection");
});
