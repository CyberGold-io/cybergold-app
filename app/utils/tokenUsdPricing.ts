import type { TokenType } from "../types.ts";
import { getUsdPriceFromGoldReference, type GoldReferenceGramsByTokenId } from "./goldReferencePricing.ts";
import type { PoolSnapshot } from "./poolSnapshot.ts";

const PRICE_SCALE = 10n ** 18n;
export type TokenUsdPriceOptions = {
  goldSpotUsdPerOzt?: number;
  goldReferenceGramsByTokenId?: GoldReferenceGramsByTokenId;
};
// Canonical marginal-price conversion only; swap arithmetic stays in Backend's SDK worker.
function price1Over0(sqrtPriceX96: bigint, decimals0: number, decimals1: number) {
  const priceX192 = sqrtPriceX96 * sqrtPriceX96; // keep full precision by staying in bigint
  const decimalDelta = decimals0 - decimals1;

  const numerator =
    priceX192 *
    PRICE_SCALE *
    (decimalDelta >= 0 ? 10n ** BigInt(decimalDelta) : 1n);
  const denominator =
    (1n << 192n) *
    (decimalDelta < 0 ? 10n ** BigInt(-decimalDelta) : 1n);

  return numerator / denominator; // bigint fixed-point (scaled by PRICE_SCALE)
}

function deriveBasketPrices(prices: Record<string, number | undefined>, tokenList: TokenType[]) {
  tokenList.forEach((token) => {
    if (token.type !== "basket") return;
    const weighted = token.components.reduce<number | undefined>((sum, component) => {
      if (component.targetWeight === 0n) return sum;
      const componentPrice = prices[component.token?.id];
      if (sum === undefined || componentPrice === undefined) return undefined;
      return sum + componentPrice * Number(component.targetWeight) / 1_000_000;
    }, 0);
    prices[token.id] = weighted;
  });
}

function applyGoldReferenceTokenPrices(
  prices: Record<string, number | undefined>,
  tokenList: TokenType[],
  options?: TokenUsdPriceOptions
) {
  tokenList.forEach((token) => {
    if (token.type !== "erc20") return;

    const priceFromGoldReference = getUsdPriceFromGoldReference({
      goldRefGramsFp18: options?.goldReferenceGramsByTokenId?.[token.id],
      goldSpotUsdPerOzt: options?.goldSpotUsdPerOzt,
    });

    if (priceFromGoldReference !== undefined) {
      prices[token.id] = priceFromGoldReference;
    }
  });
}

export function tokenUsdPricesFromSnapshots(observations: readonly (PoolSnapshot | undefined)[], tokenList: TokenType[], options?: TokenUsdPriceOptions) {
  const tokensByAddress = new Map(tokenList.flatMap(token => token.type === "erc20"
    ? [[token.address.toLowerCase(), token] as const] : []));
  // Seed with the assumption that 1 USDC = 1 USD
  const discovered: Record<string, number | undefined> = { usdc: 1 };
  applyGoldReferenceTokenPrices(discovered, tokenList, options);
  let updated = true;

  while (updated) {
    updated = false;

    observations.forEach(observation => {
      if (!observation?.exists) return;
      const token0 = tokensByAddress.get(observation.token0.toLowerCase());
      const token1 = tokensByAddress.get(observation.token1.toLowerCase());
      if (!token0 || !token1) return;
      let token1PerToken0: bigint;
      if (observation.marginalPrice) {
        const numerator = BigInt(observation.marginalPrice.numerator);
        const denominator = BigInt(observation.marginalPrice.denominator);
        if (!denominator) return;
        token1PerToken0 = numerator * PRICE_SCALE * 10n ** BigInt(token0.decimals)
          / (denominator * 10n ** BigInt(token1.decimals));
      } else if (observation.sqrtPriceX96Raw !== undefined) {
        token1PerToken0 = price1Over0(BigInt(observation.sqrtPriceX96Raw), token0.decimals, token1.decimals);
      } else return;
      if (!token1PerToken0) return;
      const token1PerToken0Float = Number(token1PerToken0) / Number(PRICE_SCALE);

      /*
        To express both sides in USD:
        - If we know price(token0) in USD and have token1PerToken0 (token1 per token0),
          then price(token1) = price(token0) / token1PerToken0.
        - If we know price(token1) in USD, then price(token0) = price(token1) * token1PerToken0.
      */

      if (discovered[token0.id] !== undefined && discovered[token1.id] === undefined) {
        discovered[token1.id] = discovered[token0.id]! / token1PerToken0Float;
        updated = true;
      }

      if (discovered[token1.id] !== undefined && discovered[token0.id] === undefined) {
        discovered[token0.id] = discovered[token1.id]! * token1PerToken0Float;
        updated = true;
      }
    });
  }

  applyGoldReferenceTokenPrices(discovered, tokenList, {
    goldReferenceGramsByTokenId: options?.goldReferenceGramsByTokenId,
    goldSpotUsdPerOzt: options?.goldSpotUsdPerOzt,
  });
  deriveBasketPrices(discovered, tokenList);

  if (discovered.eth === undefined && discovered.weth !== undefined) {
    discovered.eth = discovered.weth;
  }
  if (discovered.weth === undefined && discovered.eth !== undefined) {
    discovered.weth = discovered.eth;
  }

  // Ensure every token id is present in the returned dictionary
  const complete = tokenList.reduce<Record<string, number | undefined>>((acc, token) => {
    acc[token.id] = discovered[token.id];
    return acc;
  }, {});

  return complete;
}
