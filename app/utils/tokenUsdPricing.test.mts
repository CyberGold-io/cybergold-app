import assert from "node:assert/strict";
import test from "node:test";
import type { TokenType } from "../types.ts";
import type { PoolSnapshot } from "./poolSnapshot.ts";
import { tokenUsdPricesFromSnapshots } from "./tokenUsdPricing.ts";

// Arithmetic fixtures supply token identities independently of deployment settings.
const tokenAddresses = {
  CYGLD: `0x${"1".repeat(40)}`,
  XAUT: `0x${"2".repeat(40)}`,
  PAXG: `0x${"3".repeat(40)}`,
  USDT: `0x${"4".repeat(40)}`,
  USDC: `0x${"5".repeat(40)}`,
  WETH: `0x${"6".repeat(40)}`,
} as const;
const address = `0x${"7".repeat(40)}` as const;
const tokens: TokenType[] = [
  ...(["usdc", "usdt", "xaut", "weth", "paxg", "cygld"] as const).map(id => ({
    id, symbol: id, name: id, type: "erc20" as const,
    address: tokenAddresses[id.toUpperCase() as keyof typeof tokenAddresses],
    decimals: ["usdc", "usdt", "xaut"].includes(id) ? 6 : 18,
  })),
  { id: "eth", symbol: "ETH", name: "Ether", type: "native", decimals: 18 },
];
const Q96 = 2n ** 96n;
const referencePairs = [["usdc", "usdt"], ["usdc", "weth"], ["xaut", "weth"], ["paxg", "weth"]] as const;
const observation = (sqrt: bigint, index = 0): PoolSnapshot => ({
  context: { chainId: 31338, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-01T00:00:00Z" },
  dex: "uniswap_v3", token0: tokenAddresses[referencePairs[index][0].toUpperCase() as keyof typeof tokenAddresses],
  token1: tokenAddresses[referencePairs[index][1].toUpperCase() as keyof typeof tokenAddresses],
  fee: 500, exists: true,
  poolAddress: address, sqrtPriceX96Raw: sqrt.toString(), activeLiquidityRaw: "1",
  tick: 0, token0BalanceRaw: "1", token1BalanceRaw: "1",
});
const observations = [Q96, Q96 * 2n ** 16n, Q96 * 2n ** 16n, Q96 / 2n].map((sqrt, index) => observation(sqrt, index));

test("authoritative pool square roots preserve decimal-adjusted prices and native Ether valuation", () => {
  const result = tokenUsdPricesFromSnapshots(observations, tokens);
  assert.equal(result.usdc, 1);
  assert.equal(result.usdt, 1);
  assert.equal(result.weth, 232.83064365386963);
  assert.equal(result.eth, result.weth);
  assert.equal(result.xaut, 1);
  assert.equal(result.paxg, 58.20766091346741);
  assert.equal(result.cygld, undefined);
});

test("missing, absent and uninitialized pools leave dependent valuations unknown", () => {
  const result = tokenUsdPricesFromSnapshots([
    observations[0], undefined, { ...observations[2], exists: false }, observation(0n, 3),
  ], tokens);
  assert.equal(result.usdt, 1);
  for (const id of ["eth", "weth", "xaut", "paxg", "cygld"]) assert.equal(result[id], undefined);
});

test("known gold references and basket weights remain usable during a pool outage", () => {
  const paxg = tokens.find(token => token.id === "paxg")!;
  const xaut = tokens.find(token => token.id === "xaut")!;
  assert.equal(paxg.type, "erc20"); assert.equal(xaut.type, "erc20");
  if (paxg.type !== "erc20" || xaut.type !== "erc20") throw new Error("Invalid test fixture");
  const basket: TokenType = { id: "goldbasket", symbol: "BASKET", name: "Gold basket", type: "basket",
    components: [{ token: paxg, targetWeight: 600000n }, { token: xaut, targetWeight: 400000n }] };
  const result = tokenUsdPricesFromSnapshots([], [...tokens, basket], {
    goldSpotUsdPerOzt: 3320,
    goldReferenceGramsByTokenId: { paxg: 31103476800000000000n, xaut: 31103476800000000000n },
  });
  assert.equal(result.paxg, 3320); assert.equal(result.xaut, 3320); assert.equal(result.goldbasket, 3320);
  assert.equal(result.eth, undefined);
});

test("progressive pool observations price Ether before an unrelated gold pool settles", () => {
  const result = tokenUsdPricesFromSnapshots([observations[0], observations[1], undefined, undefined], tokens);
  assert.equal(result.usdc, 1);
  assert.equal(result.eth, 232.83064365386963);
  assert.equal(result.paxg, undefined);
});

test("a basket reference price remains unknown until all weighted assets are priced", () => {
  const paxg = tokens.find(token => token.id === "paxg")!;
  const xaut = tokens.find(token => token.id === "xaut")!;
  if (paxg.type !== "erc20" || xaut.type !== "erc20") throw new Error("Invalid test fixture");
  const basket: TokenType = { id: "goldbasket", symbol: "BASKET", name: "Gold basket", type: "basket",
    components: [{ token: paxg, targetWeight: 600000n }, { token: xaut, targetWeight: 400000n }] };
  const result = tokenUsdPricesFromSnapshots([], [...tokens, basket], {
    goldSpotUsdPerOzt: 3320, goldReferenceGramsByTokenId: { paxg: 31103476800000000000n },
  });
  assert.equal(result.paxg, 3320);
  assert.equal(result.goldbasket, undefined);
});

test("price propagation follows token identities when catalog observations arrive out of order", () => {
  assert.deepEqual(tokenUsdPricesFromSnapshots([...observations].reverse(), tokens),
    tokenUsdPricesFromSnapshots(observations, tokens));
});

test("V4 marginal prices use a known gold anchor without singleton balances or TVL", () => {
  const snapshot: PoolSnapshot = { context: observations[0].context, protocol: "v4", dex: "uniswap_v4",
    id: `0x${"a".repeat(64)}`, poolId: `0x${"a".repeat(64)}`, token0: tokenAddresses.CYGLD,
    token1: tokenAddresses.PAXG, fee: 100, exists: true, activeLiquidityRaw: String(2n ** 100n),
    marginalPrice: { numerator: "1", denominator: "2" } };
  const result = tokenUsdPricesFromSnapshots([snapshot], tokens, {
    goldSpotUsdPerOzt: 3320, goldReferenceGramsByTokenId: { paxg: 31103476800000000000n },
  });
  assert.equal(result.paxg, 3320);
  assert.equal(result.cygld, 1660);
  assert.equal(snapshot.token0BalanceRaw, undefined);
  assert.equal(result.eth, undefined);
});

test("V2 canonical marginal rates preserve different token decimals and absent prices stay unknown", () => {
  const snapshot: PoolSnapshot = { context: observations[0].context, protocol: "v2", dex: "uniswap_v2",
    token0: tokenAddresses.USDC, token1: tokenAddresses.PAXG, fee: 3000, exists: true,
    reserve0Raw: "2000000000", reserve1Raw: "1000000000000000000",
    marginalPrice: { numerator: "1000000000000000000", denominator: "2000000000" } };
  assert.equal(tokenUsdPricesFromSnapshots([snapshot], tokens).paxg, 2000);
  assert.equal(tokenUsdPricesFromSnapshots([{ ...snapshot, marginalPrice: undefined }], tokens).paxg, undefined);
});
