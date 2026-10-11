import assert from "node:assert/strict";
import test from "node:test";
import { createQuotePoolCacheClient } from "./quotePoolCacheClient.ts";
import type { PoolCacheObservation } from "../types.ts";

const tokenA = `0x${"a".repeat(40)}` as const, tokenB = `0x${"b".repeat(40)}` as const;

test("generic cache API carries full V4 identity/state and preserves ordinary legacy calls", async () => {
  const entry: PoolCacheObservation = { chainId: 1, dex: "uniswap_v4", protocol: "v4", tokenA, tokenB,
    fee: 100, exists: true, poolId: `0x${"c".repeat(64)}`, poolManager: `0x${"d".repeat(40)}`,
    tickSpacing: 1, hooks: `0x${"0".repeat(40)}`, activeLiquidityRaw: String(2n ** 110n),
    marginalPrice: { numerator: String(2n ** 200n), denominator: String(2n ** 192n) },
    bitmapWords: [{ wordPosition: -1, bitmap: String(2n ** 250n) }] };
  const bodies: unknown[] = [];
  const client = createQuotePoolCacheClient((async (url, init) => {
    assert.equal(url, "/api/quote-pool-cache");
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    return Response.json(body.action === "list-pools" ? { entries: [{ ...entry, token0: tokenA, token1: tokenB }] } : { ok: true });
  }) as typeof fetch);
  const lookup = { chainId: 1, dex: "uniswap" as const, pairs: [{ tokenA, tokenB, protocol: "v4" as const,
    fee: 100, poolId: entry.poolId, poolManager: entry.poolManager, tickSpacing: 1, hooks: entry.hooks }] };
  const rows = await client.listPools(lookup);
  assert.equal(rows[0].poolId, entry.poolId); assert.deepEqual(rows[0].bitmapWords, entry.bitmapWords);
  assert.equal(rows[0].activeLiquidityRaw, String(2n ** 110n)); assert.equal(rows[0].token0BalanceRaw, undefined);
  await client.recordObservations({ entries: [entry] });
  await client.listPools({ chainId: 1, dex: "uniswap_v3", pairs: [{ tokenA, tokenB }] });
  assert.deepEqual(bodies, [{ action: "list-pools", ...lookup }, { action: "record-observations", entries: [entry] },
    { action: "list-pools", chainId: 1, dex: "uniswap_v3", pairs: [{ tokenA, tokenB }] }]);
});

test("cache outages remain optional and empty observations issue no write", async () => {
  let calls = 0;
  const client = createQuotePoolCacheClient((async () => { calls++; throw new Error("offline"); }) as typeof fetch);
  await client.recordObservations({ entries: [] }); assert.equal(calls, 0);
  assert.deepEqual(await client.listPools({ chainId: 1, dex: "uniswap", pairs: [{ tokenA, tokenB }] }), []);
  assert.equal(calls, 1);
});
