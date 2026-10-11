import { publicEnv } from "../config/publicEnvironment.ts";
import type { Address } from "viem";

import type {
  PoolCacheObservation,
  QuoteMode,
  QuotePoolCacheClient,
  QuoteRoute,
  QuoteTarget,
  RouteQuoteCandidate,
  RouteSearchProgress,
} from "../types";
import {
  buildPoolCacheEntryKey,
  mergePoolObservation,
  normalizePoolPair,
} from "./poolCachePair.ts";
import { encodeV3PathDirect, encodeV3PathViaWeth } from "./encodeV3Path.ts";
import { considerCandidate, tryPathQuote } from "./quoteBuilder.ts";
import { fetchRouteQuotes } from "./routeSearch.ts";

type QuoteExactInputFn = (args: {
  path: `0x${string}`;
  amountIn: bigint;
}) => Promise<unknown>;

type QuoteExactOutputFn = (args: {
  path: `0x${string}`;
  amountOut: bigint;
}) => Promise<unknown>;

type GetPoolAddressFn = (args: {
  tokenA: Address;
  tokenB: Address;
  fee: number;
}) => Promise<Address | undefined>;

type PoolLiquiditySnapshot = {
  poolAddress: Address;
  activeLiquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  token0Balance: bigint;
  token1Balance: bigint;
  observedAt?: string;
};

type GetPoolSnapshotFn = (args: {
  poolAddress: Address;
  token0: Address;
  token1: Address;
  fee: number;
}) => Promise<PoolLiquiditySnapshot | undefined>;

type DebugLogger = (message: string, payload: Record<string, unknown>) => void;

type PoolRequirement = {
  tokenA: Address;
  tokenB: Address;
  fee: number;
};

type RouteProbeCandidate = {
  path: `0x${string}`;
  route: QuoteRoute;
  feeInfo: string;
  totalFee: number;
  pools: readonly PoolRequirement[];
};

type CachedPoolState = {
  exists: boolean;
  poolAddress?: Address;
  successCount: number;
  activeLiquidityRaw?: string;
  sqrtPriceX96Raw?: string;
  tick?: number;
  token0BalanceRaw?: string;
  token1BalanceRaw?: string;
  liquidityCheckedAt?: string;
  lastCheckedAt?: string;
};

export type RouteQuotePoolContext = {
  poolStateByKey: Map<string, CachedPoolState>;
  observationsByKey: Map<string, PoolCacheObservation>;
};

const QUOTE_DEX = "uniswap_v3" as const;
const DEFAULT_POOL_LIQUIDITY_CACHE_TTL_MS = 15 * 60 * 1000;
const configuredPoolLiquidityCacheTtlMs = Number(
  publicEnv.NEXT_PUBLIC_QUOTE_POOL_LIQUIDITY_CACHE_TTL_MS
);
const POOL_LIQUIDITY_CACHE_TTL_MS =
  Number.isFinite(configuredPoolLiquidityCacheTtlMs) &&
  configuredPoolLiquidityCacheTtlMs >= 0
    ? configuredPoolLiquidityCacheTtlMs
    : DEFAULT_POOL_LIQUIDITY_CACHE_TTL_MS;

