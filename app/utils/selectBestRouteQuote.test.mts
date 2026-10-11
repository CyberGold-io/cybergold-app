import assert from "node:assert/strict";
import test from "node:test";

import type {
  CachedPoolCandidate,
  PoolCacheObservation,
  QuotePoolCacheClient,
  QuoteTarget,
} from "../types.ts";
import { normalizePoolPair } from "./poolCachePair.ts";
import type { MarketRoutePlan } from "./marketQuote.ts";
import { encodeV3PathDirect, encodeV3PathViaWeth } from "./encodeV3Path.ts";
import {
  prepareRouteQuotePoolContext,
  recordRouteQuotePoolObservations,
  selectBestRouteQuote,
} from "./selectBestRouteQuote.ts";

const TOKEN_A = "0x00000000000000000000000000000000000000aa";
const TOKEN_B = "0x00000000000000000000000000000000000000bb";
const TOKEN_D = "0x00000000000000000000000000000000000000dd";
const WETH = "0x00000000000000000000000000000000000000cc";
const POOL_1 = "0x0000000000000000000000000000000000000101";
const POOL_2 = "0x0000000000000000000000000000000000000202";
const POOL_3 = "0x0000000000000000000000000000000000000303";
const POOL_4 = "0x0000000000000000000000000000000000000404";
const POOL_5 = "0x0000000000000000000000000000000000000505";

test("generic route selection retains typed plans and wide quotes without V3 path callbacks or balance guesses", async () => {
  const adapter = POOL_1, amount = 2n ** 200n;
  for (const mode of ["exact-in", "exact-out"] as const) {
    const plan: MarketRoutePlan = { version: 1, executionContext: "helpers-core",
      mode: mode === "exact-in" ? "exactIn" : "exactOut", tokenIn: TOKEN_A, tokenOut: TOKEN_B,
      inputAmount: String(amount), outputAmount: String(amount + 3n), limit: String(amount), deadline: "1792000000",
      branches: [{ amountIn: String(amount), hops: [{ zeroForOne: true, pool: {
        id: `0x${"d".repeat(64)}`, protocol: "v4", poolManager: POOL_2, feePips: 100,
        tickSpacing: 1, hooks: `0x${"0".repeat(40)}`,
        token0: { address: TOKEN_A, decimals: 18, chainId: 1 },
        token1: { address: TOKEN_B, decimals: 18, chainId: 1 },
      } }] }] };
    const selected = await selectBestRouteQuote({ chainId: 1, target: { inputAsset: TOKEN_A, outputAsset: TOKEN_B, amount },
      mode, adapter, fetchImpl: (async (url, init) => {
        assert.equal(url, "/api/quotes/routes");
        assert.deepEqual(JSON.parse(String(init?.body)), { mode, adapter,
          targets: [{ inputAsset: TOKEN_A, outputAsset: TOKEN_B, amount: String(amount) }] });
        return Response.json({ results: [{ attempted: 2, best: { path: "0x", quote: String(amount + 3n),
          route: "direct", feeInfo: "100", routePlan: plan } }] });
      }) as typeof fetch });
    assert.equal(selected?.quote, amount + 3n); assert.equal(selected?.path, "0x");
    assert.deepEqual(selected?.routePlan, plan);
  }
});

function createCachedPool(params: {
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  fee: number;
  exists: boolean;
  poolAddress?: `0x${string}`;
  successCount?: number;
  activeLiquidityRaw?: string;
  sqrtPriceX96Raw?: string;
  tick?: number;
  token0BalanceRaw?: string;
  token1BalanceRaw?: string;
  liquidityCheckedAt?: string;
}) {
  const { token0, token1 } = normalizePoolPair({
    tokenA: params.tokenA,
    tokenB: params.tokenB,
  });

  return {
    dex: "uniswap_v3",
    token0,
    token1,
    fee: params.fee,
    exists: params.exists,
    poolAddress: params.poolAddress,
    successCount: params.successCount ?? 0,
    activeLiquidityRaw: params.activeLiquidityRaw,
    sqrtPriceX96Raw: params.sqrtPriceX96Raw,
    tick: params.tick,
    token0BalanceRaw: params.token0BalanceRaw,
    token1BalanceRaw: params.token1BalanceRaw,
    liquidityCheckedAt: params.liquidityCheckedAt,
  } satisfies CachedPoolCandidate;
}

