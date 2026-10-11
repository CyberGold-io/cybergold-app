import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { backendRoute } from "../server/backend-client.ts";
import { fetchMarketQuote, marketModelFamily, type MarketQuoteModelPacket } from "./marketQuote.ts";
import { fetchMarketModel } from "./marketModels.ts";
import { resetSandboxQueries } from "./sandboxForkState.ts";
import { withEnvironment } from "../../tests/fixtures/environment.mts";
import { context, marketFixtureQuote, marketFixtureRequest } from "../../tests/fixtures/market-quote.mts";

test("market models and qualified quotes cross the App server before completion; editing cancels that stream", async () => {
  await withEnvironment({ CYBERGOLD_BACKEND_URL: "http://backend.invalid", CYBERGOLD_BACKEND_BEARER_TOKEN: "fixture-private" }, async () => {
    const abort = new AbortController();
    let writer!: ReadableStreamDefaultController<Uint8Array>, cancelled = false;
    let early!: () => void, qualified!: () => void;
    const baseline = new Promise<void>(resolve => { early = resolve; });
    const accepted = new Promise<void>(resolve => { qualified = resolve; });
    const events: string[] = [];
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) { writer = controller; }, cancel() { cancelled = true; },
    });
    const route = backendRoute("/api/quotes/market/stream", (async (url, init) => {
      assert.equal(String(url), "http://backend.invalid/api/quotes/market/stream");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-private");
      assert.deepEqual(await new Response(init?.body).json(), marketFixtureRequest);
      return new Response(upstream, { headers: { "content-type": "application/x-ndjson", "x-accel-buffering": "no" } });
    }) as typeof fetch);
    const viaApp = (async (url, init) => route(new Request(`https://app.invalid${url}`, init))) as typeof fetch;
    const pending = fetchMarketQuote(marketFixtureRequest, abort.signal, event => {
      events.push(event.type);
      if (event.type === "model") early();
      if (event.type === "qualified") qualified();
    }, viaApp);
    writer.enqueue(new TextEncoder().encode(JSON.stringify({ type: "model", value: model }) + "\n"));
    await baseline;
    writer.enqueue(new TextEncoder().encode(JSON.stringify({ type: "qualified", value: marketFixtureQuote }) + "\n"));
    await accepted;
    assert.deepEqual(events, ["model", "qualified"]);
    abort.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(cancelled, true);
    assert.deepEqual(events, ["model", "qualified"], "obsolete work cannot publish a late terminal result");
  });
});

const model: MarketQuoteModelPacket = {
  namespace: "market", family: marketModelFamily(marketFixtureRequest),
  intent: { side: "sell", mode: "exact-in", counterToken: marketFixtureRequest.counterToken, adapter: marketFixtureRequest.adapter },
  cygld: marketFixtureQuote.tokenIn, feeRatePpm: 1000, context: { ...context, chainId: 31338 },
  routes: [{ route: marketFixtureQuote.plan.route, amountIn: "0", amountOut: "0", points: [],
    exchangeRate: { numerator: "1", denominator: "1" }, feeRetention: { numerator: "1", denominator: "1" } }],
};

test("market baseline subscribers share cold acquisition, preserve another observer, reuse warm data and refresh a replacement head", async () => {
  const client = new QueryClient();
  let calls = 0, release!: (response: Response) => void, signal!: AbortSignal;
  const fetchImpl = (async (_url, init) => {
    calls++; signal = init!.signal as AbortSignal;
    assert.deepEqual(JSON.parse(String(init?.body)), model.intent);
    return new Promise<Response>(resolve => { release = resolve; });
  }) as typeof fetch;
  const options = (hash: string) => ({ queryKey: ["market-model", 31338, "fork-one", `31338:fork-one:${hash}`, model.family],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchMarketModel(model.intent, signal, fetchImpl),
    staleTime: 10_000, gcTime: Infinity, retry: false });
  const first = new QueryObserver(client, options(context.blockHash));
  const second = new QueryObserver(client, options(context.blockHash));
  const stopFirst = first.subscribe(() => {});
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const stopSecond = second.subscribe(value => { if (value.isSuccess) complete(); });
  try {
    assert.equal(calls, 1);
    stopFirst();
    assert.equal(signal.aborted, false, "one observer leaving cannot cancel the remaining market consumer");
    release(Response.json(model)); await done;
    assert.equal(second.getCurrentResult().data?.routes[0].points.length, 0);
    assert.deepEqual(await client.fetchQuery(options(context.blockHash)), model);
    assert.equal(calls, 1, "warm baseline reuse is independent of trade amount or history");
    const replacementHash = `0x${"d".repeat(64)}`;
    const replacement = client.fetchQuery(options(replacementHash));
    assert.equal(calls, 2);
    release(Response.json({ ...model, context: { ...context, blockHash: replacementHash } }));
    assert.equal((await replacement).context?.blockHash, replacementHash);
  } finally { stopFirst(); stopSecond(); client.clear(); }
});

test("fork reset aborts pending market models and ignores their late completion", async () => {
  const client = new QueryClient();
  const key = ["market-model", 31338, "old-fork", "old-head", model.family];
  let release!: (response: Response) => void, signal!: AbortSignal;
  const pending = client.fetchQuery({ queryKey: key, retry: false,
    queryFn: ({ signal: input }) => fetchMarketModel(model.intent, input, (async (_url, init) => {
      signal = init!.signal as AbortSignal;
      return new Promise<Response>(resolve => { release = resolve; });
    }) as typeof fetch),
  }).catch(() => undefined);
  try {
    await resetSandboxQueries(client);
    assert.equal(signal.aborted, true);
    release(Response.json(model));
    await pending;
    assert.equal(client.getQueryState(key), undefined);
  } finally { client.clear(); }
});
