import assert from "node:assert/strict";
import test from "node:test";
import type { BasketComponent } from "../types.ts";

import {
  basketAmountsMapToStringMap,
  deriveBasketComponentsAmountsFromSingleInput,
  proportionalBasketWalletMax,
} from "./basketAmounts.ts";

const basketComponents: readonly BasketComponent[] = [
  {
    token: {
      id: "paxg",
      symbol: "PAXG",
      name: "PAX Gold",
      type: "erc20",
      address: "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
      decimals: 18,
    },
    targetWeight: 600000n,
  },
  {
    token: {
      id: "xaut",
      symbol: "XAUt",
      name: "Tether Gold",
      type: "erc20",
      address: "0x68749665FF8D2d112Fa859AA293F07A622782F38",
      decimals: 6,
    },
    targetWeight: 400000n,
  }
];

test("deriveBasketComponentsAmountsFromSingleInput parses localized driver amounts", () => {
  const result = deriveBasketComponentsAmountsFromSingleInput(
    basketComponents,
    "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
    "12 345,67",
    undefined,
    "fr"
  );

  assert.equal(
    result["0x45804880De22913dAFE09f4980848ECE6EcbAf78"],
    12345670000000000000000n
  );
  assert.equal(
    result["0x68749665FF8D2d112Fa859AA293F07A622782F38"],
    8230446666n
  );
});

test("basketAmountsMapToStringMap formats localized decimal output", () => {
  const result = basketAmountsMapToStringMap(
    basketComponents,
    {
      "0x45804880De22913dAFE09f4980848ECE6EcbAf78": 12345670000000000000000n,
      "0x68749665FF8D2d112Fa859AA293F07A622782F38": 8230446666n,
    },
    "fr"
  );

  assert.equal(
    result["0x45804880De22913dAFE09f4980848ECE6EcbAf78"],
    "12 345,67"
  );
  assert.equal(
    result["0x68749665FF8D2d112Fa859AA293F07A622782F38"],
    "8 230,446666"
  );
});

test("basket MAX uses the limiting wallet asset across weights and decimal scales", () => {
  const result = proportionalBasketWalletMax(basketComponents, {
    paxg: 10n ** 18n,
    xaut: 500000n,
  })!;

  assert.equal(result.driverToken, basketComponents[1].token.address);
  assert.equal(result.driverAmountRawOverride, 500000n);
  assert.deepEqual(result.maximumAmountsIn, [750000000000000000n, 500000n]);
  assert.deepEqual(result.amountsByAddress, {
    [basketComponents[0].token.address]: 750000000000000000n,
    [basketComponents[1].token.address]: 500000n,
  });
});

test("basket MAX resolves equal funding ratios in canonical component order", () => {
  const balances = { paxg: 3n * 10n ** 18n, xaut: 2000000n };
  const result = proportionalBasketWalletMax(basketComponents, balances)!;
  assert.equal(result.driverToken, basketComponents[0].token.address);
  assert.deepEqual(result.maximumAmountsIn, [balances.paxg, balances.xaut]);
  assert.equal(proportionalBasketWalletMax([...basketComponents].reverse(), balances)!.driverToken,
    basketComponents[1].token.address);
});

test("basket MAX does not read a zero-weight wallet balance", () => {
  const components = [basketComponents[0], { ...basketComponents[1], targetWeight: 0n }];
  const balances = { paxg: 123n, get xaut(): bigint { throw new Error("unrelated balance read"); } };
  const result = proportionalBasketWalletMax(components, balances)!;
  assert.equal(result.driverToken, components[0].token.address);
  assert.deepEqual(result.maximumAmountsIn, [123n, 0n]);
});

test("basket MAX distinguishes unavailable positive-weight balances from a known zero", () => {
  assert.equal(proportionalBasketWalletMax(basketComponents, { paxg: 1n }), undefined);
  const result = proportionalBasketWalletMax(basketComponents, { paxg: 10n ** 18n, xaut: 0n })!;
  assert.equal(result.driverToken, basketComponents[1].token.address);
  assert.equal(result.driverAmountRawOverride, 0n);
  assert.deepEqual(result.maximumAmountsIn, [0n, 0n]);
  assert.equal(proportionalBasketWalletMax([], {}), undefined);
  assert.equal(proportionalBasketWalletMax(basketComponents.map(component => ({ ...component, targetWeight: 0n })), {}), undefined);
});

test("basket MAX keeps exact wide-integer ratios and floors fractional raw budgets", () => {
  const components = basketComponents.map(component => ({ ...component,
    token: { ...component.token, decimals: 0 }, targetWeight: 1n }));
  const large = 2n ** 200n;
  const result = proportionalBasketWalletMax(components, { paxg: large + 1n, xaut: large })!;
  assert.equal(result.driverToken, components[1].token.address);
  assert.equal(result.driverAmountRawOverride, large);
  assert.deepEqual(result.maximumAmountsIn, [large, large]);

  const tiny = proportionalBasketWalletMax(basketComponents, { paxg: 1n, xaut: 1n })!;
  assert.deepEqual(tiny.maximumAmountsIn, [1n, 0n]);
});

test("basket MAX budgets fit every wallet balance and exhaust the selected limiter", () => {
  for (let first = 0n; first < 8n; first++) for (let second = 0n; second < 8n; second++) {
    const balances = { paxg: first * 10n ** 17n + 3n, xaut: second * 100000n + 1n };
    const result = proportionalBasketWalletMax(basketComponents, balances)!;
    assert.ok(result.maximumAmountsIn[0] <= balances.paxg);
    assert.ok(result.maximumAmountsIn[1] <= balances.xaut);
    const index = basketComponents.findIndex(component => component.token.address === result.driverToken);
    assert.equal(result.maximumAmountsIn[index], balances[basketComponents[index].token.id as keyof typeof balances]);
  }
});
