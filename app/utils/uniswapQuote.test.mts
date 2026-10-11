import assert from "node:assert/strict";
import test from "node:test";
import { fetchUniswapQuote } from "./uniswapQuote.ts";

test("exact input/output transport preserves path bytes, wide amounts and zero quotes", async () => {
  const path = `0x${"ab".repeat(20)}000bb8${"cd".repeat(20)}` as const;
  for (const mode of ["exact-in", "exact-out"] as const) {
    for (const output of [0n, 2n ** 210n]) {
      const request = { mode, path, amount: String(2n ** 200n) };
      const quote = await fetchUniswapQuote(request, undefined, (async (url, init) => {
        assert.equal(url, "/api/quotes/uniswap");
        assert.deepEqual(JSON.parse(String(init?.body)), request);
        assert.equal(init?.cache, "no-store");
        assert.equal(new Headers(init?.headers).get("authorization"), null);
        return Response.json({ result: { amount: String(output) } });
      }) as typeof fetch);
      assert.equal(quote, output);
    }
  }
});

test("quote cancellation is forwarded and failures have one attempt without an RPC fallback", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(fetchUniswapQuote({ mode: "exact-in", path: "0x", amount: "1" }, controller.signal,
    (async (_url, init) => {
      calls++;
      assert.equal(init?.signal, controller.signal);
      return new Response("internal provider credential", { status: 503 });
    }) as typeof fetch), /Uniswap quotes are temporarily unavailable\./);
  assert.equal(calls, 1);
});
