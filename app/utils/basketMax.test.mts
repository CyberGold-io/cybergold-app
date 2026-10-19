import assert from "node:assert/strict";
import test from "node:test";
import { fetchBasketMax, type BasketMax } from "./basketMax.ts";

const driverToken = `0x${"a".repeat(40)}`;
const request = { driverToken, maximumAmountsIn: [String(2n ** 200n), "17"] };
const maximum: BasketMax = {
  context: { chainId: 31338, blockNumber: "101", blockHash: `0x${"b".repeat(64)}`, observedAt: "2026-10-19T00:00:00Z" },
  helpers: `0x${"c".repeat(40)}`, orderedCoreAssets: [driverToken, `0x${"d".repeat(40)}`],
  driverToken, driverAmount: String(2n ** 180n), maximumAmountsIn: [String(2n ** 180n), "7"], netCygldOut: "19",
};

test("basket MAX delegates the lossless wallet budget and cancellation to the fixed Backend API", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(await fetchBasketMax(request, signal, (async (url, init) => {
    assert.equal(url, "/api/quotes/basket-max");
    assert.equal(init?.signal, signal);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    assert.deepEqual(JSON.parse(String(init?.body)), request);
    return Response.json(maximum);
  }) as typeof fetch), maximum);
});

test("unavailable basket MAX remains an ordinary quote error without a local fallback", async () => {
  let calls = 0;
  await assert.rejects(fetchBasketMax(request, undefined, (async () => {
    calls++;
    return Response.json({ code: "rpc-timeout", error: "private provider detail" }, { status: 503 });
  }) as typeof fetch), { code: "rpc-timeout" });
  assert.equal(calls, 1);
});
