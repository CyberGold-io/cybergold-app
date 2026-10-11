import assert from "node:assert/strict";
import test from "node:test";

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
    "0.0 g d'or • 0.0 CHF"
  );
});

test("getPriceDisplayLabel reflects the active display mode", () => {
  assert.equal(getPriceDisplayLabel("fiat", "CHF", "metric"), "CHF");
  assert.equal(getPriceDisplayLabel("gold", "USD", "imperial"), "troy oz");
  assert.equal(getPriceDisplayLabel("gold", "USD", "metric"), "g/kg/t of gold");
  assert.equal(getPriceDisplayLabel("gold", "USD", "metric", "fr"), "g/kg/t d'or");
});
