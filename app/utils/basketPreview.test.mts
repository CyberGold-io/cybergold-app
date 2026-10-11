import assert from "node:assert/strict";
import test from "node:test";
import { basketPreviewResult, fetchBasketPreview, type BasketPreview } from "./basketPreview.ts";
import { QuotePreviewError } from "./quoteErrors.ts";
import { clearQuoteModels, getProtocolModel, receiveProtocolModel } from "./quoteModelStore.ts";

const fees = { protocolFeeCygld: "0", helperFeeCygld: String(2n ** 180n) };
const tokens = [`0x${"2".repeat(40)}`, `0x${"1".repeat(40)}`];
const projectedCoreOutputs = [{ kind: 0, token: tokens[0], id: "0", amount: String(2n ** 200n) },
  { kind: 1, token: tokens[1], id: String(2n ** 190n), amount: "17" }];
const context = { chainId: 31338, blockNumber: "101", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-01T00:00:00Z" };
const values: BasketPreview[] = [
  { mode: "issue-exact-in", helpers: tokens[0], context, result: { netCygldOut: String(2n ** 210n), fees,
    amountsInExact: [String(2n ** 200n), "17"], orderedCoreAssets: tokens } },
  { mode: "issue-exact-out", helpers: tokens[0], context, result: { fees,
    amountsInExact: [String(2n ** 200n), "17"], orderedCoreAssets: tokens } },
  { mode: "redeem-exact-in", helpers: tokens[0], context, result: { fees, projectedCoreOutputs } },
  { mode: "redeem-exact-out", helpers: tokens[0], context, result: { fees, projectedCoreOutputs, grossCygldIn: String(2n ** 210n) } },
];

test("all four previews restore exact wide amounts, zero fees and original basket/token order", () => {
  for (const value of values) {
    const result = basketPreviewResult(value);
    assert.equal(result.fees.protocolFeeCygld, 0n);
    assert.equal(result.fees.helperFeeCygld, 2n ** 180n);
    if ("amountsInExact" in result) {
      assert.deepEqual(result.amountsInExact, [2n ** 200n, 17n]);
      assert.deepEqual(result.orderedCoreAssets, tokens);
    } else {
      assert.deepEqual(result.projectedCoreOutputs.map(row => row.token), tokens);
      assert.equal(result.projectedCoreOutputs[1].id, 2n ** 190n);
      assert.equal(result.projectedCoreOutputs[0].amount, 2n ** 200n);
      assert.equal(result.projectedCoreOutputs[1].kind, 1);
    }
    if ("netCygldOut" in result) assert.equal(result.netCygldOut, 2n ** 210n);
    if ("grossCygldIn" in result) assert.equal(result.grossCygldIn, 2n ** 210n);
  }
});

test("same-origin preview carries lossless input and cancellation, without browser credentials", async () => {
  const request = { mode: "issue-exact-in" as const, maximumAmountsIn: [String(2n ** 200n), "17"] };
  const signal = new AbortController().signal;
  const result = await fetchBasketPreview<"issue-exact-in">(request, signal, (async (url, init) => {
    assert.equal(url, "/api/quotes/basket-preview"); assert.equal(init?.signal, signal);
    assert.equal(init?.cache, "no-store"); assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.deepEqual(JSON.parse(String(init?.body)), request);
    return Response.json(values[0]);
  }) as typeof fetch);
  assert.equal(result.netCygldOut, 2n ** 210n);
});

test("failed or malformed preview never invents a quote or falls back to RPC", async () => {
  let calls = 0;
  await assert.rejects(fetchBasketPreview<"issue-exact-out">({ mode: "issue-exact-out", netCygldOut: "1" }, undefined,
    (async (url) => { calls++; assert.equal(url, "/api/quotes/basket-preview"); return new Response("private detail", { status: 503 }); }) as typeof fetch),
    { code: "quote-service-unavailable" });
  assert.equal(calls, 1);
  const bad = structuredClone(values[0]); bad.result.fees.helperFeeCygld = "not-an-integer";
  assert.throws(() => basketPreviewResult(bad));
});

test("known protocol error is specific without exposing provider text; an aborted response cannot publish state", async () => {
  await assert.rejects(fetchBasketPreview({ mode: "issue-exact-out", netCygldOut: "1" }, undefined,
    (async () => Response.json({ code: "issuance-cap-exceeded", error: "private URL" }, { status: 503 })) as typeof fetch),
    error => error instanceof QuotePreviewError && !error.message.includes("private"));
  clearQuoteModels();
  const abort = new AbortController(); abort.abort();
  await fetchBasketPreview({ mode: "issue-exact-out", netCygldOut: "1" }, abort.signal,
    (async () => Response.json({ ...values[1], basketModel: { context, state: {} } })) as typeof fetch);
  assert.equal(getProtocolModel(), undefined);
  receiveProtocolModel(null);
});
