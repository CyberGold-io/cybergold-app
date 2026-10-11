import assert from "node:assert/strict";
import test from "node:test";
import type { BasketComponent } from "../types.ts";
import { computeBasketComponentsUsdTotal } from "./basketUsdTotal.ts";

const basketComponents: BasketComponent[] = ["paxg", "xaut"].map((id, index) => ({
  token: { id, symbol: id.toUpperCase(), name: id, type: "erc20", decimals: 18,
    address: `0x${String(index + 1).repeat(40)}` as `0x${string}` },
  targetWeight: 500000n,
}));

test("an unavailable component price cannot turn a partial value into a basket total", () => {
  const params = { basketComponents, getAmountStr: () => "2" };
  assert.equal(computeBasketComponentsUsdTotal({ ...params, prices: { paxg: 3000 } }), undefined);
  assert.equal(computeBasketComponentsUsdTotal({ ...params, prices: { xaut: 3100 } }), undefined);
  assert.equal(computeBasketComponentsUsdTotal({ ...params, prices: { paxg: 3000, xaut: 3100 } }), 12200);
});

test("zero and empty amounts do not need an unrelated token price", () => {
  assert.equal(computeBasketComponentsUsdTotal({ basketComponents, prices: { paxg: 3000 },
    getAmountStr: (_, index) => index === 0 ? "2" : "0" }), 6000);
  assert.equal(computeBasketComponentsUsdTotal({ basketComponents, prices: undefined,
    getAmountStr: () => "" }), 0);
});

test("localized basket inputs retain their complete valuation", () => {
  assert.equal(computeBasketComponentsUsdTotal({ basketComponents, prices: { paxg: 3000, xaut: 3100 },
    locale: "fr", getAmountStr: () => "1,5" }), 9150);
});