function createPoolCacheClient(cachedPools: CachedPoolCandidate[] = []) {
  const listLookups: unknown[] = [];
  const recordedObservations: PoolCacheObservation[][] = [];

  return {
    client: {
      async listPools(params) {
        listLookups.push(params);
        return cachedPools;
      },
      async recordObservations(params) {
        recordedObservations.push([...params.entries]);
      },
    } satisfies QuotePoolCacheClient,
    listLookups,
    recordedObservations,
  };
}

test("selectBestRouteQuote skips known missing pools, resolves unknown pools, and keeps the best exact-in quote", async () => {
  const direct500 = encodeV3PathDirect({
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    fee: 500,
  });
  const direct3000 = encodeV3PathDirect({
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    fee: 3000,
  });
  const viaWeth = encodeV3PathViaWeth({
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    weth: WETH,
    feeInToWeth: 500,
    feeWethToOut: 500,
  });
  const { client, listLookups, recordedObservations } = createPoolCacheClient([
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: POOL_1,
      successCount: 2,
    }),
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 3000,
      exists: false,
    }),
  ]);
  const quoteCalls: Array<`0x${string}`> = [];
  const progressPercents: number[] = [];

  const selected = await selectBestRouteQuote({
    chainId: 31337,
    target: {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_B,
      amount: 1000n,
    },
    mode: "exact-in",
    wethAddress: WETH,
    feeCandidates: [500, 3000],
    viaWethFeeCandidates: [500],
    quoteExactInput: async ({ path }) => {
      quoteCalls.push(path);
      if (path === direct500) return 70n;
      if (path === viaWeth) return 95n;
      if (path === direct3000) throw new Error("known missing pool should be skipped");
      return undefined;
    },
    quoteExactOutput: async () => undefined,
    getPoolAddress: async ({ tokenA, tokenB, fee }) => {
      if (
        fee === 500 &&
        tokenA.toLowerCase() === TOKEN_A.toLowerCase() &&
        tokenB.toLowerCase() === WETH.toLowerCase()
      ) {
        return POOL_2;
      }
      if (
        fee === 500 &&
        tokenA.toLowerCase() === WETH.toLowerCase() &&
        tokenB.toLowerCase() === TOKEN_B.toLowerCase()
      ) {
        return POOL_3;
      }
      throw new Error("unexpected pool lookup");
    },
    poolCacheClient: client,
    onProgress: (progress) => {
      progressPercents.push(progress.percent);
    },
  });

  assert.equal(selected?.path, viaWeth);
  assert.equal(selected?.quote, 95n);
  assert.deepEqual(quoteCalls, [direct500, viaWeth]);
  assert.equal(progressPercents[0], 0);
  assert.equal(progressPercents.at(-1), 100);
  assert.equal(listLookups.length, 1);
  assert.equal(recordedObservations.length, 1);
  assert.deepEqual(
    recordedObservations[0]?.map((entry) => ({
      tokenA: entry.tokenA.toLowerCase(),
      tokenB: entry.tokenB.toLowerCase(),
      fee: entry.fee,
      exists: entry.exists,
      quoteSucceeded: Boolean(entry.quoteSucceeded),
    })),
    [
      {
        tokenA: TOKEN_A.toLowerCase(),
        tokenB: WETH.toLowerCase(),
        fee: 500,
        exists: true,
        quoteSucceeded: true,
      },
      {
        tokenA: WETH.toLowerCase(),
        tokenB: TOKEN_B.toLowerCase(),
        fee: 500,
        exists: true,
        quoteSucceeded: true,
      },
      {
        tokenA: TOKEN_A.toLowerCase(),
        tokenB: TOKEN_B.toLowerCase(),
        fee: 500,
        exists: true,
        quoteSucceeded: true,
      },
    ]
  );
});

