import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { backendRoute } from "../server/backend-client.ts";
import { fetchTradeModel, fetchTradeQuote, receiveTradeModel, type TradeModelRequest, type TradeQuoteModelPacket } from "./tradeQuote.ts";
import { clearQuoteModels, getMarketQuoteModel, getQuoteModel } from "./quoteModelStore.ts";
import { modelFamily, type QuoteModelPacket } from "./quoteModels.ts";
import { marketModelFamily } from "./marketQuote.ts";
import { resetSandboxQueries } from "./sandboxForkState.ts";
import { withEnvironment } from "../../tests/fixtures/environment.mts";
import { coreTrade, marketTrade, tradeCounter, tradeOwner } from "../../tests/fixtures/trade-quote.mts";

const selected = marketTrade(), intent: TradeModelRequest = { side: "sell", mode: "exact-in", counterToken: tradeCounter, native: false, amount: "10", slippageBps: 100 };
const coreModel: QuoteModelPacket = { revision: 1, intent: coreTrade().providerRequest, protocol: null, routes: [], whole: [] };
const marketFamily = marketModelFamily(selected.providerRequest);
const packet: TradeQuoteModelPacket = { namespace: "trade", intent,
  models: [{ strategy: "core", value: coreModel }, { strategy: "market", value: { namespace: "market", family: marketFamily,
    intent: { side: "sell", mode: "exact-in", counterToken: selected.providerRequest.counterToken, adapter: selected.providerQuote.params.adapter },
    cygld: selected.tokenIn, feeRatePpm: 1000, context: selected.context, routes: [] } }],
  estimate: { strategy: "market", amount: "42" } };

test("unified model packets preserve producer family namespaces and only the Backend-ranked estimate", () => {
  clearQuoteModels();
  receiveTradeModel(packet, "old-deployment");
  assert.equal(getQuoteModel(modelFamily(coreModel.intent), "old-deployment"), packet.models[0].value);
  assert.equal(getMarketQuoteModel(marketFamily, "old-deployment"), packet.models[1].value);
  receiveTradeModel(packet, "old-deployment"); // A late old request keeps its captured namespace.
  assert.equal(getQuoteModel(modelFamily(coreModel.intent), "new-deployment"), undefined);
  assert.equal(getMarketQuoteModel(marketFamily, "new-deployment"), undefined);
  assert.deepEqual(packet.estimate, { strategy: "market", amount: "42" });
  clearQuoteModels();
});

test("unified models and a qualified winner cross the App before completion; cancelling closes upstream", async () => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://backend.invalid", CYBERGOLD_BACKEND_BEARER_TOKEN: "fixture-private" }, async () => {
    const abort = new AbortController(), events: string[] = [];
    let writer!: ReadableStreamDefaultController<Uint8Array>, cancelled = false, accepted!: () => void;
    const early = new Promise<void>(resolve => { accepted = resolve; });
    const upstream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; }, cancel() { cancelled = true; } });
    const request = { ...intent, recipient: tradeOwner, deadline: "1900000000" };
    const route = backendRoute("/api/quotes/trade/stream", (async (_url, init) => {
      assert.deepEqual(await new Response(init?.body).json(), request);
      return new Response(upstream, { headers: { "content-type": "application/x-ndjson" } });
    }) as typeof fetch);
    const pending = fetchTradeQuote(request, abort.signal, event => { events.push(event.type); if (event.type === "qualified") accepted(); },
      (async (url, init) => route(new Request(`https://app.invalid${url}`, init))) as typeof fetch);
    for (const frame of [{ type: "model", value: packet }, { type: "qualified", value: selected }])
      writer.enqueue(new TextEncoder().encode(JSON.stringify(frame) + "\n"));
    await early; assert.deepEqual(events, ["model", "qualified"]);
    abort.abort(); await assert.rejects(pending, { name: "AbortError" });
    assert.equal(cancelled, true); assert.deepEqual(events, ["model", "qualified"]);
  });
});

test("identical unified model observers share one acquisition, preserve another consumer and reuse warm data", async () => {
  const client = new QueryClient();
  let calls = 0, signal!: AbortSignal, release!: (value: Response) => void, done!: () => void;
  const completed = new Promise<void>(resolve => { done = resolve; });
  const options = { queryKey: ["trade-model", 1, "fork-one", "head-one", intent, "deployment-one"], retry: false, staleTime: 10_000,
    queryFn: ({ signal: value }: { signal: AbortSignal }) => fetchTradeModel(intent, value, (async (_url, init) => {
      calls++; signal = init!.signal as AbortSignal;
      return new Promise<Response>(resolve => { release = resolve; });
    }) as typeof fetch) };
  const first = new QueryObserver(client, options), second = new QueryObserver(client, options);
  const stopFirst = first.subscribe(() => {}), stopSecond = second.subscribe(value => { if (value.isSuccess) done(); });
  try {
    assert.equal(calls, 1); stopFirst(); assert.equal(signal.aborted, false);
    release(Response.json(packet)); await completed;
    assert.deepEqual(await client.fetchQuery(options), packet); assert.equal(calls, 1);
  } finally { stopFirst(); stopSecond(); client.clear(); }
});

test("fork retirement cancels unified model acquisition and ignores the late response", async () => {
  const client = new QueryClient(), key = ["trade-model", 31338, "old-fork", "old-head", intent];
  let signal!: AbortSignal, release!: (value: Response) => void;
  const pending = client.fetchQuery({ queryKey: key, retry: false, queryFn: ({ signal: value }) => fetchTradeModel(intent, value,
    (async (_url, init) => { signal = init!.signal as AbortSignal; return new Promise<Response>(resolve => { release = resolve; }); }) as typeof fetch) }).catch(() => undefined);
  try {
    await resetSandboxQueries(client); assert.equal(signal.aborted, true);
    release(Response.json(packet)); await pending; assert.equal(client.getQueryState(key), undefined);
  } finally { client.clear(); }
});
