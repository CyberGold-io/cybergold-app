import assert from "node:assert/strict";
import test from "node:test";

import type { ProtocolBasketData } from "../types.ts";

import {
  buildGoldReferenceGramsByTokenId,
  getUsdPriceFromGoldReference,
} from "./goldReferencePricing.ts";

const protocolBasketData: ProtocolBasketData = [
  [
    "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
    "0x68749665FF8D2d112Fa859AA293F07A622782F38",
  ],
  [600000n, 400000n],
  [31103476800000000000n, 31103476800000000000n],
  [18, 6],
  ["Paxos Gold", "Tether Gold"],
  ["PAXG", "XAUt"],
  [1000000000000000000n, 1000000000000000000n],
];

test("buildGoldReferenceGramsByTokenId maps basket symbols to gold reference grams", () => {
  const result = buildGoldReferenceGramsByTokenId(protocolBasketData);

  assert.deepEqual(result, {
    paxg: 31103476800000000000n,
    xaut: 31103476800000000000n,
  });
});

test("getUsdPriceFromGoldReference converts one troy ounce reference to spot USD", () => {
  const priceUsd = getUsdPriceFromGoldReference({
    goldRefGramsFp18: 31103476800000000000n,
    goldSpotUsdPerOzt: 3320,
  });

  assert.ok(priceUsd !== undefined);
  assert.ok(Math.abs(priceUsd - 3320) < 1e-9);
});
