import type { Address } from "viem";

import type { PoolCacheObservation, QuoteDex } from "../types";

export function normalizePoolPair(params: {
  tokenA: Address;
  tokenB: Address;
}) {
  const tokenA = params.tokenA.toLowerCase() as Address;
  const tokenB = params.tokenB.toLowerCase() as Address;
  return tokenA <= tokenB
    ? { token0: tokenA, token1: tokenB }
    : { token0: tokenB, token1: tokenA };
}

export function buildPoolCacheEntryKey(params: {
  chainId: number;
  dex: QuoteDex;
  tokenA: Address;
  tokenB: Address;
  fee: number;
  poolId?: string;
  poolManager?: string;
  id?: string;
  tickSpacing?: number;
  hooks?: string;
  poolKey?: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
}) {
  const { token0, token1 } = normalizePoolPair({
    tokenA: params.tokenA,
    tokenB: params.tokenB,
  });

  const pair: (string | number)[] = [
    params.chainId,
    params.dex,
    token0,
    token1,
    params.fee,
  ];
  if (params.dex === "uniswap_v4") pair.push(
    params.poolManager?.toLowerCase() ?? "default",
    (params.poolId ?? params.id)?.toLowerCase() ?? "",
    params.tickSpacing ?? params.poolKey?.tickSpacing ?? "",
    (params.hooks ?? params.poolKey?.hooks)?.toLowerCase() ?? "",
  );
  return pair.join(":");
}

export function mergePoolObservation(
  current: PoolCacheObservation | undefined,
  next: PoolCacheObservation
) {
  if (!current) {
    return next;
  }

  const merged = {
    ...current,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)),
    exists: current.exists || next.exists,
    poolAddress: next.poolAddress ?? current.poolAddress,
    quoteSucceeded: Boolean(current.quoteSucceeded || next.quoteSucceeded),
  } satisfies PoolCacheObservation;

  const activeLiquidityRaw = next.activeLiquidityRaw ?? current.activeLiquidityRaw;
  const sqrtPriceX96Raw = next.sqrtPriceX96Raw ?? current.sqrtPriceX96Raw;
  const tick = next.tick ?? current.tick;
  const token0BalanceRaw = next.token0BalanceRaw ?? current.token0BalanceRaw;
  const token1BalanceRaw = next.token1BalanceRaw ?? current.token1BalanceRaw;

  return {
    ...merged,
    ...(activeLiquidityRaw !== undefined ? { activeLiquidityRaw } : {}),
    ...(sqrtPriceX96Raw !== undefined ? { sqrtPriceX96Raw } : {}),
    ...(tick !== undefined ? { tick } : {}),
    ...(token0BalanceRaw !== undefined ? { token0BalanceRaw } : {}),
    ...(token1BalanceRaw !== undefined ? { token1BalanceRaw } : {}),
  } satisfies PoolCacheObservation;
}