test("selectBestRouteQuote records negative pool lookups and skips the quote when no direct pool exists", async () => {
  const { client, recordedObservations } = createPoolCacheClient();
  let quoteAttempted = false;

  const selected = await selectBestRouteQuote({
    chainId: 31337,
    target: {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_B,
      amount: 250n,
    },
    mode: "exact-out",
    wethAddress: WETH,
    feeCandidates: [500],
    viaWethFeeCandidates: [],
    quoteExactInput: async () => undefined,
    quoteExactOutput: async () => {
      quoteAttempted = true;
      return 123n;
    },
    getPoolAddress: async () => undefined,
    poolCacheClient: client,
  });

  assert.equal(selected, undefined);
  assert.equal(quoteAttempted, false);
  assert.equal(recordedObservations.length, 1);
  assert.deepEqual(recordedObservations[0], [
    {
      chainId: 31337,
      dex: "uniswap_v3",
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      poolAddress: undefined,
      exists: false,
    },
  ]);
});

test("selectBestRouteQuote skips cached pools with zero active liquidity", async () => {
  const { client } = createPoolCacheClient([
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: POOL_1,
      activeLiquidityRaw: "0",
      sqrtPriceX96Raw: "1",
      tick: 0,
      token0BalanceRaw: "100",
      token1BalanceRaw: "100",
      liquidityCheckedAt: new Date().toISOString(),
    }),
  ]);
  let quoteAttempted = false;

  const selected = await selectBestRouteQuote({
    chainId: 31337,
    target: {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_B,
      amount: 250n,
    },
    mode: "exact-in",
    wethAddress: WETH,
    feeCandidates: [500],
    viaWethFeeCandidates: [],
    quoteExactInput: async () => {
      quoteAttempted = true;
      return 123n;
    },
    quoteExactOutput: async () => undefined,
    getPoolAddress: async () => {
      throw new Error("cached pool should not be rediscovered");
    },
    poolCacheClient: client,
  });

  assert.equal(selected, undefined);
  assert.equal(quoteAttempted, false);
});

test("selectBestRouteQuote does not skip stale zero-liquidity snapshots when refresh is unavailable", async () => {
  const { client } = createPoolCacheClient([
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: POOL_1,
      activeLiquidityRaw: "0",
      sqrtPriceX96Raw: "1",
      tick: 0,
      token0BalanceRaw: "100",
      token1BalanceRaw: "100",
      liquidityCheckedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
  ]);
  let quoteAttempted = false;

  const selected = await selectBestRouteQuote({
    chainId: 31337,
    target: {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_B,
      amount: 250n,
    },
    mode: "exact-in",
    wethAddress: WETH,
    feeCandidates: [500],
    viaWethFeeCandidates: [],
    quoteExactInput: async () => {
      quoteAttempted = true;
      return 123n;
    },
    quoteExactOutput: async () => undefined,
    getPoolAddress: async () => {
      throw new Error("cached pool should not be rediscovered");
    },
    poolCacheClient: client,
  });

  assert.equal(selected?.quote, 123n);
  assert.equal(quoteAttempted, true);
});

test("selectBestRouteQuote skips exact-out direct routes when cached output balance is below requested amount", async () => {
  const { client } = createPoolCacheClient([
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: POOL_1,
      activeLiquidityRaw: "1000",
      sqrtPriceX96Raw: "1",
      tick: 0,
      token0BalanceRaw: "2000",
      token1BalanceRaw: "50",
      liquidityCheckedAt: new Date().toISOString(),
    }),
  ]);
  let quoteAttempted = false;

  const selected = await selectBestRouteQuote({
    chainId: 31337,
    target: {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_B,
      amount: 100n,
    },
    mode: "exact-out",
    wethAddress: WETH,
    feeCandidates: [500],
    viaWethFeeCandidates: [],
    quoteExactInput: async () => undefined,
    quoteExactOutput: async () => {
      quoteAttempted = true;
      return 111n;
    },
    getPoolAddress: async () => {
      throw new Error("cached pool should not be rediscovered");
    },
    poolCacheClient: client,
  });

  assert.equal(selected, undefined);
  assert.equal(quoteAttempted, false);
});

