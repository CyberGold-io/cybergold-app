import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTradeDisplaySnapshot,
  readStoredTradeDisplayScope,
  readTradeDisplaySnapshot,
  tradeDisplayIntentKey,
  tradeDisplayScopeKey,
  tradeDisplaySnapshotStorageKey,
  writeTradeDisplaySnapshot,
  type TradeDisplaySnapshot,
} from "./tradeDisplaySnapshot.ts";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
}

const key = tradeDisplaySnapshotStorageKey(31338, "en");
const intent = { sellTokenId: "cygld", buyTokenId: "eth", sellAmount: "0.01" };
const scope = { chainId: 31338, locale: "en", currency: "USD", goldUnit: "imperial", priceDisplayMode: "fiat" };
const snapshot: TradeDisplaySnapshot = {
  intentKey: tradeDisplayIntentKey(intent),
  scopeKey: tradeDisplayScopeKey(scope),
  values: {
    sellTokenSymbol: "CYGLD", sellAmount: "0.01", sellEquivalent: "~ 0.01 troy oz • $42.00",
    buyTokenSymbol: "ETH", buyAmount: "0.014", buyEquivalent: "~ 0.01 troy oz • $41.90",
  },
};

test("a reload restores the same tab's spend and receive presentation without storing operational objects", () => {
  const tab = storage();
  writeTradeDisplaySnapshot(key, { ...snapshot, quote: { calldata: "private-quote" }, balance: 10n } as TradeDisplaySnapshot, tab);
  assert.deepEqual(readTradeDisplaySnapshot(key, snapshot.intentKey, snapshot.scopeKey, tab), snapshot);
  assert.doesNotMatch(tab.getItem(key)!, /calldata|private-quote|balance/);
});

test("changed spend amount, asset pair and basket driver never reuse an unrelated display", () => {
  const tab = storage();
  writeTradeDisplaySnapshot(key, snapshot, tab);
  for (const changed of [
    { ...intent, sellAmount: "0.02" },
    { ...intent, sellTokenId: "eth" },
    { ...intent, buyTokenId: "usdc" },
    { ...intent, driverAmountStr: "1" },
    { ...intent, driverToken: "0x0000000000000000000000000000000000000001" as const },
  ]) {
    assert.equal(readTradeDisplaySnapshot(key, tradeDisplayIntentKey(changed), snapshot.scopeKey, tab), undefined);
  }
});

test("display preferences, network and locale remain scoped while tab sessions stay independent", () => {
  const tab = storage();
  writeTradeDisplaySnapshot(key, snapshot, tab);
  for (const changed of [
    { ...scope, chainId: 1 }, { ...scope, locale: "fr" },
    { ...scope, currency: "EUR" }, { ...scope, goldUnit: "metric" }, { ...scope, priceDisplayMode: "gold" },
  ]) {
    assert.equal(readTradeDisplaySnapshot(key, snapshot.intentKey, tradeDisplayScopeKey(changed), tab), undefined);
  }
  assert.equal(readTradeDisplaySnapshot(key, snapshot.intentKey, snapshot.scopeKey, storage()), undefined);
  assert.equal(readTradeDisplaySnapshot(tradeDisplaySnapshotStorageKey(1, "en"), snapshot.intentKey, snapshot.scopeKey, tab), undefined);
  assert.equal(readTradeDisplaySnapshot(tradeDisplaySnapshotStorageKey(31338, "fr"), snapshot.intentKey, snapshot.scopeKey, tab), undefined);
});

test("restricted, malformed and absent session storage leave the normal network path available", () => {
  const restricted = { getItem: () => { throw new Error("restricted"); }, setItem: () => { throw new Error("restricted"); } };
  assert.equal(readTradeDisplaySnapshot(key, snapshot.intentKey, snapshot.scopeKey, restricted), undefined);
  assert.doesNotThrow(() => writeTradeDisplaySnapshot(key, snapshot, restricted));
  const tab = storage();
  tab.setItem(key, "not JSON");
  assert.equal(readTradeDisplaySnapshot(key, snapshot.intentKey, snapshot.scopeKey, tab), undefined);
  for (const invalid of [null, [], { ...snapshot, values: null }, { ...snapshot, values: { amount: 1 } }, { ...snapshot, intentKey: 1 }]) {
    assert.equal(parseTradeDisplaySnapshot(invalid), undefined);
  }
  assert.equal(readTradeDisplaySnapshot(key, snapshot.intentKey, snapshot.scopeKey), undefined);
  assert.doesNotThrow(() => writeTradeDisplaySnapshot(key, snapshot));
});

test("rendered labels remain literal text and basket-driver identity ignores address casing", () => {
  assert.deepEqual(parseTradeDisplaySnapshot({ ...snapshot, values: { symbol: "<script>literal label</script>" } })?.values,
    { symbol: "<script>literal label</script>" });
  const driver = "0x00000000000000000000000000000000000000Ab" as const;
  assert.equal(tradeDisplayIntentKey({ ...intent, driverToken: driver }),
    tradeDisplayIntentKey({ ...intent, driverToken: driver.toLowerCase() as typeof driver }));
  assert.equal(tradeDisplayIntentKey(intent), tradeDisplayIntentKey({ ...intent, showOnlyWalletTokens: true }));
});

test("pre-paint scope reads supported saved display preferences with the ordinary defaults", () => {
  const prefs = storage();
  const defaults = { chainId: 31338, locale: "fr", currency: "USD", goldUnit: "metric", priceDisplayMode: "fiat" };
  assert.deepEqual(readStoredTradeDisplayScope(31338, "fr", prefs), defaults);
  prefs.setItem("display-currency", "CHF");
  prefs.setItem("display-gold-unit", "imperial");
  prefs.setItem("display-price-mode", "gold");
  assert.deepEqual(readStoredTradeDisplayScope(31338, "fr", prefs), {
    ...defaults, currency: "CHF", goldUnit: "imperial", priceDisplayMode: "gold",
  });
  for (const key of ["display-currency", "display-gold-unit", "display-price-mode"]) prefs.setItem(key, "unsupported");
  assert.deepEqual(readStoredTradeDisplayScope(31338, "fr", prefs), defaults);
  assert.deepEqual(readStoredTradeDisplayScope(31338, "fr", { getItem: () => { throw new Error("restricted"); } }), defaults);
});

test("pre-paint helpers remain serializable without references to module closures", () => {
  const restoredIntentKey = Function(`return (${tradeDisplayIntentKey.toString()})`)() as typeof tradeDisplayIntentKey;
  const restoredScopeKey = Function(`return (${tradeDisplayScopeKey.toString()})`)() as typeof tradeDisplayScopeKey;
  const restoredScope = Function(`return (${readStoredTradeDisplayScope.toString()})`)() as typeof readStoredTradeDisplayScope;
  const restoredParser = Function(`return (${parseTradeDisplaySnapshot.toString()})`)() as typeof parseTradeDisplaySnapshot;
  const prefs = storage(); prefs.setItem("display-gold-unit", "imperial");
  assert.equal(restoredIntentKey(intent), snapshot.intentKey);
  assert.equal(restoredScopeKey(restoredScope(31338, "en", prefs)), snapshot.scopeKey);
  assert.deepEqual(restoredParser(snapshot), snapshot);
});
