import type { components } from "../contracts/backend/http";
import type { MarketRoutePlan } from "./marketQuote.ts";

export type PoolIdentifier = components["schemas"]["PoolIdentifier"];
export type PoolSnapshot = components["schemas"]["PoolSnapshot"];
export type PoolCatalog = components["schemas"]["PoolCatalog"];
export type PoolRef = MarketRoutePlan["branches"][number]["hops"][number]["pool"];

export function poolIdentifierFromRef(pool: PoolRef): PoolIdentifier {
  const pair = { tokenA: pool.token0.address, tokenB: pool.token1.address, fee: pool.feePips };
  return pool.protocol === "v4"
    ? { ...pair, protocol: "v4", poolId: pool.id, poolManager: pool.poolManager,
      tickSpacing: pool.tickSpacing!, hooks: pool.hooks! }
    : { ...pair, protocol: pool.protocol, id: pool.id };
}

export function poolIdentifierBody(identifier: PoolIdentifier) {
  if (identifier.protocol === undefined)
    return { tokenA: identifier.tokenA, tokenB: identifier.tokenB, fee: identifier.fee };
  return { tokenA: identifier.tokenA, tokenB: identifier.tokenB, fee: identifier.fee,
    protocol: identifier.protocol, id: identifier.id,
    ...(identifier.protocol === "v4" ? { poolId: identifier.poolId, poolManager: identifier.poolManager,
      tickSpacing: identifier.tickSpacing, hooks: identifier.hooks } : {}) };
}

export async function fetchPoolSnapshot(identifier: PoolIdentifier, signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch): Promise<PoolSnapshot> {
  const response = await fetchImpl("/api/pools/snapshot", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify(poolIdentifierBody(identifier)),
  });
  if (!response.ok) throw new Error("Pool observations are temporarily unavailable.");
  return response.json();
}

export function poolSnapshotOptions(chainId: number, identifier: PoolIdentifier, fetchImpl: typeof fetch = fetch) {
  const [token0, token1] = [identifier.tokenA.toLowerCase(), identifier.tokenB.toLowerCase()].sort();
  const queryKey = identifier.protocol === undefined
    ? ["uniswap-pool-snapshot", chainId, token0, token1, identifier.fee]
    : ["uniswap-pool-snapshot", chainId, identifier.protocol, token0, token1, identifier.fee,
      ...(identifier.protocol === "v4" ? [identifier.tickSpacing, identifier.hooks.toLowerCase(),
        identifier.poolManager?.toLowerCase(), (identifier.poolId ?? identifier.id)?.toLowerCase()]
        : [identifier.id?.toLowerCase()])];
  return {
    queryKey,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchPoolSnapshot(identifier, signal, fetchImpl),
    staleTime: 5_000, gcTime: 60_000, retry: false as const,
  };
}

export function liquidityFromSnapshot(value: PoolSnapshot) {
  if (!value.exists) return undefined;
  const integer = (raw: string | undefined) => raw === undefined ? undefined : BigInt(raw);
  const protocol = value.protocol ?? ({ uniswap_v2: "v2", uniswap_v3: "v3", uniswap_v4: "v4" } as const)[value.dex];
  const singleton = protocol === "v4";
  return {
    protocol, id: value.id ?? value.poolId ?? value.poolAddress,
    poolAddress: singleton ? undefined : value.poolAddress as `0x${string}` | undefined,
    poolId: value.poolId ?? (singleton ? value.id : undefined),
    poolManager: value.poolManager ?? value.pool?.poolManager, poolKey: value.poolKey, pool: value.pool,
    activeLiquidity: integer(value.activeLiquidityRaw),
    sqrtPriceX96: integer(value.sqrtPriceX96Raw), tick: value.tick,
    reserve0: integer(value.reserve0Raw), reserve1: integer(value.reserve1Raw),
    // The singleton's ERC20 balances belong to every pool in the manager.
    token0Balance: singleton ? undefined : integer(value.token0BalanceRaw),
    token1Balance: singleton ? undefined : integer(value.token1BalanceRaw),
    marginalPrice: value.marginalPrice, lpFee: value.lpFee, protocolFee: value.protocolFee,
    ticks: value.ticks, bitmapWords: value.bitmapWords,
    observedAt: value.context.observedAt,
  };
}

export async function fetchPoolCatalog(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<PoolCatalog> {
  const response = await fetchImpl("/api/pools/catalog", { cache: "no-store", signal });
  if (!response.ok) throw new Error("Pool inventory is temporarily unavailable.");
  return response.json();
}

export function poolCatalogOptions(chainId: number, fetchImpl: typeof fetch = fetch) {
  return { queryKey: ["uniswap-pool-catalog", chainId],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchPoolCatalog(signal, fetchImpl),
    staleTime: 60_000, gcTime: 60_000, retry: false as const };
}
