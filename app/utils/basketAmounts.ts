import { formatUnits } from "viem";
import { getAddress, type Address } from "viem";
import { mulDiv, pow10 } from "./bigIntMath.ts";
import type { BasketComponent, BasketComponentsMapBigInt, BasketComponentsMapString } from "../types.ts";
import { formatNumberWithSpaces } from "./formatting.ts";
import { parseInputToBigInt } from "./numberParsing.ts";

// Returning map: token address => amount as bigint
export function deriveBasketComponentsAmountsFromSingleInput(
  basketComponents: readonly BasketComponent[],
  driverToken: Address | undefined,
  driverAmountStr: string,
  driverAmountOverride?: bigint,
  locale = "en"
): BasketComponentsMapBigInt {
  if (!driverToken || (!driverAmountStr && driverAmountOverride === undefined)) return {};

  const driverComponent = basketComponents.find(
    (component) => getAddress(component.token.address) === getAddress(driverToken)
  );
  if (!driverComponent) return {};

  const driverDecimals = driverComponent.token.decimals;
  const driverTargetWeight = driverComponent.targetWeight;
  if (!driverTargetWeight) return {};

  let driverAmountBigInt: bigint;
  if (driverAmountOverride !== undefined) {
    driverAmountBigInt = driverAmountOverride;
  } else {
    const parsed = parseInputToBigInt(driverAmountStr, driverDecimals, locale);
    if (parsed === undefined) {
      return {};
    }
    driverAmountBigInt = parsed;
  }

  const result: BasketComponentsMapBigInt = {};
  for (const component of basketComponents) {
    const numerator =
      driverAmountBigInt * component.targetWeight * pow10(component.token.decimals);
    // Keep decimal scale and ppm weight proportions when deriving each component amount.
    const denominator = driverTargetWeight * pow10(driverDecimals);
    result[component.token.address] = mulDiv(numerator, 1n, denominator);
  }

  return result;
}

// Returning an ordered array of amounts as bigint, matching the order of the input basket components array:
export function basketAmountsMapToOrderedBigIntArray(
  basketComponents: readonly BasketComponent[],
  amountsByAddress: BasketComponentsMapBigInt
): bigint[] {
  return basketComponents.map(
    (component) => amountsByAddress[component.token.address] ?? 0n
  );
}

/** Largest wallet-funded basket using the form's existing raw-unit proportions. */
export function proportionalBasketWalletMax(
  basketComponents: readonly BasketComponent[],
  walletBalanceByTokenId: Readonly<Record<string, bigint | undefined>>
): {
  driverToken: Address;
  driverAmountRawOverride: bigint;
  amountsByAddress: BasketComponentsMapBigInt;
  maximumAmountsIn: bigint[];
} | undefined {
  let driver: BasketComponent | undefined;
  let driverBalance = 0n;
  let driverProportion = 0n;

  for (const component of basketComponents) {
    if (component.targetWeight === 0n) continue;
    const balance = walletBalanceByTokenId[component.token.id];
    if (balance === undefined) return undefined;
    const proportion = component.targetWeight * pow10(component.token.decimals);
    if (!driver || balance * driverProportion < driverBalance * proportion) {
      driver = component;
      driverBalance = balance;
      driverProportion = proportion;
    }
  }
  if (!driver) return undefined;

  const amountsByAddress = deriveBasketComponentsAmountsFromSingleInput(
    basketComponents, driver.token.address, "", driverBalance
  );
  return {
    driverToken: driver.token.address,
    driverAmountRawOverride: driverBalance,
    amountsByAddress,
    maximumAmountsIn: basketAmountsMapToOrderedBigIntArray(basketComponents, amountsByAddress),
  };
}

// Returning map: token address => amount as string for displaying in the input fields
export function basketAmountsMapToStringMap(
  basketComponents: readonly BasketComponent[],
  amountsByAddress: BasketComponentsMapBigInt,
  locale = "en"
): BasketComponentsMapString {
  if (!Object.keys(amountsByAddress).length) return {};

  const result: BasketComponentsMapString = {};
  for (const component of basketComponents) {
    const amountBigInt = amountsByAddress[component.token.address] ?? 0n;
    result[component.token.address] = formatNumberWithSpaces(
      formatUnits(amountBigInt, component.token.decimals),
      locale
    );
  }
  return result;
}
