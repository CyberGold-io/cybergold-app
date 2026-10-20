import assert from "node:assert/strict";
import test from "node:test";
import type { spendableToken } from "../config/tokens.ts";
import { mergeWalletDisplayBalances, parseWalletDisplayBalances, parseWalletLiquidityDisplay, parseWalletRecoveryDisplay,
  projectWalletDisplayBalances, walletDisplayBalance, walletDisplayCacheKey } from "./walletDisplayCache.ts";

const ALICE = "0x00000000000000000000000000000000000000a1";
const BOB = "0x00000000000000000000000000000000000000b2";
const eth: spendableToken = { id: "eth", type: "native", symbol: "ETH", name: "Ether", decimals: 18 };
const cygld: spendableToken = { id: "cygld", type: "erc20", symbol: "CYGLD", name: "CyberGold", decimals: 18, address: ALICE };

test("wallet display balances retain known zero and wide amounts through partial acquisition", () => {
  const cached = projectWalletDisplayBalances([eth, cygld], [{ id: "eth", balance: 0n }, { id: "cygld", balance: 2n ** 255n }]);
  const restored = parseWalletDisplayBalances(JSON.parse(JSON.stringify(cached)));
  const partial = mergeWalletDisplayBalances(restored, projectWalletDisplayBalances([eth, cygld], [{ id: "eth", balance: 3n }]));
  assert.equal(walletDisplayBalance(eth, partial), 3n);
  assert.equal(walletDisplayBalance(cygld, partial), 2n ** 255n);
  assert.equal(walletDisplayBalance(eth, restored), 0n);
  assert.equal(walletDisplayBalance(cygld, {}), undefined);
});

test("presentation caches cannot cross accounts, chains, asset replacement or token precision", () => {
  assert.equal(walletDisplayCacheKey(1, ALICE.toUpperCase(), "balances"), walletDisplayCacheKey(1, ALICE, "balances"));
  assert.notEqual(walletDisplayCacheKey(1, ALICE, "balances"), walletDisplayCacheKey(1, BOB, "balances"));
  assert.notEqual(walletDisplayCacheKey(1, ALICE, "balances"), walletDisplayCacheKey(31338, ALICE, "balances"));
  assert.equal(walletDisplayCacheKey(1, undefined, "balances"), undefined);
  const cached = projectWalletDisplayBalances([eth, cygld], [{ id: "cygld", balance: 10n }]);
  assert.equal(walletDisplayBalance({ ...cygld, address: BOB }, cached), undefined);
  assert.equal(walletDisplayBalance({ ...cygld, decimals: 6 }, cached), undefined);
  assert.equal(walletDisplayBalance({ ...eth, id: "cygld" }, cached), undefined);
});

test("wallet balance projection excludes allowances, routes and swap-read observations", () => {
  const row = { id: "cygld", balance: 10n, allowance: 99n, pool: ALICE, quote: { amount: "10" } };
  const stored = JSON.stringify(projectWalletDisplayBalances([cygld], [row]));
  assert.doesNotMatch(stored, /allowance|pool|quote|amount/);
  assert.equal(parseWalletDisplayBalances({ eth: "-1" }), undefined);
  assert.equal(parseWalletDisplayBalances({ eth: "not an amount" }), undefined);
});

test("liquidity display projection keeps count and amounts without position operations", () => {
  const snapshot = parseWalletLiquidityDisplay({ positionCount: 2, paxgAmount: "1.25", cygldAmount: "3", positions: [{ tokenId: "99", liquidity: "123" }] });
  assert.deepEqual(snapshot, { positionCount: 2, paxgAmount: "1.25", cygldAmount: "3" });
  assert.doesNotMatch(JSON.stringify(snapshot), /tokenId|liquidity|positions/);
});

test("recovery display projection contains formatted text without redemption inputs or eligibility", () => {
  const snapshot = parseWalletRecoveryDisplay({ notConfigured: false, corePaused: false, rows: [{
    shareId: "1", assetLabel: "PAXG", balance: "2 shares", payout: "1 PAXG", zeroPayout: false,
    pool: { asset: ALICE }, shares: "2000000000000000000", canSettle: true, minRawOut: "99",
  }] });
  assert.deepEqual(snapshot, { notConfigured: false, corePaused: false,
    rows: [{ shareId: "1", assetLabel: "PAXG", balance: "2 shares", payout: "1 PAXG", zeroPayout: false }] });
  assert.doesNotMatch(JSON.stringify(snapshot), /pool|"shares":|canSettle|minRawOut/);
});
