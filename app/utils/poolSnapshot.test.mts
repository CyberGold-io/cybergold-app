import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { fetchPoolCatalog, fetchPoolSnapshot, liquidityFromSnapshot, poolCatalogOptions,
  poolIdentifierFromRef, poolSnapshotOptions, type PoolIdentifier, type PoolSnapshot } from "./poolSnapshot.ts";

const A = `0x${"1".repeat(40)}`, B = `0x${"2".repeat(40)}`;
const identifier = { tokenA: A, tokenB: B, fee: 3000 };
const snapshot = {
  context: { chainId: 31338, blockNumber: "101", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-01T07:00:00.000Z" },
  dex: "uniswap_v3" as const, token0: A, token1: B, fee: 3000, exists: true, poolAddress: `0x${"3".repeat(40)}`,
  activeLiquidityRaw: (2n ** 100n).toString(), sqrtPriceX96Raw: (2n ** 150n).toString(), tick: -12,
  token0BalanceRaw: (2n ** 200n).toString(), token1BalanceRaw: (2n ** 201n).toString(),
};
const v4: PoolIdentifier = { protocol: "v4", tokenA: A, tokenB: B, fee: 100, tickSpacing: 1,
  hooks: `0x${"0".repeat(40)}`, poolManager: `0x${"4".repeat(40)}`, poolId: `0x${"5".repeat(64)}` };

test("pool fetch sends identifiers only and propagates ordinary API failure", async () => {
  const signal = new AbortController().signal;
  const fetchImpl = (async (url, init) => {
    assert.equal(url, "/api/pools/snapshot"); assert.equal(init?.signal, signal);
    assert.equal(init?.cache, "no-store"); assert.deepEqual(JSON.parse(String(init?.body)), identifier);
    return Response.json(snapshot);
  }) as typeof fetch;
  assert.deepEqual(await fetchPoolSnapshot({ ...identifier, provider: "http://untrusted.invalid" } as typeof identifier,
    signal, fetchImpl), snapshot);
  await assert.rejects(fetchPoolSnapshot(identifier, undefined, (async () => new Response("private URL", { status: 503 })) as typeof fetch),
    /temporarily unavailable/);
});

test("wide pool values and the producer acquisition time survive conversion; empty pool stays absent", () => {
  const converted = liquidityFromSnapshot(snapshot)!;
  assert.equal(converted.activeLiquidity, 2n ** 100n); assert.equal(converted.sqrtPriceX96, 2n ** 150n);
  assert.equal(converted.token1Balance, 2n ** 201n); assert.equal(converted.tick, -12);
  assert.equal(converted.observedAt, snapshot.context.observedAt);
  assert.equal(liquidityFromSnapshot({ ...snapshot, exists: false, poolAddress: undefined }), undefined);
});

test("discovery and liquidity share one query for either token order; environment and fee separate it", async () => {
  const client = new QueryClient(); let requests = 0;
  const fetchImpl = (async () => { requests++; await new Promise(resolve => setTimeout(resolve, 10)); return Response.json(snapshot); }) as typeof fetch;
  const first = poolSnapshotOptions(31338, identifier, fetchImpl);
  const reverse = poolSnapshotOptions(31338, { ...identifier, tokenA: B, tokenB: A }, fetchImpl);
  try {
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => client.fetchQuery(index % 2 ? reverse : first)));
    assert.equal(requests, 1); assert.ok(results.every(value => value.context.observedAt === snapshot.context.observedAt));
    await client.fetchQuery(first); assert.equal(requests, 1);
    await client.invalidateQueries({ queryKey: first.queryKey }); await client.fetchQuery(first); assert.equal(requests, 2);
    await client.fetchQuery(poolSnapshotOptions(1, identifier, fetchImpl));
    await client.fetchQuery(poolSnapshotOptions(31338, { ...identifier, fee: 500 }, fetchImpl));
    assert.equal(requests, 4);
  } finally { client.clear(); }
});

test("an API outage does not turn the retained query into a successful refresh", async () => {
  const client = new QueryClient(); let failed = false;
  const fetchImpl = (async () => failed ? new Response("unavailable", { status: 503 }) : Response.json(snapshot)) as typeof fetch;
  const options = poolSnapshotOptions(31338, identifier, fetchImpl);
  try {
    await client.fetchQuery(options); failed = true; await client.invalidateQueries({ queryKey: options.queryKey });
    await assert.rejects(client.fetchQuery(options), /temporarily unavailable/);
    assert.equal(client.getQueryState(options.queryKey)?.status, "error");
    assert.equal(client.getQueryData<typeof snapshot>(options.queryKey)?.context.observedAt, snapshot.context.observedAt);
  } finally { client.clear(); }
});

