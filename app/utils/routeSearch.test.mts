import assert from "node:assert/strict";
import test from "node:test";
import { clearRouteObservations, fetchRouteQuotes } from "./routeSearch.ts";
import type { MarketRoutePlan } from "./marketQuote.ts";

const inputAsset = "0x1111111111111111111111111111111111111111" as const;
const outputAsset = "0x2222222222222222222222222222222222222222" as const;

test("same-head route observations separate explicit adapters while retaining their protocol plans", async () => {
  const hash = `0x${"a".repeat(64)}`;
  const adapterA = `0x${"a".repeat(40)}`, adapterB = `0x${"b".repeat(40)}`;
  let calls = 0;
  const fetchImpl = (async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    const routePlan: MarketRoutePlan = { version: 1, executionContext: "helpers-core", mode: "exactIn",
      tokenIn: inputAsset, tokenOut: outputAsset, inputAmount: "1", outputAmount: "9", limit: "9", deadline: "1792000000",
      branches: [{ amountIn: "1", hops: [{ zeroForOne: true, pool: { id: `0x${"d".repeat(64)}`,
        protocol: "v4", poolManager: body.adapter, feePips: 100, tickSpacing: 1, hooks: `0x${"0".repeat(40)}`,
        token0: { address: inputAsset, decimals: 18, chainId: 1 },
        token1: { address: outputAsset, decimals: 18, chainId: 1 } } }] }] };
    return Response.json({ context: { blockHash: hash }, results: [{ attempted: 1, best: {
      path: "0x", quote: "9", route: "direct", feeInfo: "100", routePlan,
    } }] });
  }) as typeof fetch;
  const base = { targets: [{ inputAsset, outputAsset, amount: 1n }], mode: "exact-in" as const,
    scope: `1:generation:${hash}`, fetchImpl };
  const first = await fetchRouteQuotes({ ...base, adapter: adapterA });
  const second = await fetchRouteQuotes({ ...base, adapter: adapterB });
  const again = await fetchRouteQuotes({ ...base, adapter: `0x${"A".repeat(40)}` });
  assert.equal(calls, 2); assert.deepEqual(first, again);
  assert.notDeepEqual(first[0]?.routePlan, second[0]?.routePlan);
});

test("one uncached wave preserves target order, wide values and missing candidates", async () => {
  for (const mode of ["exact-in", "exact-out"] as const) {
    let calls = 0;
    const progress: number[] = [];
    const targets = [0, 1].map(index => ({ inputAsset, outputAsset, amount: 2n ** 210n + BigInt(index) }));
    const values = await fetchRouteQuotes({ targets, mode, onProgress: index => progress.push(index),
      fetchImpl: (async (url, init) => {
        calls++;
        assert.equal(url, "/api/quotes/routes");
        assert.equal(init?.cache, "no-store");
        assert.deepEqual(JSON.parse(String(init?.body)), { mode, targets: targets.map(row => ({ ...row, amount: String(row.amount) })) });
        return Response.json({ results: [
          { attempted: 13, best: { path: "0xab", quote: String(2n ** 200n), route: "direct", feeInfo: "500" } },
          { attempted: 13, best: null },
        ] });
      }) as typeof fetch });
    assert.equal(calls, 1);
    assert.equal(values[0]?.quote, 2n ** 200n);
    assert.equal(values[1], undefined);
    assert.deepEqual(progress, [0, 1]);
  }
});

test("aborts reach transport, late responses cannot publish, and failures are redacted", async () => {
  const controller = new AbortController();
  const targets = [{ inputAsset, outputAsset, amount: 1n }];
  await assert.rejects(fetchRouteQuotes({ targets, mode: "exact-in", signal: controller.signal,
    fetchImpl: (async (_url, init) => {
      assert.equal(init?.signal, controller.signal);
      controller.abort();
      return Response.json({ results: [] });
    }) as typeof fetch }), { name: "AbortError" });
  let calls = 0;
  await assert.rejects(fetchRouteQuotes({ targets, mode: "exact-out", fetchImpl: (async () => {
    calls++;
    return new Response("private RPC details", { status: 503 });
  }) as typeof fetch }), /Route search is temporarily unavailable/);
  assert.equal(calls, 1);
  assert.deepEqual(await fetchRouteQuotes({ targets: [], mode: "exact-in",
    fetchImpl: (async () => { throw new Error("unexpected fetch"); }) as typeof fetch }), []);
});

function row(quote: string | null, attempted = 1) {
  return { target: { inputAsset, outputAsset, amount: "1" }, attempted, total: 4,
    succeeded: quote === null ? 0 : attempted, failures: [], best: quote === null ? null :
      { path: "0xab", quote, route: "direct" as const, feeInfo: "500" } };
}