test("selectBestRouteQuote skips exact-out viaWeth routes when final-hop output balance is below requested amount", async () => {
  const { client } = createPoolCacheClient([
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: WETH,
      fee: 500,
      exists: true,
      poolAddress: POOL_2,
      activeLiquidityRaw: "5000",
      sqrtPriceX96Raw: "1",
      tick: 0,
      token0BalanceRaw: "800",
      token1BalanceRaw: "900",
      liquidityCheckedAt: new Date().toISOString(),
    }),
    createCachedPool({
      tokenA: WETH,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: POOL_3,
      activeLiquidityRaw: "5000",
      sqrtPriceX96Raw: "1",
      tick: 0,
      token0BalanceRaw: "40",
      token1BalanceRaw: "1000",
      liquidityCheckedAt: new Date().toISOString(),
    }),
  ]);
  let quoteAttempted = false;

  const selected = await selectBestRouteQuote({
    chainId: 31337,
    target: {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_B,
      amount: 100n,
    },
    mode: "exact-out",
    wethAddress: WETH,
    feeCandidates: [],
    viaWethFeeCandidates: [500],
    quoteExactInput: async () => undefined,
    quoteExactOutput: async () => {
      quoteAttempted = true;
      return 222n;
    },
    getPoolAddress: async () => {
      throw new Error("all pool states are cached");
    },
    poolCacheClient: client,
  });

  assert.equal(selected, undefined);
  assert.equal(quoteAttempted, false);
});

test("prepareRouteQuotePoolContext refreshes missing liquidity snapshots and records them", async () => {
  const { client, recordedObservations } = createPoolCacheClient([
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: POOL_1,
    }),
  ]);
  let snapshotCalls = 0;

  const poolContext = await prepareRouteQuotePoolContext({
    chainId: 31337,
    targets: [
      {
        inputAsset: TOKEN_A,
        outputAsset: TOKEN_B,
        amount: 100n,
      },
    ],
    mode: "exact-in",
    wethAddress: WETH,
    feeCandidates: [500],
    viaWethFeeCandidates: [],
    getPoolAddress: async () => {
      throw new Error("cached pool should not be rediscovered");
    },
    getPoolSnapshot: async ({ poolAddress }) => {
      snapshotCalls += 1;
      assert.equal(poolAddress, POOL_1);
      return {
        poolAddress,
        activeLiquidity: 1000n,
        sqrtPriceX96: 2n,
        tick: 1,
        token0Balance: 300n,
        token1Balance: 400n,
      };
    },
    poolCacheClient: client,
  });

  await recordRouteQuotePoolObservations({
    poolContext,
    poolCacheClient: client,
  });

  assert.equal(snapshotCalls, 1);
  assert.equal(recordedObservations.length, 1);
  assert.equal(recordedObservations[0]?.[0]?.activeLiquidityRaw, "1000");
  assert.equal(recordedObservations[0]?.[0]?.token0BalanceRaw, "300");
  assert.equal(recordedObservations[0]?.[0]?.token1BalanceRaw, "400");
});

