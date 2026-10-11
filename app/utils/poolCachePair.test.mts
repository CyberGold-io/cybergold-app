import assert from "node:assert/strict";
import test from "node:test";
import type { PoolCacheObservation } from "../types.ts";

import {
  buildPoolCacheEntryKey,
  mergePoolObservation,
  normalizePoolPair,
} from "./poolCachePair.ts";

const TOKEN_A = "0x00000000000000000000000000000000000000aa";
const TOKEN_B = "0x00000000000000000000000000000000000000bb";

test("normalizePoolPair sorts addresses lexicographically and lowercases them", () => {
  const normalized = normalizePoolPair({
    tokenA: "0x00000000000000000000000000000000000000BB",
    tokenB: "0x00000000000000000000000000000000000000aa",
  });

  assert.deepEqual(normalized, {
    token0: TOKEN_A,
    token1: TOKEN_B,
  });
});

test("buildPoolCacheEntryKey is symmetric for token ordering", () => {
  const left = buildPoolCacheEntryKey({
    chainId: 31337,
    dex: "uniswap_v3",
    tokenA: TOKEN_A,
    tokenB: TOKEN_B,
    fee: 500,
  });
  const right = buildPoolCacheEntryKey({
    chainId: 31337,
    dex: "uniswap_v3",
    tokenA: TOKEN_B,
    tokenB: TOKEN_A,
    fee: 500,
  });

  assert.equal(left, right);
});

test("mergePoolObservation preserves positive existence and quote success", () => {
  const merged = mergePoolObservation(
    {
      chainId: 31337,
      dex: "uniswap_v3",
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      exists: false,
    },
    {
      chainId: 31337,
      dex: "uniswap_v3",
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: "0x0000000000000000000000000000000000000101",
      quoteSucceeded: true,
    }
  );

  assert.deepEqual(merged, {
    chainId: 31337,
    dex: "uniswap_v3",
    tokenA: TOKEN_A,
    tokenB: TOKEN_B,
    fee: 500,
    exists: true,
    poolAddress: "0x0000000000000000000000000000000000000101",
    quoteSucceeded: true,
  });
});

test("same-fee V4 cache entries keep their full PoolKey and manager identities separate", () => {
  const base = { chainId: 1, dex: "uniswap_v4" as const, tokenA: TOKEN_A, tokenB: TOKEN_B, fee: 100,
    poolManager: "0x0000000000000000000000000000000000000101", tickSpacing: 1,
    hooks: "0x0000000000000000000000000000000000000000" } satisfies Parameters<typeof buildPoolCacheEntryKey>[0];
  const key = buildPoolCacheEntryKey(base);
  assert.equal(key, buildPoolCacheEntryKey({ ...base, tokenA: TOKEN_B, tokenB: TOKEN_A }));
  for (const variant of [
    { ...base, tickSpacing: 10 },
    { ...base, hooks: "0x0000000000000000000000000000000000000202" },
    { ...base, poolManager: "0x0000000000000000000000000000000000000303" },
    { ...base, poolId: `0x${"a".repeat(64)}` },
  ]) assert.notEqual(buildPoolCacheEntryKey(variant), key);
  assert.notEqual(buildPoolCacheEntryKey({ ...base, dex: "uniswap_v2" }), key);
  assert.notEqual(buildPoolCacheEntryKey({ ...base, dex: "uniswap_v3" }), key);
});

test("partial V4 cache updates retain typed identity, marginal price and wide coverage", () => {
  const identity = { poolId: `0x${"a".repeat(64)}`, poolManager: `0x${"b".repeat(40)}`,
    poolKey: { currency0: TOKEN_A, currency1: TOKEN_B, fee: 100, tickSpacing: 1, hooks: `0x${"0".repeat(40)}` } };
  const current = { ...identity, chainId: 1, dex: "uniswap_v4" as const,
    tokenA: TOKEN_A, tokenB: TOKEN_B, fee: 100, exists: true,
    marginalPrice: { numerator: String(2n ** 200n), denominator: String(2n ** 192n) },
    bitmapWords: [{ wordPosition: -1, bitmap: String(2n ** 250n) }], lpFee: 100 } satisfies PoolCacheObservation;
  const value = mergePoolObservation(current, { chainId: 1, dex: "uniswap_v4", tokenA: TOKEN_A,
    tokenB: TOKEN_B, fee: 100, exists: true, quoteSucceeded: true, lpFee: 150, activeLiquidityRaw: String(2n ** 100n) });
  assert.deepEqual(value.poolKey, identity.poolKey); assert.equal(value.poolId, identity.poolId);
  assert.deepEqual(value.marginalPrice, current.marginalPrice); assert.deepEqual(value.bitmapWords, current.bitmapWords);
  assert.equal(value.lpFee, 150); assert.equal(value.activeLiquidityRaw, String(2n ** 100n));
  assert.equal(value.token0BalanceRaw, undefined);
});
