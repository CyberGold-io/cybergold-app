import assert from "node:assert/strict";
import test from "node:test";
import type { BasketComponent } from "../types.ts";

import {
  basketAmountsMapToStringMap,
  deriveBasketComponentsAmountsFromSingleInput,
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
