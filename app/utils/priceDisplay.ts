import type { GoldUnit, PriceDisplayMode } from "../context/currencyContext";
import { formatGoldQualifiedLabel } from "./formatting.ts";

type FiatFormatOptions = {
  compact?: boolean;
};

type FormatDisplayValueFromUsdParams = {
  amountUsd: number;
  priceDisplayMode: PriceDisplayMode;
  goldSpotUsdPerOzt?: number;
  formatFiat: (amountUsd: number, options?: FiatFormatOptions) => string;
  formatGoldAmount: (amountOzt: number) => string;
  options?: FiatFormatOptions;
};

type BuildDisplayValuePlaceholderParams = {
  zeroAmountPlaceholder: string;
  priceDisplayMode: PriceDisplayMode;
  selectedCurrency: string;
  selectedGoldUnit: GoldUnit;
  locale?: string;
};

type BuildCombinedDisplayValuePlaceholderParams = Omit<
  BuildDisplayValuePlaceholderParams,
  "priceDisplayMode"
>;

function getGoldUnitLabel(selectedGoldUnit: GoldUnit, locale = "en") {
  return selectedGoldUnit === "imperial" ? "troy oz" : formatGoldQualifiedLabel("g", locale);
}

export function formatDisplayValueFromUsd({
  amountUsd,
  priceDisplayMode,
  goldSpotUsdPerOzt,
  formatFiat,
  formatGoldAmount,
  options,
}: FormatDisplayValueFromUsdParams): string | undefined {
  if (!Number.isFinite(amountUsd)) {
    return undefined;
  }

  if (priceDisplayMode === "gold") {
    if (
      goldSpotUsdPerOzt === undefined ||
      !Number.isFinite(goldSpotUsdPerOzt) ||
      goldSpotUsdPerOzt <= 0
    ) {
      return undefined;
    }

    return formatGoldAmount(amountUsd / goldSpotUsdPerOzt);
  }

  return formatFiat(amountUsd, options);
}

export function formatSignedUsdForDisplay(
  valueUsd: number,
  params: Omit<FormatDisplayValueFromUsdParams, "amountUsd">
): string | undefined {
  if (!Number.isFinite(valueUsd)) {
    return undefined;
  }

  const formatted = formatDisplayValueFromUsd({
    ...params,
    amountUsd: Math.abs(valueUsd),
  });

  if (!formatted) {
    return undefined;
  }

  return `${valueUsd >= 0 ? "+" : "-"}${formatted}`;
}

export function formatCombinedDisplayValueFromUsd({
  amountUsd,
  goldSpotUsdPerOzt,
  formatFiat,
  formatGoldAmount,
  options,
}: Omit<FormatDisplayValueFromUsdParams, "priceDisplayMode">): string | undefined {
  if (!Number.isFinite(amountUsd)) {
    return undefined;
  }

  if (
    goldSpotUsdPerOzt === undefined ||
    !Number.isFinite(goldSpotUsdPerOzt) ||
    goldSpotUsdPerOzt <= 0
  ) {
    return undefined;
  }

  const goldEquivalent = formatGoldAmount(amountUsd / goldSpotUsdPerOzt);
  const fiatEquivalent = formatFiat(amountUsd, options);

  return `${goldEquivalent} • ${fiatEquivalent}`;
}

export function buildDisplayValuePlaceholder({
  zeroAmountPlaceholder,
  priceDisplayMode,
  selectedCurrency,
  selectedGoldUnit,
  locale = "en",
}: BuildDisplayValuePlaceholderParams) {
  if (priceDisplayMode === "gold") {
    return `${zeroAmountPlaceholder} ${getGoldUnitLabel(selectedGoldUnit, locale)}`;
  }

  return `${zeroAmountPlaceholder} ${selectedCurrency}`;
}

export function buildCombinedDisplayValuePlaceholder({
  zeroAmountPlaceholder,
  selectedCurrency,
  selectedGoldUnit,
  locale = "en",
}: BuildCombinedDisplayValuePlaceholderParams) {
  const goldUnitLabel = getGoldUnitLabel(selectedGoldUnit, locale);
  return `${zeroAmountPlaceholder} ${goldUnitLabel} • ${zeroAmountPlaceholder} ${selectedCurrency}`;
}

export function getPriceDisplayLabel(
  priceDisplayMode: PriceDisplayMode,
  selectedCurrency: string,
  selectedGoldUnit: GoldUnit,
  locale = "en"
) {
  if (priceDisplayMode === "gold") {
    return selectedGoldUnit === "imperial"
      ? "troy oz"
      : formatGoldQualifiedLabel("g/kg/t", locale);
  }

  return selectedCurrency;
}
