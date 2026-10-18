import assert from "node:assert/strict";
import test from "node:test";
import { fetchQuoteIntent, preferQuoteIntent, quoteIntentResult, retainedQuotePlan, type QuoteIntent, type QuoteIntentRequest } from "./quoteIntent.ts";
import type { MarketRoutePlan } from "./marketQuote.ts";

const address = `0x${"a".repeat(40)}`;
const context = { chainId: 1, blockNumber: "100", blockHash: `0x${"b".repeat(64)}`, observedAt: "2026-10-04T13:00:00Z" };
const wide = 10n ** 40n;
const fees = { protocolFeeCygld: String(wide + 1n), helperFeeCygld: "2" };
const request: QuoteIntentRequest = { mode: "issue-exact-in", amount: String(wide), token: address,
  quoteToken: address, adapter: address, native: false, deadline: "1792000000", orderedAssets: [address], targets: [], slippageBps: 100 };
const value: QuoteIntent = { mode: request.mode, context, quotes: [{ adapter: address, outputAsset: address,
  amountIn: String(wide), minimumAmountOut: String(wide + 3n), data: "0xab" }],
  displayAmount: String(wide + 4n), executionAmount: String(wide + 5n), maximumInputAmount: String(wide + 6n),
  preview: { fees, orderedCoreAssets: [address] }, initialPreview: { fees, orderedCoreAssets: [address], netCygldOut: String(wide) },
  basketPreview: { fees, orderedCoreAssets: [address], amountsInExact: [String(wide)] },
  metrics: { rpcReads: 6, rpcReadsRequested: 6, rpcReadsCoalesced: 0, rpcReadsReused: 0, candidateCalls: 4, iterations: 0, totalMs: 10 } };

test("the intent stream publishes fragmented estimates before final completion without rounding integers", async () => {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  let observed!: () => void;
  const early = new Promise<void>(resolve => { observed = resolve; });
  const events: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
  const send = (event: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(event) + "\n");
    for (let offset = 0; offset < bytes.length; offset += 7) writer.enqueue(bytes.slice(offset, offset + 7));
  };
  const operation = fetchQuoteIntent(request, new AbortController().signal, event => { events.push(event); observed(); },
    (async (url, init) => {
      assert.equal(url, "/api/quotes/intent/stream"); assert.equal(init?.cache, "no-store");
      assert.deepEqual(JSON.parse(String(init?.body)), request);
      return new Response(body);
    }) as typeof fetch);
  send({ type: "estimate", amount: String(wide), context }); await early;
  assert.equal(events.length, 1);
  send({ type: "complete", value });
  const result = await operation;
  assert.equal(result.displayAmount, wide + 4n); assert.equal(result.executionAmount, wide + 5n);
  assert.equal(result.maximumInputAmount, wide + 6n); assert.equal(result.quotes[0].amountIn, wide);
  assert.equal(result.fees.protocolFeeCygld, wide + 1n);
});

test("truncation, errors and cancellation never turn an estimate into an executable quote", async () => {
  for (const ending of ["truncated", "error", "abort"] as const) {
    const abort = new AbortController(); let writer!: ReadableStreamDefaultController<Uint8Array>;
    let count = 0, cancelled = false;
    const operation = fetchQuoteIntent(request, abort.signal, () => { count++; if (ending === "abort") abort.abort(); },
      (async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { writer = controller; },
        cancel() { cancelled = true; } }))) as typeof fetch);
    writer.enqueue(new TextEncoder().encode(JSON.stringify({ type: "estimate", amount: "1", context }) + "\n"));
    if (ending !== "abort") {
      if (ending === "error") writer.enqueue(new TextEncoder().encode('{"type":"error","error":"Quote is temporarily unavailable.","correlationId":"fixture"}\n'));
      writer.close();
    }
    await assert.rejects(operation, ending === "abort" ? { name: "AbortError" } : { code: ending === "error" ? "quote-unavailable" : "quote-stream-interrupted" });
    assert.equal(count, 1); if (ending === "abort") assert.equal(cancelled, true);
  }
});

