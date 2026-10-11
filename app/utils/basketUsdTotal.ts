import type { BasketComponent } from "../types";
import { parseDisplayNumber } from "./numberParsing.ts";

export function computeBasketComponentsUsdTotal(params: {
  basketComponents: readonly BasketComponent[];
  prices: Record<string, number | undefined> | undefined;
  // getAmountStr is a helper (callback or internal function of a function) which returns amount string: 
  getAmountStr: (component: BasketComponent, index: number) => string;
  locale?: string;
}): number | undefined {
  const { basketComponents, prices, getAmountStr, locale = "en" } = params;

  return basketComponents.reduce<number | undefined>((sum, component, index) => {
    const componentPriceUsd = prices?.[component.token.id];
    const amount = parseDisplayNumber(getAmountStr(component, index), locale);

    if (amount === undefined || !Number.isFinite(amount) || amount === 0) return sum;
    // An unavailable component price cannot contribute to a complete total.
    if (sum === undefined || componentPriceUsd === undefined || !Number.isFinite(componentPriceUsd)) return undefined;

    return sum + amount * componentPriceUsd;
  }, 0);
}

export function computeBasketSideUsdTotal(params: {
  tokenId: string;
  basketTokenId?: string;
  basketComponents: readonly BasketComponent[];
  prices: Record<string, number | undefined> | undefined;
  driverToken?: `0x${string}`;
  driverAmountStr: string;
  derivedBasketAmountsAsStringMap: Record<`0x${string}`, string>;
  isSideInputEnabled: boolean;
  quotedComponents: readonly string[];
  locale?: string;
}): number | undefined {
  const {
    tokenId,
    basketTokenId = "goldbasket",
    basketComponents,
    prices,
    driverToken,
    driverAmountStr,
    derivedBasketAmountsAsStringMap,
    isSideInputEnabled,
    quotedComponents,
    locale = "en",
  } = params;

  if (tokenId !== basketTokenId) return 0;

  return computeBasketComponentsUsdTotal({
    basketComponents,
    prices,
    locale,
    getAmountStr: (component, index) => {
      const componentAddress = component.token.address as `0x${string}`;
      const isDriver = componentAddress === driverToken;
      const derivedValue = derivedBasketAmountsAsStringMap[componentAddress] ?? "";

      return isSideInputEnabled
        ? (isDriver ? driverAmountStr : derivedValue)
        : (quotedComponents[index] ?? "");
    },
  });
}