test("prepareRouteQuotePoolContext dedupes pool discovery across quote targets", async () => {
  const directTokenB = encodeV3PathDirect({
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    fee: 500,
  });
  const directTokenD = encodeV3PathDirect({
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_D,
    fee: 500,
  });
  const targets = [
    {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_B,
      amount: 100n,
    },
    {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_D,
      amount: 200n,
    },
  ] satisfies readonly QuoteTarget[];
  const { client, listLookups, recordedObservations } = createPoolCacheClient();
  const poolLookups: Array<{
    tokenA: `0x${string}`;
    tokenB: `0x${string}`;
    fee: number;
  }> = [];

  const poolContext = await prepareRouteQuotePoolContext({
    chainId: 31337,
    targets,
    mode: "exact-in",
    wethAddress: WETH,
    feeCandidates: [500],
    viaWethFeeCandidates: [500],
    getPoolAddress: async (lookup) => {
      poolLookups.push(lookup);
      return POOL_5;
    },
    poolCacheClient: client,
  });

  const sharedInputToWethLookups = poolLookups.filter(
    (lookup) =>
      lookup.fee === 500 &&
      lookup.tokenA.toLowerCase() === TOKEN_A.toLowerCase() &&
      lookup.tokenB.toLowerCase() === WETH.toLowerCase()
  );

  assert.equal(listLookups.length, 1);
  assert.equal(poolLookups.length, 5);
  assert.equal(sharedInputToWethLookups.length, 1);

  const selected = await Promise.all(
    targets.map((target) =>
      selectBestRouteQuote({
        chainId: 31337,
        target,
        mode: "exact-in",
        wethAddress: WETH,
        feeCandidates: [500],
        viaWethFeeCandidates: [500],
        quoteExactInput: async ({ path }) => {
          if (path === directTokenB) return 100n;
          if (path === directTokenD) return 200n;
          return 1n;
        },
        quoteExactOutput: async () => undefined,
        getPoolAddress: async () => {
          throw new Error("pool context should satisfy all lookups");
        },
        poolCacheClient: client,
        poolContext,
      })
    )
  );

  assert.equal(selected[0]?.path, directTokenB);
  assert.equal(selected[1]?.path, directTokenD);
  assert.equal(listLookups.length, 1);
  assert.equal(recordedObservations.length, 0);

  await recordRouteQuotePoolObservations({
    poolContext,
    poolCacheClient: client,
  });

  assert.equal(recordedObservations.length, 1);
});

test("selectBestRouteQuote probes all fee candidates concurrently and keeps the best quote", async () => {
  const direct500 = encodeV3PathDirect({
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    fee: 500,
  });
  const viaWeth = encodeV3PathViaWeth({
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    weth: WETH,
    feeInToWeth: 500,
    feeWethToOut: 500,
  });
  const direct3000 = encodeV3PathDirect({
    tokenIn: TOKEN_A,
    tokenOut: TOKEN_B,
    fee: 3000,
  });
  const { client } = createPoolCacheClient([
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: POOL_1,
    }),
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: TOKEN_B,
      fee: 3000,
      exists: true,
      poolAddress: POOL_4,
    }),
    createCachedPool({
      tokenA: TOKEN_A,
      tokenB: WETH,
      fee: 500,
      exists: true,
      poolAddress: POOL_2,
    }),
    createCachedPool({
      tokenA: WETH,
      tokenB: TOKEN_B,
      fee: 500,
      exists: true,
      poolAddress: POOL_3,
    }),
  ]);
  const quoteCalls: Array<`0x${string}`> = [];
  let firstResolvedCallCount: number | undefined;

  const selected = await selectBestRouteQuote({
    chainId: 31337,
    target: {
      inputAsset: TOKEN_A,
      outputAsset: TOKEN_B,
      amount: 500n,
    },
    mode: "exact-in",
    wethAddress: WETH,
    feeCandidates: [3000, 500],
    viaWethFeeCandidates: [500],
    quoteExactInput: async ({ path }) => {
      quoteCalls.push(path);
      await Promise.resolve();
      firstResolvedCallCount ??= quoteCalls.length;
      if (path === direct500) return 80n;
      if (path === viaWeth) return 90n;
      if (path === direct3000) return 120n;
      return undefined;
    },
    quoteExactOutput: async () => undefined,
    getPoolAddress: async () => {
      throw new Error("all pool states are cached");
    },
    poolCacheClient: client,
  });

  assert.equal(selected?.path, direct3000);
  assert.equal(firstResolvedCallCount, 3);
  assert.deepEqual(quoteCalls, [direct500, viaWeth, direct3000]);
});