test("redemption conversion retains recovery-share IDs and routed token quantities", () => {
  const result = quoteIntentResult({ ...value, mode: "redeem-exact-in", initialPreview: null,
    quotes: [{ adapter: address, inputAsset: address, inputAmount: String(wide), minimumAmountOut: "7", data: "0xab" }],
    preview: { fees, minimumAmountOut: "7", projectedCoreOutputs: [{ kind: 1, token: address, id: String(wide + 9n), amount: "8" }] } });
  assert.equal(result.redemptionQuotes[0].inputAmount, wide);
  assert.equal(result.projectedCoreOutputs?.[0].id, wide + 9n); assert.equal(result.quotedAmountOut, 7n);
  const anchored = quoteIntentResult({ ...value, expectedCoreOutputs: [{ kind: 1, token: address, id: String(wide), minimumAmount: String(wide+1n) }] });
  assert.equal(anchored.expectedCoreOutputs?.[0].id, wide);
  assert.equal(anchored.expectedCoreOutputs?.[0].minimumAmount, wide+1n);
});

test("Core issue and redemption retain typed V4 routes through browser conversion and requoting", () => {
  const output = `0x${"c".repeat(40)}`;
  const routePlan: MarketRoutePlan = {
    version: 1, executionContext: "helpers-core", mode: "exactIn", tokenIn: address, tokenOut: output,
    inputAmount: String(wide), outputAmount: String(wide + 3n), limit: String(wide + 2n), deadline: "1792000000",
    branches: [{ amountIn: String(wide), hops: [{ zeroForOne: true,
      pool: { id: `0x${"d".repeat(64)}`, protocol: "v4", feePips: 100, tickSpacing: 1, poolManager: address,
        hooks: `0x${"0".repeat(40)}`, token0: { address, decimals: 18, chainId: 1 },
        token1: { address: output, decimals: 18, chainId: 1 } } }] }],
  };
  const issue = quoteIntentResult({ ...value, quotes: [{ adapter: address, outputAsset: output,
    amountIn: String(wide), minimumAmountOut: String(wide + 2n), data: "0xab", routePlan }] });
  assert.deepEqual(issue.quotes[0].routePlan, routePlan);
  assert.deepEqual(retainedQuotePlan(issue).quotes[0].routePlan, routePlan);
  const redemption = quoteIntentResult({ ...value, mode: "redeem-exact-in", quotes: [{ adapter: address,
    inputAsset: address, inputAmount: String(wide), minimumAmountOut: String(wide + 2n), data: "0xab", routePlan }] });
  assert.deepEqual(redemption.redemptionQuotes[0].routePlan, routePlan);
  assert.deepEqual(retainedQuotePlan(redemption).quotes[0].routePlan, routePlan);
});

test("custom tolerance preserves expected amounts and travels with retained execution bounds", () => {
  const input = { ...value, mode: "redeem-exact-in" as const, displayAmount: "10000", executionAmount: "20000",
    expectedInputAmount: "19500", slippageBps: 37,
    preview: { fees, minimumAmountOut: "9963",
      projectedCoreOutputs: [{ kind: 1, token: address, id: "9", amount: "10000" }] } };
  const result = quoteIntentResult(input);
  assert.equal(result.displayAmount, 10_000n);
  assert.equal(result.expectedInputAmount, 19_500n);
  assert.equal(result.quotedAmountOut, 9_963n);
  assert.equal(result.expectedCoreOutputs?.[0].minimumAmount, 9_963n);
  assert.equal(retainedQuotePlan(result).slippageBps, 37);
  assert.equal(retainedQuotePlan(result).expectedInputAmount, "19500");

  const previous = { ...result, slippageBps: 100, executionAmount: 30_000n };
  assert.equal(preferQuoteIntent("issue-exact-in", previous, result), result);
});

test("old response recovery floors use the current request tolerance", async () => {
  const oldResponse = { ...value, mode: "redeem-exact-in" as const, preview: { fees, minimumAmountOut: "10000",
    projectedCoreOutputs: [{ kind: 1, token: address, id: "9", amount: "10000" }] } };
  const result = await fetchQuoteIntent({ ...request, slippageBps: 300 }, new AbortController().signal, () => {},
    (async () => new Response(JSON.stringify({ type: "complete", value: oldResponse }) + "\n")) as typeof fetch);
  assert.equal(result.slippageBps, 300);
  assert.equal(result.expectedCoreOutputs?.[0].minimumAmount, 9_700n);
});