test("V4 query sharing preserves full identities and isolates same-fee pools and managers", async () => {
  const client = new QueryClient(); let calls = 0;
  const fetchImpl = (async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    await new Promise(resolve => setTimeout(resolve, 5));
    return Response.json({ ...snapshot, protocol: "v4", dex: "uniswap_v4", poolId: body.poolId });
  }) as typeof fetch;
  try {
    const other = { ...v4, poolId: `0x${"6".repeat(64)}`, hooks: `0x${"7".repeat(40)}` };
    const values = await Promise.all([
      client.fetchQuery(poolSnapshotOptions(1, v4, fetchImpl)),
      client.fetchQuery(poolSnapshotOptions(1, { ...v4, tokenA: B, tokenB: A }, fetchImpl)),
      client.fetchQuery(poolSnapshotOptions(1, other, fetchImpl)),
    ]);
    assert.equal(calls, 2);
    assert.equal(values[0].poolId, v4.poolId); assert.equal(values[1].poolId, v4.poolId);
    assert.equal(values[2].poolId, other.poolId);
    const base = poolSnapshotOptions(1, v4).queryKey;
    assert.notDeepEqual(poolSnapshotOptions(1, { ...v4, poolManager: `0x${"8".repeat(40)}` }).queryKey, base);
    const keyOnly = { ...v4, poolId: undefined };
    assert.notDeepEqual(poolSnapshotOptions(1, { ...keyOnly, tickSpacing: 10 }).queryKey,
      poolSnapshotOptions(1, keyOnly).queryKey);
    assert.notDeepEqual(poolSnapshotOptions(1, { ...keyOnly, hooks: `0x${"9".repeat(40)}` }).queryKey,
      poolSnapshotOptions(1, keyOnly).queryKey);
    assert.notDeepEqual(poolSnapshotOptions(1, { ...identifier, protocol: "v3" }).queryKey,
      poolSnapshotOptions(1, identifier).queryKey);
    assert.notDeepEqual(poolSnapshotOptions(1, { ...identifier, protocol: "v2" }).queryKey, base);
  } finally { client.clear(); }
});

test("catalog identities reach the snapshot API losslessly without caller transport fields", async () => {
  const pool = { id: v4.poolId!, protocol: "v4" as const,
    token0: { address: A, decimals: 18, chainId: 1 }, token1: { address: B, decimals: 18, chainId: 1 },
    feePips: 100, tickSpacing: 1, hooks: v4.hooks, poolManager: v4.poolManager };
  const input = poolIdentifierFromRef(pool);
  const fetchImpl = (async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json(snapshot);
  }) as typeof fetch;
  const caller = { ...input, provider: "http://private.invalid" };
  await fetchPoolSnapshot(caller, undefined, fetchImpl);
  const v2 = poolIdentifierFromRef({ ...pool, protocol: "v2", id: `0x${"3".repeat(40)}` });
  assert.equal(v2.id, `0x${"3".repeat(40)}`);
});

test("singleton liquidity keeps wide state and coverage while its balances remain unknown", () => {
  const state: PoolSnapshot = { ...snapshot, protocol: "v4", dex: "uniswap_v4", id: v4.poolId,
    poolId: v4.poolId, poolManager: v4.poolManager,
    poolKey: { currency0: A, currency1: B, fee: 100, tickSpacing: 1, hooks: v4.hooks },
    marginalPrice: { numerator: String(2n ** 200n), denominator: String(2n ** 192n) },
    lpFee: 100, protocolFee: 12,
    ticks: [{ index: -10, liquidityGross: String(2n ** 100n), liquidityNet: String(-(2n ** 90n)) }],
    bitmapWords: [{ wordPosition: -1, bitmap: String(2n ** 250n) }] };
  const value = liquidityFromSnapshot(state)!;
  assert.equal(value.activeLiquidity, 2n ** 100n);
  assert.equal(value.poolAddress, undefined);
  assert.equal(value.token0Balance, undefined); assert.equal(value.token1Balance, undefined);
  assert.equal(value.reserve0, undefined); assert.equal(value.reserve1, undefined);
  assert.deepEqual(value.poolKey, state.poolKey); assert.deepEqual(value.ticks, state.ticks);
  assert.deepEqual(value.bitmapWords, state.bitmapWords); assert.deepEqual(value.marginalPrice, state.marginalPrice);
  assert.equal(value.lpFee, 100); assert.equal(value.protocolFee, 12);
  const dexOnly = liquidityFromSnapshot({ ...state, protocol: undefined, id: undefined })!;
  assert.equal(dexOnly.protocol, "v4"); assert.equal(dexOnly.id, state.poolId);
  assert.equal(dexOnly.token0Balance, undefined);
});

test("catalog consumers share a Backend inventory read and do not add a polling interval", async () => {
  const client = new QueryClient(); let calls = 0;
  const signal = new AbortController().signal;
  const fetchImpl = (async (url, init) => {
    calls++; assert.equal(url, "/api/pools/catalog"); assert.equal(init?.cache, "no-store");
    return Response.json({ context: snapshot.context, entries: [], catalogMonth: "2026-10" });
  }) as typeof fetch;
  try {
    const options = poolCatalogOptions(1, fetchImpl);
    await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
    assert.equal(calls, 1); assert.equal("refetchInterval" in options, false);
    assert.equal((await fetchPoolCatalog(signal, fetchImpl)).catalogMonth, "2026-10");
  } finally { client.clear(); }
});
