import { formatUnits } from "viem";

import type { ProtocolBasketData } from "../types";

const FP18_DECIMALS = 18;
const GRAMS_PER_TROY_OUNCE = 31.1034768;

export type GoldReferenceGramsByTokenId = Partial<Record<string, bigint>>;

export function buildGoldReferenceGramsByTokenId(
  protocolBasketData: ProtocolBasketData
): GoldReferenceGramsByTokenId {
  if (!protocolBasketData) return {};

  const [, , goldRefGramsFp18, , , basketComponentSymbols] = protocolBasketData;

  if (goldRefGramsFp18.length !== basketComponentSymbols.length) {
    return {};
  }

  return basketComponentSymbols.reduce<GoldReferenceGramsByTokenId>(
    (acc, symbol, index) => {
      const goldRefGrams = goldRefGramsFp18[index];
      if (goldRefGrams === undefined) {
        return acc;
      }

      acc[symbol.toLowerCase()] = goldRefGrams;
      return acc;
    },
    {}
  );
}

export function getUsdPriceFromGoldReference(params: {
  goldRefGramsFp18?: bigint;
  goldSpotUsdPerOzt?: number;
}): number | undefined {
  const { goldRefGramsFp18, goldSpotUsdPerOzt } = params;

  if (
    goldRefGramsFp18 === undefined ||
    goldSpotUsdPerOzt === undefined ||
    !Number.isFinite(goldSpotUsdPerOzt) ||
    goldSpotUsdPerOzt <= 0
  ) {
    return undefined;
  }

  const grams = Number(formatUnits(goldRefGramsFp18, FP18_DECIMALS));
  if (!Number.isFinite(grams) || grams <= 0) {
    return undefined;
  }

  return (grams / GRAMS_PER_TROY_OUNCE) * goldSpotUsdPerOzt;
}
