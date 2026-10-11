import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCurrencyWithCustomGrouping,
  formatDecimalInputForCursor,
  formatGoldAmountForDisplay,
  formatGoldQualifiedLabel,
  formatNumberWithCustomGrouping,
  formatNumberWithSpaces,
  formatWalletBalanceAmount,
  getLocaleDecimalSeparator,
  getGoldQualifier,
  normalizeDecimalInput,
} from "./formatting.ts";
import { parseDisplayNumber, parseInputToBigInt } from "./numberParsing.ts";

test("formatNumberWithSpaces keeps space grouping and locale decimal separator", () => {
  assert.equal(formatNumberWithSpaces("12345.67", "en"), "12 345.67");
  assert.equal(formatNumberWithSpaces("12345.67", "fr"), "12 345,67");
});

test("wallet balances count initial zeros toward six displayed digits and identify amounts below the display precision", () => {
  assert.equal(formatWalletBalanceAmount(0n, 18), "0");
  assert.equal(formatWalletBalanceAmount(1n, 18), "<0.00001");
  assert.equal(formatWalletBalanceAmount(9999999999999n, 18), "<0.00001");
  assert.equal(formatWalletBalanceAmount(10000000000000n, 18), "0.00001");
  assert.equal(formatWalletBalanceAmount(12345n, 6), "0.01235");
  assert.equal(formatWalletBalanceAmount(123456n, 6), "0.12346");
  assert.equal(formatWalletBalanceAmount(1230000000000000000n, 18), "1.23");
  assert.equal(formatWalletBalanceAmount(13981234567890000n, 18), "0.01398");
  assert.equal(formatWalletBalanceAmount(113448123456789000000n, 18), "113.448");
});

test("wallet balances round their available decimal places while preserving every integer digit", () => {
  assert.equal(formatWalletBalanceAmount(1234564n, 6), "1.23456");
  assert.equal(formatWalletBalanceAmount(1234565n, 6), "1.23457");
  assert.equal(formatWalletBalanceAmount(1234567890000n, 6), "1 234 568");
  assert.equal(formatWalletBalanceAmount(999999500000n, 6), "1 000 000");
  assert.equal(formatWalletBalanceAmount(1234567890123456789012345678901234567890n, 18), "1 234 567 890 123 456 789 012");
});

test("wallet balances retain locale decimal separators and space grouping", () => {
  assert.equal(formatWalletBalanceAmount(13981234567890000n, 18, "fr"), "0,01398");
  assert.equal(formatWalletBalanceAmount(1n, 18, "fr"), "<0,00001");
  assert.equal(formatWalletBalanceAmount(1234567890n, 6, "fr"), "1 234,57");
});

test("normalizeDecimalInput accepts dot and comma while formatting for locale", () => {
  assert.equal(normalizeDecimalInput("12345.67", "fr"), "12 345,67");
  assert.equal(normalizeDecimalInput("12 345,67", "fr"), "12 345,67");
  assert.equal(normalizeDecimalInput("12345,67", "en"), "12 345.67");
  assert.equal(normalizeDecimalInput(undefined, "en"), "");
});

test("formatDecimalInputForCursor preserves a reasonable caret position", () => {
  assert.deepEqual(formatDecimalInputForCursor("12345,67", "fr", 5), {
    value: "12 345,67",
    selectionStart: 6,
  });
});

test("parseInputToBigInt parses locale-formatted amounts", () => {
  assert.equal(parseInputToBigInt("12 345,67", 2, "fr"), 1234567n);
  assert.equal(parseInputToBigInt("12 345.67", 2, "en"), 1234567n);
});

test("parseDisplayNumber parses locale-formatted values", () => {
  assert.equal(parseDisplayNumber("12 345,67", "fr"), 12345.67);
  assert.equal(parseDisplayNumber("12 345.67", "en"), 12345.67);
});

test("getLocaleDecimalSeparator resolves french comma", () => {
  assert.equal(getLocaleDecimalSeparator("fr"), ",");
});

test("formatGoldAmountForDisplay shows more precision for small imperial amounts", () => {
  assert.equal(formatGoldAmountForDisplay(0.0003215074656862798, "en", "imperial"), "0.00032 troy oz");
  assert.equal(formatGoldAmountForDisplay(0.5, "en", "imperial"), "0.500 troy oz");
});

test("formatGoldAmountForDisplay switches metric units automatically", () => {
  assert.equal(formatGoldAmountForDisplay(1, "en", "metric"), "31.10 g of gold");
  assert.equal(formatGoldAmountForDisplay(100, "en", "metric"), "3.11 kg of gold");
  assert.equal(formatGoldAmountForDisplay(1, "fr", "metric"), "31,10 g d'or");
});

test("gold qualifiers are localized", () => {
  assert.equal(getGoldQualifier("en"), "of gold");
  assert.equal(getGoldQualifier("fr-FR"), "d'or");
  assert.equal(formatGoldQualifiedLabel("g", "en"), "g of gold");
  assert.equal(formatGoldQualifiedLabel("g", "fr"), "g d'or");
});

test("formatCurrencyWithCustomGrouping keeps Intl currency placement and custom grouping", () => {
  assert.equal(
    formatCurrencyWithCustomGrouping(12345.67, "en-US", "USD", { maximumFractionDigits: 2 }),
    "$12 345.67"
  );
  assert.equal(
    formatCurrencyWithCustomGrouping(12345.67, "fr-FR", "EUR", { maximumFractionDigits: 2 }),
    `12 345,67${String.fromCharCode(160)}${String.fromCharCode(8364)}`
  );
});

test("formatNumberWithCustomGrouping formats token-like amounts", () => {
  assert.equal(
    formatNumberWithCustomGrouping(12345.678, "en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }),
    "12 345.678"
  );
  assert.equal(
    formatNumberWithCustomGrouping(12345.678, "fr-FR", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }),
    "12 345,678"
  );
});
