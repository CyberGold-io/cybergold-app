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
