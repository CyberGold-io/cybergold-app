import { zeroAddress, type Address } from "viem";
import type { BasketComponent, SwapToQuote } from "../types";

function calculateDirectBasketInputAmount(params: {
  enabled: boolean;
  inputToken?: Address;
  basketAmountsInRequired: readonly bigint[] | undefined;
  basketComponents: readonly BasketComponent[];
}): bigint {
  const { enabled, inputToken, basketAmountsInRequired, basketComponents } =
    params;

  if (!enabled || !inputToken) return 0n;
  if (
    !Array.isArray(basketAmountsInRequired) ||
    basketAmountsInRequired.length !== basketComponents.length
  ) {
    return 0n;
  }

  const resolvedInputToken = inputToken.toLowerCase();
  const matchingBasketComponentIndex = basketComponents.findIndex(
    (component) => component.token.address.toLowerCase() === resolvedInputToken
  );
  if (matchingBasketComponentIndex === -1) return 0n;

  return basketAmountsInRequired[matchingBasketComponentIndex] ?? 0n;
}

export function calculateMaxInputAmount(params: {
  enabled: boolean;
  inputToken?: Address;
  basketAmountsInRequired: readonly bigint[] | undefined;
  basketComponents: readonly BasketComponent[];
  issueSwapQuotes: readonly SwapToQuote[] | undefined;
}): bigint | undefined {
  const {
    enabled,
    inputToken,
    basketAmountsInRequired,
    basketComponents,
    issueSwapQuotes,
  } = params;

  if (!enabled || !issueSwapQuotes) return undefined;
  // This is amount to be allocated for the entered exact-out ERC-20 token, in case it belongs to the basket components:
  const directBasketInputAmount = calculateDirectBasketInputAmount({
    enabled,
    inputToken,
    basketAmountsInRequired,
    basketComponents,
  });
  return issueSwapQuotes.reduce((sum, quote) => sum + quote.amountIn, 0n) + directBasketInputAmount;
}

export function isNativeInputTokenAddress(inputToken: Address | undefined): boolean {
  return inputToken?.toLowerCase() === zeroAddress;
}
