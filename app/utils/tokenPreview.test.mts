import assert from "node:assert/strict";
import test from "node:test";
import { fetchTokenPreview, tokenPreviewResult, type TokenPreview } from "./tokenPreview.ts";

const context = { chainId: 31338, blockNumber: "101", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-01T00:00:00Z" };
const helpers = `0x${"5".repeat(40)}`;
const fees = { protocolFeeCygld: "0", helperFeeCygld: String(2n ** 180n) };
const orderedCoreAssets = [`0x${"6".repeat(40)}`, `0x${"7".repeat(40)}`];

test("token/native issue results preserve every mode, asset order, zero fees and wide amounts", () => {
  for (const mode of ["issue-token-exact-in", "issue-native-exact-in"] as const) {
    const result = tokenPreviewResult({ mode, context, helpers, result: { fees, netCygldOut: String(2n ** 210n), orderedCoreAssets } });
    assert.deepEqual(result, { fees: { protocolFeeCygld: 0n, helperFeeCygld: 2n ** 180n }, netCygldOut: 2n ** 210n, orderedCoreAssets });
  }
  for (const mode of ["issue-token-exact-out", "issue-native-exact-out"] as const) {
    const result = tokenPreviewResult({ mode, context, helpers, result: { fees, orderedCoreAssets } });
    assert.deepEqual(result, { fees: { protocolFeeCygld: 0n, helperFeeCygld: 2n ** 180n }, orderedCoreAssets });
  }
});

test("token/native redemption retains ERC1155 identifiers and wide output amounts", () => {
  for (const mode of ["redeem-token-exact-in", "redeem-native-exact-in"] as const) {
    const result = tokenPreviewResult({ mode, context, helpers, result: { fees, minimumAmountOut: String(2n ** 200n),
      projectedCoreOutputs: [{ kind: 1, token: orderedCoreAssets[1], id: String(2n ** 190n), amount: "17" }] } });
    assert.deepEqual(result, { fees: { protocolFeeCygld: 0n, helperFeeCygld: 2n ** 180n }, minimumAmountOut: 2n ** 200n,
      projectedCoreOutputs: [{ kind: 1, token: orderedCoreAssets[1], id: 2n ** 190n, amount: 17n }] });
  }
});

test("fixed preview fetch preserves opaque quote bytes and propagates cancellation without a browser bearer", async () => {
  const controller = new AbortController();
  const request = { mode: "issue-token-exact-in" as const, inputToken: orderedCoreAssets[0], inputAmount: String(2n ** 200n),
    quotes: [{ adapter: helpers, amountIn: "0", minimumAmountOut: "17", data: "0x000123abcde0" }] };
  await fetchTokenPreview(request, controller.signal, (async (url, init) => {
    assert.equal(url, "/api/quotes/token-preview");
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.deepEqual(JSON.parse(String(init?.body)), request);
    return Response.json({ mode: request.mode, context, helpers, result: { fees, netCygldOut: "17", orderedCoreAssets } });
  }) as typeof fetch);
});

test("failed preview never produces a zero result or retries through RPC", async () => {
  let calls = 0;
  await assert.rejects(fetchTokenPreview({ mode: "redeem-native-exact-in", grossCygldIn: "0", quotes: [] }, undefined,
    (async () => { calls++; return new Response(null, { status: 503 }); }) as typeof fetch), /temporarily unavailable/);
  assert.equal(calls, 1);
  assert.throws(() => tokenPreviewResult({ mode: "unknown", result: { fees } } as unknown as TokenPreview), /temporarily unavailable/);
});