test("streamed candidates publish before slower reads finish across arbitrary chunks", async () => {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const observed: bigint[][] = [];
  const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  const send = (event: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(event) + "\n");
    for (let i = 0; i < bytes.length; i += 7) writer.enqueue(bytes.slice(i, i + 7));
  };
  const operation = fetchRouteQuotes({ targets: [{ inputAsset, outputAsset, amount: 1n }], mode: "exact-in",
    onCandidates: values => { observed.push(values.map(value => value?.quote ?? 0n)); finish(); },
    fetchImpl: (async url => {
      assert.equal(url, "/api/quotes/routes/stream");
      return new Response(stream, { headers: { "content-type": "application/x-ndjson" } });
    }) as typeof fetch });
  send({ type: "progress", results: [row("11")] });
  await ready;
  assert.deepEqual(observed, [[11n]]);
  send({ type: "progress", results: [row("11", 2)] });
  send({ type: "progress", results: [row("19", 3)] });
  send({ type: "complete", value: { results: [row("21", 4)] } });
  const result = await operation;
  assert.deepEqual(observed, [[11n], [19n]]);
  assert.equal(result[0]?.quote, 21n);
});

test("provisional results never resolve as final on truncation, error or cancellation", async () => {
  for (const ending of ["truncated", "error", "abort"] as const) {
    const controller = new AbortController();
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    let count = 0;
    const operation = fetchRouteQuotes({ targets: [{ inputAsset, outputAsset, amount: 1n }],
      mode: "exact-out", signal: controller.signal, onCandidates: () => {
        count++;
        if (ending === "abort") controller.abort();
      }, fetchImpl: (async () => new Response(new ReadableStream<Uint8Array>({
        start(value) { writer = value; },
      }))) as typeof fetch });
    writer.enqueue(new TextEncoder().encode(JSON.stringify({ type: "progress", results: [row("11")] }) + "\n"));
    if (ending !== "abort") {
      if (ending === "error") writer.enqueue(new TextEncoder().encode(JSON.stringify({
        type: "error", error: "private upstream information", correlationId: "fixture" }) + "\n"));
      writer.close();
    }
    await assert.rejects(operation, ending === "abort" ? { name: "AbortError" } : /Route search is temporarily unavailable/);
    assert.equal(count, 1);
  }
});


test("same-head concurrent and A-B-A searches share observations; changed hash and reset read fresh", async () => {
  let calls = 0;
  const hash = `0x${"a".repeat(64)}`;
  const fetchImpl = (async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json({ context: { blockHash: hash }, results: [row("111")] });
  }) as typeof fetch;
  const base = { mode: "exact-in" as const, scope: `1:generation:${hash}`, fetchImpl };
  const a = [{ inputAsset, outputAsset, amount: 1n }];
  const b = [{ inputAsset, outputAsset, amount: 2n }];
  await Promise.all(Array.from({ length: 20 }, () => fetchRouteQuotes({ ...base, targets: a })));
  assert.equal(calls, 1);
  await fetchRouteQuotes({ ...base, targets: b });
  await fetchRouteQuotes({ ...base, targets: a });
  assert.equal(calls, 2);
  await fetchRouteQuotes({ ...base, scope: "1:generation:0xbb", targets: a });
  assert.equal(calls, 3);
  clearRouteObservations();
  await fetchRouteQuotes({ ...base, targets: a });
  assert.equal(calls, 4);
});

test("one abort leaves another route subscriber alive; mismatched context is not retained", async () => {
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0, transportAborted = false;
  const fetchImpl = (async (_url, init) => {
    calls++;
    init?.signal?.addEventListener("abort", () => { transportAborted = true; });
    await ready;
    return Response.json({ context: { blockHash: "0xbb" }, results: [row("111")] });
  }) as typeof fetch;
  const abort = new AbortController();
  const options = { mode: "exact-in" as const, scope: "1:generation:0xaa", fetchImpl,
    targets: [{ inputAsset, outputAsset, amount: 1n }] };
  const first = fetchRouteQuotes({ ...options, signal: abort.signal });
  const second = fetchRouteQuotes(options);
  await Promise.resolve();
  abort.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(transportAborted, false);
  finish();
  assert.equal((await second)[0]?.quote, 111n);
  assert.equal(calls, 1);
  await fetchRouteQuotes(options);
  assert.equal(calls, 2);
});


test("route reuse expires on elapsed time and a failed search can retry", async t => {
  let elapsed = 0, calls = 0;
  t.mock.method(performance, "now", () => elapsed);
  const base = { scope: "1::0xaa", mode: "exact-in" as const,
    targets: [{ inputAsset, outputAsset, amount: 1n }],
    fetchImpl: (async () => { calls++; return calls === 1 ? new Response("", { status: 503 }) :
      Response.json({ context: { blockHash: "0xaa" }, results: [row("123")] }); }) as typeof fetch };
  await assert.rejects(fetchRouteQuotes(base));
  await fetchRouteQuotes(base);
  elapsed = 9_999;
  await fetchRouteQuotes(base);
  assert.equal(calls, 2);
  elapsed = 10_000;
  await fetchRouteQuotes(base);
  assert.equal(calls, 3);
});
