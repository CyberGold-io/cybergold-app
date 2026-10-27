import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver, focusManager, onlineManager } from "@tanstack/react-query";
import { economicQuoteKey, economicQuoteOptions, fetchEconomicQuote, fetchTxPreparation, type EconomicQuote } from "./economicQuotes.ts";

const token = "0x0000000000000000000000000000000000000002" as const;
const core = "0x0000000000000000000000000000000000000003" as const;
const request = { intent: 0 as const, inputs: [{ currency: token, amount: "100000" }], outputCurrency: core };
const scope = { chainId: 1, generation: undefined, configuration: "deployment-a" };
const quote = (output = "249") => ({ request, quotedOutput: output, plan: { allocations: [], conversions: {}, body: {} },
  context: { chainId: 1, blockNumber: "1", blockHash: "original-block", observedAt: "original-time" } }) as unknown as EconomicQuote;

test("economic cache identity excludes execution fields, blockchain head and Refresh", () => {
  const extra = { ...request, recipient: token, deadline: "1999999999", slippageBps: 500, blockHash: "new-head", refresh: true };
  assert.deepEqual(economicQuoteKey(request, scope), economicQuoteKey(extra, scope));
  assert.deepEqual(economicQuoteKey({ ...request, inputs: [{ currency: token.toUpperCase(), amount: "0100000" }] }, scope), economicQuoteKey(request, scope));
  assert.notDeepEqual(economicQuoteKey(request, { ...scope, configuration: "deployment-b" }), economicQuoteKey(request, scope));
  assert.notDeepEqual(economicQuoteKey(request, { ...scope, generation: "fork-b" }), economicQuoteKey(request, scope));
});

test("quote requests carry economic inputs only; explicit Refresh is the search transport flag", async () => {
  const calls: { path: unknown; body: unknown }[] = [];
  const fetcher = (async (path, init) => {
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    return Response.json(quote());
  }) as typeof fetch;
  await fetchEconomicQuote(request, undefined, false, fetcher);
  await fetchEconomicQuote(request, undefined, true, fetcher);
  assert.deepEqual(calls, [{ path: "/api/economic-quotes", body: request },
    { path: "/api/economic-quotes", body: { ...request, refresh: true } }]);
});

test("old measured quotes remain immediate across remount, focus and reconnect without another request", async () => {
  const client = new QueryClient(); client.mount();
  let calls = 0;
  const options = economicQuoteOptions(request, scope, (async () => { calls++; return Response.json(quote()); }) as typeof fetch);
  try {
    await client.fetchQuery(options);
    client.setQueryData(options.queryKey, quote(), { updatedAt: Date.now() - 600_000 });
    const first = new QueryObserver(client, options), stopFirst = first.subscribe(() => {});
    assert.equal(first.getCurrentResult().data?.quotedOutput, "249");
    stopFirst();
    const second = new QueryObserver(client, options), stopSecond = second.subscribe(() => {});
    focusManager.setFocused(false); focusManager.setFocused(true);
    onlineManager.setOnline(false); onlineManager.setOnline(true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(second.getCurrentResult().data?.quotedOutput, "249");
    assert.equal((await client.fetchQuery(options)).context.blockHash, "original-block");
    assert.equal(calls, 1);
    stopSecond();
  } finally { focusManager.setFocused(undefined); client.unmount(); client.clear(); }
});

test("a failed explicit refresh retains the complete previous observation and its context", async () => {
  const client = new QueryClient(), options = economicQuoteOptions(request, scope);
  const original = quote(); client.setQueryData(options.queryKey, original);
  try {
    await assert.rejects(client.fetchQuery({ ...options, staleTime: 0,
      queryFn: ({ signal }) => fetchEconomicQuote(request, signal, true,
        (async () => Response.json({ error: "No route", code: "quote-no-route" }, { status: 503 })) as typeof fetch) }));
    assert.deepEqual(client.getQueryData(options.queryKey), original);
    assert.equal(client.getQueryState(options.queryKey)?.status, "error");
  } finally { client.clear(); }
});

test("a late answer for a different amount cannot replace the currently observed amount", async () => {
  const client = new QueryClient();
  let release!: (response: Response) => void;
  const first = economicQuoteOptions(request, scope, (() => new Promise(resolve => { release = resolve; })) as typeof fetch);
  const other = { ...request, inputs: [{ currency: token, amount: "200000" }] };
  const second = economicQuoteOptions(other, scope, (async () => Response.json({ ...quote("600"), request: other })) as typeof fetch);
  const pending = client.fetchQuery(first);
  const observer = new QueryObserver(client, second), stop = observer.subscribe(() => {});
  try {
    await client.fetchQuery(second);
    release(Response.json(quote("249"))); await pending;
    assert.equal(observer.getCurrentResult().data?.quotedOutput, "600");
    assert.equal(client.getQueryData<EconomicQuote>(first.queryKey)?.quotedOutput, "249");
  } finally { stop(); client.clear(); }
});

test("transaction preparation captures selected economics and previously accepted bounds", async () => {
  const selected = quote(), acceptedBounds = { inputs: request.inputs, minimumOutput: "247" };
  let posted: unknown;
  await fetchTxPreparation(selected, { sender: token, recipient: core, slippageBps: 100, acceptedBounds }, undefined,
    (async (path, init) => { assert.equal(path, "/api/tx-preparations"); posted = JSON.parse(String(init?.body));
      return Response.json({ sender: token }); }) as typeof fetch);
  assert.deepEqual(posted, { quote: selected, sender: token, recipient: core, slippageBps: 100, acceptedBounds });
  assert.equal("deadline" in (posted as Record<string, unknown>), false);
});
