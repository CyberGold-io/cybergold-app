import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { checkSwapWalletBalances, fetchWalletBalances, walletBalanceQuery, walletBalanceRows, type WalletBalancesSnapshot } from "./walletBalanceSnapshot.ts";
import { resetSandboxQueries } from "./sandboxForkState.ts";
import { isBasketComponentAmountOverWalletBalance } from "./walletBalances.ts";
import type { BasketComponent } from "../types.ts";

const ALICE = "0x00000000000000000000000000000000000000a1";
const BOB = "0x00000000000000000000000000000000000000b2";
const success = (value: string) => ({ status: "success" as const, value });
function snapshot(holder = ALICE): WalletBalancesSnapshot { return {
  context: { chainId: 31338, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1790800000", observedAt: "2026-10-01T00:00:00Z" },
  holder, native: success("0"), tokens: [
    { id: "cygld", address: ALICE, balance: success((2n ** 255n).toString()) },
    { id: "usdc", address: BOB, balance: { status: "failure", error: "contract-read-failed" } },
  ],
}; }
const metadata = [
  { id: "cygld", symbol: "CYGLD", name: "CyberGold", decimals: 18 },
  { id: "usdc", symbol: "USDC", name: "USDC", decimals: 6 },
  { id: "eth", symbol: "ETH", name: "Ether", decimals: 18 },
];

test("swap balance checks use exact amounts and identify the insufficient spending asset", () => {
  const value = snapshot();
  assert.equal(checkSwapWalletBalances(value, [{ tokenId: "cygld", amount: 2n ** 255n }]), undefined);
  assert.deepEqual(checkSwapWalletBalances(value, [{ tokenId: "cygld", amount: 2n ** 255n + 1n }]),
    { reason: "insufficient", tokenId: "cygld" });
  assert.deepEqual(checkSwapWalletBalances(value, [{ tokenId: "eth", amount: 1n }]),
    { reason: "insufficient", tokenId: "eth" });
});

test("swap balance checks require a readable balance only for nonzero spending assets", () => {
  const value = snapshot();
  assert.equal(checkSwapWalletBalances(value, [{ tokenId: "cygld", amount: 1n }, { tokenId: "usdc", amount: 0n }]), undefined);
  assert.deepEqual(checkSwapWalletBalances(value, [{ tokenId: "usdc", amount: 1n }]),
    { reason: "unavailable", tokenId: "usdc" });
  assert.deepEqual(checkSwapWalletBalances(value, [{ tokenId: "paxg", amount: 1n }]),
    { reason: "unavailable", tokenId: "paxg" });
});

test("wallet snapshot preserves wide amounts and known zero; failed or absent balances remain unknown", () => {
  assert.deepEqual(walletBalanceRows(snapshot(), metadata).map(row => [row.id, row.balance]), [["cygld", 2n ** 255n], ["eth", 0n]]);
  assert.deepEqual(walletBalanceRows(undefined, metadata), []);
  const component: BasketComponent = { token: { id: "usdc", symbol: "USDC", name: "USDC", decimals: 6, type: "erc20", address: BOB }, targetWeight: 1n };
  assert.equal(isBasketComponentAmountOverWalletBalance({ component, amountStr: "1", walletBalanceByTokenId: {} }), false);
  assert.equal(isBasketComponentAmountOverWalletBalance({ component, amountStr: "1", walletBalanceByTokenId: { usdc: 0n } }), true);
});

test("focused wallet read keeps its holder, cancellation and server credential boundary; outage has no RPC fallback", async () => {
  const abort = new AbortController(); let calls = 0;
  await fetchWalletBalances(ALICE, abort.signal, (async (url, init) => {
    calls++; assert.equal(String(url), `/api/account/wallet-balances?holder=${ALICE}&purpose=display`);
    assert.equal(init?.signal, abort.signal); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return Response.json(snapshot());
  }) as typeof fetch);
  await assert.rejects(fetchWalletBalances(ALICE, undefined, (async () => { calls++; return new Response(null, { status: 503 }); }) as typeof fetch), /temporarily unavailable/);
  assert.equal(calls, 2);
});

test("mounted consumers share one wallet read while accounts, chains and fork generations stay separate", async () => {
  const client = new QueryClient(); const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async url => { calls++; const holder = new URL(String(url), "http://fixture.invalid").searchParams.get("holder")!; return Response.json(snapshot(holder)); }) as typeof fetch;
  try {
    const query = walletBalanceQuery(ALICE, 31338, ALICE, "fork-one");
    await Promise.all([client.fetchQuery(query), client.fetchQuery(query)]);
    assert.equal(calls, 1);
    await client.fetchQuery(walletBalanceQuery(BOB, 31338, ALICE, "fork-one"));
    await client.fetchQuery(walletBalanceQuery(ALICE, 31338, ALICE, "fork-two"));
    await client.fetchQuery(walletBalanceQuery(ALICE, 1, ALICE, null));
    assert.equal(calls, 4);
    assert.equal(walletBalanceQuery(undefined, 31338, ALICE, "fork-one").enabled, false);
    client.setQueryData(["sandbox-fork-generation"], { sandboxForkGeneration: "fork-two" });
    await resetSandboxQueries(client);
    assert.equal(client.getQueryData(query.queryKey), undefined);
    assert.deepEqual(client.getQueryData(["sandbox-fork-generation"]), { sandboxForkGeneration: "fork-two" });
  } finally { client.clear(); globalThis.fetch = original; }
});

test("swap preflight requests the retained balance checks without changing ordinary display reads", async () => {
  const abort = new AbortController();
  const calls: string[] = [];
  const fetchImpl = (async (url, init) => {
    calls.push(String(url));
    assert.equal(init?.signal, abort.signal);
    assert.equal(init?.cache, "no-store");
    return Response.json(snapshot());
  }) as typeof fetch;
  await fetchWalletBalances(ALICE, abort.signal, fetchImpl);
  await fetchWalletBalances(ALICE, abort.signal, fetchImpl, "swap-preflight");
  assert.deepEqual(calls, [
    `/api/account/wallet-balances?holder=${ALICE}&purpose=display`,
    `/api/account/wallet-balances?holder=${ALICE}&purpose=swap-preflight`,
  ]);
});
