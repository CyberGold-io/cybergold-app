import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCurrencyWithCustomGrouping,
  formatGoldAmountForDisplay,
} from "./formatting.ts";
import {
  buildCombinedDisplayValuePlaceholder,
  buildDisplayValuePlaceholder,
  formatCombinedDisplayValueFromUsd,
  formatDisplayValueFromUsd,
  formatSignedUsdForDisplay,
  getPriceDisplayLabel,
} from "./priceDisplay.ts";

test("formatDisplayValueFromUsd returns fiat output in fiat mode", () => {
  const formatted = formatDisplayValueFromUsd({
    amountUsd: 125.5,
    priceDisplayMode: "fiat",
    goldSpotUsdPerOzt: 3320,
    formatFiat: (amountUsd) => `$${amountUsd.toFixed(2)}`,
    formatGoldAmount: (amountOzt) => `${amountOzt.toFixed(4)} troy oz`,
  });

  assert.equal(formatted, "$125.50");
});

test("formatDisplayValueFromUsd returns gold output in gold mode", () => {
  const formatted = formatDisplayValueFromUsd({
    amountUsd: 1660,
    priceDisplayMode: "gold",
    goldSpotUsdPerOzt: 3320,
    formatFiat: (amountUsd) => `$${amountUsd.toFixed(2)}`,
    formatGoldAmount: (amountOzt) => `${amountOzt.toFixed(2)} troy oz`,
  });

  assert.equal(formatted, "0.50 troy oz");
});

test("formatSignedUsdForDisplay preserves sign for both modes", () => {
  const goldFormatted = formatSignedUsdForDisplay(-1660, {
    priceDisplayMode: "gold",
    goldSpotUsdPerOzt: 3320,
    formatFiat: (amountUsd) => `$${amountUsd.toFixed(2)}`,
    formatGoldAmount: (amountOzt) => `${amountOzt.toFixed(2)} troy oz`,
  });
  const fiatFormatted = formatSignedUsdForDisplay(125.5, {
    priceDisplayMode: "fiat",
    goldSpotUsdPerOzt: 3320,
    formatFiat: (amountUsd) => `$${amountUsd.toFixed(2)}`,
    formatGoldAmount: (amountOzt) => `${amountOzt.toFixed(2)} troy oz`,
  });

  assert.equal(goldFormatted, "-0.50 troy oz");
  assert.equal(fiatFormatted, "+$125.50");
});

test("formatCombinedDisplayValueFromUsd returns gold and fiat output", () => {
  const formatted = formatCombinedDisplayValueFromUsd({
    amountUsd: 1660,
    goldSpotUsdPerOzt: 3320,
    formatFiat: (amountUsd) => `$${amountUsd.toFixed(2)}`,
    formatGoldAmount: (amountOzt) => `${amountOzt.toFixed(2)} troy oz`,
  });

  assert.equal(formatted, "0.50 troy oz • $1660.00");
});

test("zero equivalents use the selected gold and currency format without a spot price", () => {
  for (const goldSpotUsdPerOzt of [undefined, 0, -1, Number.NaN]) {
    const params = {
      amountUsd: 0,
      goldSpotUsdPerOzt,
      formatFiat: (amountUsd: number) => formatCurrencyWithCustomGrouping(amountUsd, "en", "USD"),
      formatGoldAmount: (amountOzt: number) => formatGoldAmountForDisplay(amountOzt, "en", "metric"),
    };

    assert.equal(formatCombinedDisplayValueFromUsd(params), "0.00 g of gold • $0.00");
    assert.equal(
      formatDisplayValueFromUsd({ ...params, priceDisplayMode: "gold" }),
      "0.00 g of gold"
    );
    assert.equal(
      formatCombinedDisplayValueFromUsd({ ...params, amountUsd: 1 }),
      undefined
    );
  }
});

test("zero equivalents preserve localized units and currency placement", () => {
  assert.equal(
    formatCombinedDisplayValueFromUsd({
      amountUsd: 0,
      formatFiat: (amountUsd) => formatCurrencyWithCustomGrouping(amountUsd, "fr", "EUR"),
      formatGoldAmount: (amountOzt) => formatGoldAmountForDisplay(amountOzt, "fr", "metric"),
    }),
    "0,00 g d'or • 0,00\u00a0€"
  );
});

test("buildDisplayValuePlaceholder reflects the active display mode", () => {
  assert.equal(
    buildDisplayValuePlaceholder({
      zeroAmountPlaceholder: "0.0",
      priceDisplayMode: "fiat",
      selectedCurrency: "USD",
      selectedGoldUnit: "metric",
    }),
    "0.0 USD"
  );

  assert.equal(
    buildDisplayValuePlaceholder({
      zeroAmountPlaceholder: "0.0",
      priceDisplayMode: "gold",
      selectedCurrency: "USD",
      selectedGoldUnit: "imperial",
    }),
    "0.0 troy oz"
  );

  assert.equal(
    buildDisplayValuePlaceholder({
      zeroAmountPlaceholder: "0.0",
      priceDisplayMode: "gold",
      selectedCurrency: "USD",
      selectedGoldUnit: "metric",
      locale: "en",
    }),
    "0.0 g of gold"
  );
});

test("buildCombinedDisplayValuePlaceholder reflects gold and fiat units", () => {
  assert.equal(
    buildCombinedDisplayValuePlaceholder({
      zeroAmountPlaceholder: "0.0",
      selectedCurrency: "CHF",
      selectedGoldUnit: "metric",
      locale: "fr",
    }),
    "0.0 g d'or • 0.0\u00a0CHF"
  );
});

test("loading equivalents use the selected currency symbol and locale placement", () => {
  for (const [locale, selectedCurrency] of [["en", "USD"], ["fr", "EUR"], ["fr", "USD"]]) {
    const formattedZero = formatCurrencyWithCustomGrouping(0, locale, selectedCurrency);
    const expectedFiatPlaceholder = formattedZero.replace(/0[.,]00/, "...");
    const goldUnit = locale === "fr" ? "g d'or" : "g of gold";

    assert.equal(
      buildCombinedDisplayValuePlaceholder({
        zeroAmountPlaceholder: "...",
        selectedCurrency,
        selectedGoldUnit: "metric",
        locale,
      }),
      `... ${goldUnit} • ${expectedFiatPlaceholder}`
    );
  }
});

test("getPriceDisplayLabel reflects the active display mode", () => {
  assert.equal(getPriceDisplayLabel("fiat", "CHF", "metric"), "CHF");
  assert.equal(getPriceDisplayLabel("gold", "USD", "imperial"), "troy oz");
  assert.equal(getPriceDisplayLabel("gold", "USD", "metric"), "g/kg/t of gold");
  assert.equal(getPriceDisplayLabel("gold", "USD", "metric", "fr"), "g/kg/t d'or");
});