function normalizeFeeCandidates(values: readonly number[]) {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function buildProbeCandidates(params: {
  target: QuoteTarget;
  mode: QuoteMode;
  wethAddress: Address;
  feeCandidates: readonly number[];
  viaWethFeeCandidates: readonly number[];
}) {
  const {
    target,
    mode,
    wethAddress,
    feeCandidates,
    viaWethFeeCandidates,
  } = params;

  const candidatesByPath = new Map<string, RouteProbeCandidate>();
  const addCandidate = (candidate: RouteProbeCandidate) => {
    const key = candidate.path.toLowerCase();
    if (!candidatesByPath.has(key)) {
      candidatesByPath.set(key, candidate);
    }
  };

  for (const fee of normalizeFeeCandidates(feeCandidates)) {
    addCandidate({
      path: encodeV3PathDirect({
        tokenIn:
          mode === "exact-in" ? target.inputAsset : target.outputAsset,
        tokenOut:
          mode === "exact-in" ? target.outputAsset : target.inputAsset,
        fee,
      }),
      route: "direct",
      feeInfo: `${fee}`,
      totalFee: fee,
      pools: [
        {
          tokenA: target.inputAsset,
          tokenB: target.outputAsset,
          fee,
        },
      ],
    });
  }

  if (
    target.inputAsset.toLowerCase() !== wethAddress.toLowerCase() &&
    target.outputAsset.toLowerCase() !== wethAddress.toLowerCase()
  ) {
    for (const feeInToWeth of normalizeFeeCandidates(viaWethFeeCandidates)) {
      for (const feeWethToOut of normalizeFeeCandidates(viaWethFeeCandidates)) {
        addCandidate({
          path:
            mode === "exact-in"
              ? encodeV3PathViaWeth({
                  tokenIn: target.inputAsset,
                  tokenOut: target.outputAsset,
                  weth: wethAddress,
                  feeInToWeth,
                  feeWethToOut,
                })
              : encodeV3PathViaWeth({
                  tokenIn: target.outputAsset,
                  tokenOut: target.inputAsset,
                  weth: wethAddress,
                  feeInToWeth: feeWethToOut,
                  feeWethToOut: feeInToWeth,
                }),
          route: "viaWeth",
          feeInfo: `${feeInToWeth}/${feeWethToOut}`,
          totalFee: feeInToWeth + feeWethToOut,
          pools: [
            {
              tokenA: target.inputAsset,
              tokenB: wethAddress,
              fee: feeInToWeth,
            },
            {
              tokenA: wethAddress,
              tokenB: target.outputAsset,
              fee: feeWethToOut,
            },
          ],
        });
      }
    }
  }

  return Array.from(candidatesByPath.values()).sort((left, right) => {
    if (left.totalFee !== right.totalFee) {
      return left.totalFee - right.totalFee;
    }
    if (left.route !== right.route) {
      return left.route === "direct" ? -1 : 1;
    }
    return left.feeInfo.localeCompare(right.feeInfo);
  });
}

function buildPoolStateKey(params: {
  chainId: number;
  tokenA: Address;
  tokenB: Address;
  fee: number;
}) {
  return buildPoolCacheEntryKey({
    chainId: params.chainId,
    dex: QUOTE_DEX,
    tokenA: params.tokenA,
    tokenB: params.tokenB,
    fee: params.fee,
  });
}

function mergeObservationIntoMap(
  map: Map<string, PoolCacheObservation>,
  observation: PoolCacheObservation
) {
  const key = buildPoolCacheEntryKey(observation);
  map.set(key, mergePoolObservation(map.get(key), observation));
}

function createRouteQuotePoolContext(): RouteQuotePoolContext {
  return {
    poolStateByKey: new Map<string, CachedPoolState>(),
    observationsByKey: new Map<string, PoolCacheObservation>(),
  };
}

function buildPoolLookupPairs(candidates: readonly RouteProbeCandidate[]) {
  return Array.from(
    new Map(
      candidates.flatMap((candidate) =>
        candidate.pools.map((pool) => {
          const tokens = [pool.tokenA.toLowerCase(), pool.tokenB.toLowerCase()]
            .sort()
            .join(":");
          return [
            tokens,
            {
              tokenA: pool.tokenA,
              tokenB: pool.tokenB,
            },
          ] as const;
        })
      )
    ).values()
  );
}

function buildUniquePoolRequirements(params: {
  chainId: number;
  candidates: readonly RouteProbeCandidate[];
}) {
  const { chainId, candidates } = params;
  return Array.from(
    new Map(
      candidates.flatMap((candidate) =>
        candidate.pools.map((pool) => {
          const key = buildPoolStateKey({
            chainId,
            tokenA: pool.tokenA,
            tokenB: pool.tokenB,
            fee: pool.fee,
          });
          return [key, pool] as const;
        })
      )
    ).entries()
  );
}

function mergeCachedPoolsIntoContext(params: {
  chainId: number;
  poolContext: RouteQuotePoolContext;
  cachedPools: Awaited<ReturnType<QuotePoolCacheClient["listPools"]>>;
}) {
  const { chainId, poolContext, cachedPools } = params;

  for (const cachedPool of cachedPools) {
    const key = buildPoolStateKey({
      chainId,
      tokenA: cachedPool.token0,
      tokenB: cachedPool.token1,
      fee: cachedPool.fee,
    });
    poolContext.poolStateByKey.set(key, {
      exists: cachedPool.exists,
      poolAddress: cachedPool.poolAddress,
      successCount: cachedPool.successCount ?? 0,
      activeLiquidityRaw: cachedPool.activeLiquidityRaw,
      sqrtPriceX96Raw: cachedPool.sqrtPriceX96Raw,
      tick: cachedPool.tick,
      token0BalanceRaw: cachedPool.token0BalanceRaw,
      token1BalanceRaw: cachedPool.token1BalanceRaw,
      liquidityCheckedAt: cachedPool.liquidityCheckedAt,
      lastCheckedAt: cachedPool.lastCheckedAt,
    });
  }
}

function hasFreshLiquiditySnapshot(poolState: CachedPoolState) {
  if (
    poolState.activeLiquidityRaw === undefined ||
    poolState.sqrtPriceX96Raw === undefined ||
    poolState.tick === undefined ||
    poolState.token0BalanceRaw === undefined ||
    poolState.token1BalanceRaw === undefined ||
    poolState.liquidityCheckedAt === undefined
  ) {
    return false;
  }

  const checkedAtMs = Date.parse(poolState.liquidityCheckedAt);
  if (!Number.isFinite(checkedAtMs)) {
    return false;
  }

  return Date.now() - checkedAtMs <= POOL_LIQUIDITY_CACHE_TTL_MS;
}

function hasKnownUnusableLiquidity(poolState: CachedPoolState) {
  if (!hasFreshLiquiditySnapshot(poolState)) {
    return false;
  }

  if (
    poolState.activeLiquidityRaw === undefined ||
    poolState.token0BalanceRaw === undefined ||
    poolState.token1BalanceRaw === undefined
  ) {
    return false;
  }

  return (
    poolState.activeLiquidityRaw === "0" ||
    poolState.token0BalanceRaw === "0" ||
    poolState.token1BalanceRaw === "0"
  );
}

function getPoolTokenBalance(params: {
  poolState: CachedPoolState;
  tokenA: Address;
  tokenB: Address;
  token: Address;
}) {
  const {
    poolState,
    tokenA,
    tokenB,
    token,
  } = params;
  if (!hasFreshLiquiditySnapshot(poolState)) {
    return undefined;
  }
  if (
    poolState.token0BalanceRaw === undefined ||
    poolState.token1BalanceRaw === undefined
  ) {
    return undefined;
  }

  const normalized = normalizePoolPair({
    tokenA,
    tokenB,
  });
  const normalizedToken = token.toLowerCase();
  if (normalizedToken === normalized.token0.toLowerCase()) {
    return BigInt(poolState.token0BalanceRaw);
  }
  if (normalizedToken === normalized.token1.toLowerCase()) {
    return BigInt(poolState.token1BalanceRaw);
  }

  return undefined;
}

function getKnownExactOutOutputBalance(params: {
  chainId: number;
  target: QuoteTarget;
  candidate: RouteProbeCandidate;
  poolContext: RouteQuotePoolContext;
  wethAddress: Address;
}) {
  const {
    chainId,
    target,
    candidate,
    poolContext,
    wethAddress,
  } = params;

  const resolvePoolState = (pool: PoolRequirement) =>
    poolContext.poolStateByKey.get(
      buildPoolStateKey({
        chainId,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        fee: pool.fee,
      })
    );

  if (candidate.route === "direct") {
    const directPool = candidate.pools[0];
    if (!directPool) {
      return undefined;
    }
    const poolState = resolvePoolState(directPool);
    if (!poolState) {
      return undefined;
    }
    return getPoolTokenBalance({
      poolState,
      tokenA: directPool.tokenA,
      tokenB: directPool.tokenB,
      token: target.outputAsset,
    });
  }

  const finalHopPool = candidate.pools.find((pool) => {
    const left = pool.tokenA.toLowerCase();
    const right = pool.tokenB.toLowerCase();
    const weth = wethAddress.toLowerCase();
    const output = target.outputAsset.toLowerCase();
    return (
      (left === weth && right === output) ||
      (left === output && right === weth)
    );
  });

  if (!finalHopPool) {
    return undefined;
  }

  const poolState = resolvePoolState(finalHopPool);
  if (!poolState) {
    return undefined;
  }

  return getPoolTokenBalance({
    poolState,
    tokenA: finalHopPool.tokenA,
    tokenB: finalHopPool.tokenB,
    token: target.outputAsset,
  });
}

async function refreshPoolLiquiditySnapshots(params: {
  chainId: number;
  candidates: readonly RouteProbeCandidate[];
  poolContext: RouteQuotePoolContext;
  getPoolSnapshot?: GetPoolSnapshotFn;
  debug?: DebugLogger;
}) {
  const { chainId, candidates, poolContext, getPoolSnapshot, debug } = params;
  if (!getPoolSnapshot) {
    return;
  }

  const poolsToRefresh = buildUniquePoolRequirements({ chainId, candidates })
    .map(([key, pool]) => {
      const poolState = poolContext.poolStateByKey.get(key);
      if (
        !poolState?.exists ||
        !poolState.poolAddress ||
        hasFreshLiquiditySnapshot(poolState)
      ) {
        return undefined;
      }

      const normalized = normalizePoolPair({
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
      });

      return {
        key,
        pool,
        poolState,
        token0: normalized.token0,
        token1: normalized.token1,
      };
    })
    .filter(
      (
        item
      ): item is {
        key: string;
        pool: PoolRequirement;
        poolState: CachedPoolState;
        token0: Address;
        token1: Address;
      } => item !== undefined
    );

  await Promise.all(
    poolsToRefresh.map(async (item) => {
      try {
        const snapshot = await getPoolSnapshot({
          poolAddress: item.poolState.poolAddress as Address,
          token0: item.token0,
          token1: item.token1,
          fee: item.pool.fee,
        });

        if (!snapshot) {
          return;
        }

        const nextState: CachedPoolState = {
          ...item.poolState,
          activeLiquidityRaw: snapshot.activeLiquidity.toString(),
          sqrtPriceX96Raw: snapshot.sqrtPriceX96.toString(),
          tick: snapshot.tick,
          token0BalanceRaw: snapshot.token0Balance.toString(),
          token1BalanceRaw: snapshot.token1Balance.toString(),
          liquidityCheckedAt: snapshot.observedAt ?? new Date().toISOString(),
        };
        poolContext.poolStateByKey.set(item.key, nextState);

        mergeObservationIntoMap(poolContext.observationsByKey, {
          chainId,
          dex: QUOTE_DEX,
          tokenA: item.pool.tokenA,
          tokenB: item.pool.tokenB,
          fee: item.pool.fee,
          poolAddress: item.poolState.poolAddress,
          exists: true,
          activeLiquidityRaw: nextState.activeLiquidityRaw,
          sqrtPriceX96Raw: nextState.sqrtPriceX96Raw,
          tick: nextState.tick,
          token0BalanceRaw: nextState.token0BalanceRaw,
          token1BalanceRaw: nextState.token1BalanceRaw,
        });
      } catch (error) {
        debug?.("pool-liquidity-lookup-failed", {
          tokenA: item.pool.tokenA,
          tokenB: item.pool.tokenB,
          fee: item.pool.fee,
          poolAddress: item.poolState.poolAddress,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );
}

async function resolveCandidatePools(params: {
  chainId: number;
  candidates: readonly RouteProbeCandidate[];
  getPoolAddress: GetPoolAddressFn;
  getPoolSnapshot?: GetPoolSnapshotFn;
  poolContext: RouteQuotePoolContext;
  poolCacheClient?: QuotePoolCacheClient;
  loadCache: boolean;
  debug?: DebugLogger;
}) {
  const {
    chainId,
    candidates,
    getPoolAddress,
    getPoolSnapshot,
    poolContext,
    poolCacheClient,
    loadCache,
    debug,
  } = params;

  if (candidates.length === 0) {
    return;
  }

  if (poolCacheClient && loadCache) {
    const cachedPools = await poolCacheClient.listPools({
      chainId,
      dex: QUOTE_DEX,
      pairs: buildPoolLookupPairs(candidates),
    });

    mergeCachedPoolsIntoContext({
      chainId,
      poolContext,
      cachedPools,
    });
  }

  const unresolvedPools = buildUniquePoolRequirements({
    chainId,
    candidates,
  }).filter(([key]) => !poolContext.poolStateByKey.has(key));

  await Promise.all(
    unresolvedPools.map(async ([key, pool]) => {
      try {
        const poolAddress = await getPoolAddress({
          tokenA: pool.tokenA,
          tokenB: pool.tokenB,
          fee: pool.fee,
        });

        poolContext.poolStateByKey.set(key, {
          exists: poolAddress !== undefined,
          poolAddress,
          successCount: 0,
        });

        mergeObservationIntoMap(poolContext.observationsByKey, {
          chainId,
          dex: QUOTE_DEX,
          tokenA: pool.tokenA,
          tokenB: pool.tokenB,
          fee: pool.fee,
          poolAddress,
          exists: poolAddress !== undefined,
        });
      } catch (error) {
        debug?.("pool-lookup-failed", {
          tokenA: pool.tokenA,
          tokenB: pool.tokenB,
          fee: pool.fee,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })
  );

  await refreshPoolLiquiditySnapshots({
    chainId,
    candidates,
    poolContext,
    getPoolSnapshot,
    debug,
  });
}

export function countPotentialRouteQuoteCandidates(params: {
  target: QuoteTarget;
  mode: QuoteMode;
  wethAddress: Address;
  feeCandidates: readonly number[];
  viaWethFeeCandidates: readonly number[];
}) {
  return buildProbeCandidates(params).length;
}

export async function prepareRouteQuotePoolContext(params: {
  chainId: number;
  targets: readonly QuoteTarget[];
  mode: QuoteMode;
  wethAddress: Address;
  feeCandidates: readonly number[];
  viaWethFeeCandidates: readonly number[];
  getPoolAddress: GetPoolAddressFn;
  getPoolSnapshot?: GetPoolSnapshotFn;
  poolCacheClient?: QuotePoolCacheClient;
  debug?: DebugLogger;
}) {
  const {
    chainId,
    targets,
    mode,
    wethAddress,
    feeCandidates,
    viaWethFeeCandidates,
    getPoolAddress,
    getPoolSnapshot,
    poolCacheClient,
    debug,
  } = params;

  const poolContext = createRouteQuotePoolContext();
  const candidates = targets.flatMap((target) =>
    buildProbeCandidates({
      target,
      mode,
      wethAddress,
      feeCandidates,
      viaWethFeeCandidates,
    })
  );

  await resolveCandidatePools({
    chainId,
    candidates,
    getPoolAddress,
    getPoolSnapshot,
    poolContext,
    poolCacheClient,
    loadCache: true,
    debug,
  });

  return poolContext;
}

export async function recordRouteQuotePoolObservations(params: {
  poolContext: RouteQuotePoolContext;
  poolCacheClient?: QuotePoolCacheClient;
}) {
  const { poolContext, poolCacheClient } = params;

  if (!poolCacheClient || poolContext.observationsByKey.size === 0) {
    return;
  }

  await poolCacheClient.recordObservations({
    entries: Array.from(poolContext.observationsByKey.values()),
  });
}

async function selectLegacyRouteQuote(params: {
  chainId: number;
  target: QuoteTarget;
  mode: QuoteMode;
  wethAddress: Address;
  feeCandidates: readonly number[];
  viaWethFeeCandidates: readonly number[];
  quoteExactInput: QuoteExactInputFn;
  quoteExactOutput: QuoteExactOutputFn;
  getPoolAddress: GetPoolAddressFn;
  getPoolSnapshot?: GetPoolSnapshotFn;
  poolCacheClient?: QuotePoolCacheClient;
  poolContext?: RouteQuotePoolContext;
  onProgress?: (progress: RouteSearchProgress) => void;
  onBestCandidate?: (candidate: RouteQuoteCandidate) => void;
  debug?: DebugLogger;
}): Promise<RouteQuoteCandidate | undefined> {
  const {
    chainId,
    target,
    mode,
    wethAddress,
    feeCandidates,
    viaWethFeeCandidates,
    quoteExactInput,
    quoteExactOutput,
    getPoolAddress,
    getPoolSnapshot,
    poolCacheClient,
    poolContext: providedPoolContext,
    onProgress,
    onBestCandidate,
    debug,
  } = params;

  const candidates = buildProbeCandidates({
    target,
    mode,
    wethAddress,
    feeCandidates,
    viaWethFeeCandidates,
  });
  const total = candidates.length;
  let completed = 0;
  let selectedBest: RouteQuoteCandidate | undefined;

  const notifyProgress = () => {
    onProgress?.({
      completed,
      total,
      percent: total === 0 ? 100 : Math.round((completed / total) * 100),
    });
  };

  notifyProgress();

  const poolContext = providedPoolContext ?? createRouteQuotePoolContext();
  await resolveCandidatePools({
    chainId,
    candidates,
    getPoolAddress,
    getPoolSnapshot,
    poolContext,
    poolCacheClient,
    loadCache: !providedPoolContext,
    debug,
  });

  const quoteResults = await Promise.all(
    candidates.map(async (candidate) => {
      const unavailablePool = candidate.pools.find((pool) => {
        const poolState = poolContext.poolStateByKey.get(
          buildPoolStateKey({
            chainId,
            tokenA: pool.tokenA,
            tokenB: pool.tokenB,
            fee: pool.fee,
          })
        );
        return (
          poolState?.exists === false ||
          (poolState !== undefined && hasKnownUnusableLiquidity(poolState))
        );
      });

      if (unavailablePool) {
        completed += 1;
        notifyProgress();
        const poolState = poolContext.poolStateByKey.get(
          buildPoolStateKey({
            chainId,
            tokenA: unavailablePool.tokenA,
            tokenB: unavailablePool.tokenB,
            fee: unavailablePool.fee,
          })
        );
        debug?.("skip-candidate-unavailable-pool", {
          route: candidate.route,
          feeInfo: candidate.feeInfo,
          poolFee: unavailablePool.fee,
          input: target.inputAsset,
          output: target.outputAsset,
          amount: target.amount.toString(),
          mode,
          reason:
            poolState?.exists === false
              ? "missing-pool"
              : "zero-liquidity-or-balance",
        });
        return undefined;
      }

      if (mode === "exact-out") {
        const knownOutputBalance = getKnownExactOutOutputBalance({
          chainId,
          target,
          candidate,
          poolContext,
          wethAddress,
        });
        if (
          knownOutputBalance !== undefined &&
          knownOutputBalance < target.amount
        ) {
          completed += 1;
          notifyProgress();
          debug?.("skip-candidate-insufficient-output-balance", {
            route: candidate.route,
            feeInfo: candidate.feeInfo,
            input: target.inputAsset,
            output: target.outputAsset,
            requestedOut: target.amount.toString(),
            knownOutputBalance: knownOutputBalance.toString(),
          });
          return undefined;
        }
      }

      try {
        const quote = await tryPathQuote({
          path: candidate.path,
          target,
          mode,
          quoteExactInput,
          quoteExactOutput,
          debug,
        });

        if (quote !== undefined) {
          return { candidate, quote };
        }
      } catch (error) {
        console.warn(
          `${candidate.route === "direct" ? "Direct" : "Via-WETH"} quote failed for fee tiers:`,
          candidate.feeInfo,
          {
            input: target.inputAsset,
            output: target.outputAsset,
            amount: target.amount.toString(),
            error,
          }
        );
      } finally {
        completed += 1;
        notifyProgress();
      }

      return undefined;
    })
  );

  for (const result of quoteResults) {
    if (result === undefined) {
      continue;
    }

    const { candidate, quote } = result;
    const nextBest = considerCandidate(selectedBest, mode, {
      path: candidate.path,
      quote,
      route: candidate.route,
      feeInfo: candidate.feeInfo,
    });
    const didImprove =
      !selectedBest ||
      nextBest.path !== selectedBest.path ||
      nextBest.quote !== selectedBest.quote;
    selectedBest = nextBest;

    for (const pool of candidate.pools) {
      const poolState = poolContext.poolStateByKey.get(
        buildPoolStateKey({
          chainId,
          tokenA: pool.tokenA,
          tokenB: pool.tokenB,
          fee: pool.fee,
        })
      );
      mergeObservationIntoMap(poolContext.observationsByKey, {
        chainId,
        dex: QUOTE_DEX,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
        fee: pool.fee,
        poolAddress: poolState?.poolAddress,
        exists: true,
        quoteSucceeded: true,
      });
    }

    if (didImprove) {
      onBestCandidate?.(nextBest);
    }
  }

  if (!providedPoolContext) {
    await recordRouteQuotePoolObservations({
      poolContext,
      poolCacheClient,
    });
  }

  onProgress?.({
    completed: total,
    total,
    percent: 100,
  });

  return selectedBest;
}

type BackendRouteQuoteParams = {
  chainId: number;
  target: QuoteTarget;
  mode: QuoteMode;
  adapter: string;
  scope?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: RouteSearchProgress) => void;
  onBestCandidate?: (candidate: RouteQuoteCandidate) => void;
};

/** Typed protocol plans use Backend discovery and SDK arithmetic; old V3 callers retain their callbacks. */
export async function selectBestRouteQuote(
  params: Parameters<typeof selectLegacyRouteQuote>[0] | BackendRouteQuoteParams,
): Promise<RouteQuoteCandidate | undefined> {
  if (!("adapter" in params)) return selectLegacyRouteQuote(params);
  const values = await fetchRouteQuotes({ targets: [params.target], mode: params.mode,
    adapter: params.adapter, scope: params.scope, signal: params.signal, fetchImpl: params.fetchImpl,
    onProgress: (_index, progress) => params.onProgress?.(progress),
    onCandidates: params.onBestCandidate ? candidates => {
      if (candidates[0]) params.onBestCandidate?.(candidates[0]);
    } : undefined,
  });
  if (values[0]) params.onBestCandidate?.(values[0]);
  return values[0];
}