test("requested issuance and same-block capacity remain distinct from capped execution", () => {
  const result = quoteIntentResult({ ...value, requestedGrossCygldOut: String(wide + 10n),
    requestedNetCygldOut: String(wide + 9n), remainingGrossCapacity: String(wide + 8n),
    remainingNetCapacity: String(wide + 7n) });
  assert.equal(result.requestedGrossCygldOut, wide + 10n);
  assert.equal(result.requestedNetCygldOut, wide + 9n);
  assert.equal(result.remainingGrossCapacity, wide + 8n);
  assert.equal(result.remainingNetCapacity, wide + 7n);
  assert.equal(result.executionAmount, wide + 5n);
});

test("a full qualified event precedes completion; it is distinct from an amount estimate", async () => {
  const events: unknown[] = [];
  const result = await fetchQuoteIntent(request, new AbortController().signal, event => events.push(event),
    (async () => new Response([JSON.stringify({ type: "qualified", value }), JSON.stringify({ type: "complete", value }), ""].join("\n"))) as typeof fetch);
  assert.equal((events[0] as { type: string }).type, "qualified");
  assert.equal(result.executionAmount, wide + 5n);
});

test("replacement compares execution economics and anchors complete Core settlement bounds", () => {
  const base = quoteIntentResult(value);
  for (const mode of ["issue-exact-in", "issue-exact-out", "redeem-exact-in", "redeem-exact-out"] as const) {
    const current = { ...base, executionAmount: 100n, maximumInputAmount: 100n, quotedAmountOut: 100n };
    const worse = mode === "issue-exact-in" ? { ...current, executionAmount: 99n }
      : mode === "issue-exact-out" ? { ...current, maximumInputAmount: 101n }
      : mode === "redeem-exact-in" ? { ...current, quotedAmountOut: 99n } : { ...current, executionAmount: 101n };
    assert.equal(preferQuoteIntent(mode, current, worse), current);
  }
  const current = quoteIntentResult({ ...value, mode: "redeem-exact-in", preview: { fees, minimumAmountOut: "100",
    projectedCoreOutputs: [{ kind: 1, token: address, id: "9", amount: "100" }] } });
  const fresh = { ...current, projectedCoreOutputs: [{ kind: 1 as const, token: address as `0x${string}`, id: 9n, amount: 99n }],
    expectedCoreOutputs: [{ kind: 1 as const, token: address as `0x${string}`, id: 9n, minimumAmount: 98n }] };
  const chosen = preferQuoteIntent("redeem-exact-in", current, fresh);
  assert.equal(chosen.expectedCoreOutputs?.[0].minimumAmount, 99n);
  assert.equal(preferQuoteIntent("redeem-exact-in", chosen, { ...fresh, projectedCoreOutputs: [{ ...fresh.projectedCoreOutputs[0], amount: 98n }] }), chosen);
  assert.equal(preferQuoteIntent("redeem-exact-in", chosen, { ...fresh, projectedCoreOutputs: [{ ...fresh.projectedCoreOutputs[0], id: 10n }] }), chosen);
});

test('Core result adaptation retains optional qualified diagnostics and references without changing executable terms', async () => {
  const {diagnosticReferences,quoteDiagnostics,retainDiagnosticReferences,retainQuoteDiagnostics}=await import('./diagnosticReferences.ts');
  const input=structuredClone(value), baseline=quoteIntentResult(input), refs={requestId:'00000000-0000-0000-0000-000000000048'};
  const trace={qualified:true,providerQualifications:{provider:'core',attempts:1,selectedAttempt:1,selectionReason:'complete',selectionMs:1.5,rows:[{attempt:1,stage:'selection',outcome:'qualified',elapsedMs:1.5}]}};
  retainDiagnosticReferences(input,refs);retainQuoteDiagnostics(input,trace);
  const observed=quoteIntentResult(input), {quoteDiagnostics:removed,...terms}=observed, {quoteDiagnostics:prior,...previous}=baseline;
  assert.deepEqual(terms,previous);assert.equal(prior,undefined);assert.ok(removed);
  assert.deepEqual(quoteDiagnostics(observed),trace);assert.deepEqual(diagnosticReferences(observed),refs);
  (trace.providerQualifications.rows[0] as {elapsedMs:number}).elapsedMs=999;assert.equal(quoteDiagnostics(observed)?.providerQualifications?.rows[0].elapsedMs,1.5);
});
