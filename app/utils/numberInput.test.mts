import assert from "node:assert/strict";
import test from "node:test";
import { decimalFromPaste, deleteNumberInput, editNumberInput, replaceNumberInput } from "./numberInput.ts";
import { canonicalizeLocalizedNumberString, formatNumberWithSpaces, ungroupLocalizedNumber } from "./formatting.ts";
import { parseInputToBigInt } from "./numberParsing.ts";

test("paste distinguishes grouping from decimals and retains all digits", () => {
  for (const [locale, source, expected] of [
    ["en", "12,345.67", "12345.67"], ["de", "12.345,67", "12345.67"],
    ["fr", "12\u202f345,67", "12345.67"], ["fr", "12 345,67", "12345.67"],
    ["en", "1,234", "1234"], ["de", "1.234", "1234"],
    ["fr", "1,234", "1.234"], ["en", "1.234", "1.234"],
    ["de", "1234.56", "1234.56"], ["en", "12.345,67", "12345.67"],
    ["de", "12,345.67", "12345.67"], ["en", "12’345.67", "12345.67"],
    ["de", "1.234.567,8900", "1234567.8900"], ["en", "00", "00"],
    ["en", "1.", "1."], ["fr", ",00100", ".00100"],
    ["en", "9,007,199,254,740,993.123456789012345678", "9007199254740993.123456789012345678"],
  ]) assert.equal(decimalFromPaste(source, locale), expected, `${locale}: ${source}`);
});

test("typing punctuation converts only the new character, never existing grouping", () => {
  assert.deepEqual(editNumberInput("12,345", "12,345,", "en"), { value: "12,345.", selectionStart: 7 });
  assert.deepEqual(editNumberInput("12.345", "12.345.", "de"), { value: "12.345,", selectionStart: 7 });
  assert.deepEqual(editNumberInput("12.345", "12.345,", "de"), { value: "12.345,", selectionStart: 7 });
  assert.deepEqual(editNumberInput("1,234,567", "1,2934,567", "en"), { value: "12,934,567", selectionStart: 4 });
  assert.deepEqual(editNumberInput("1.234.567", "1.25", "de", "insertText", 4, "1.25"),
    { value: "1,25", selectionStart: 4 });
  assert.deepEqual(editNumberInput("111", "11", "en", "deleteContentBackward", 1, null),
    { value: "11", selectionStart: 1 });
});

test("backspace and delete ignore grouping while decimals remain editable", () => {
  assert.deepEqual(deleteNumberInput("12,345", "en", 3, 3, true), { value: "1,345", selectionStart: 1 });
  assert.deepEqual(deleteNumberInput("12,345", "en", 2, 2, false), { value: "1,245", selectionStart: 3 });
  assert.deepEqual(deleteNumberInput("12.345,67", "de", 7, 7, true), { value: "1.234.567", selectionStart: 7 });
  assert.equal(deleteNumberInput("12,345.67", "en", 0, 9, true).value, "");
  assert.equal(deleteNumberInput("12,345", "en", 2, 3, true).value, "1,345");
  assert.deepEqual(editNumberInput("12,345", "12345", "en", "deleteContentBackward"), { value: "1,345", selectionStart: 1 });
  assert.deepEqual(editNumberInput("12,345", "12345", "en", "deleteContentForward"), { value: "1,245", selectionStart: 3 });
});

test("partial replacements and paste preserve fractional zeros and exact precision", () => {
  assert.deepEqual(replaceNumberInput("12,345.67", "en", 3, 6, "9"), { value: "129.67", selectionStart: 3 });
  assert.equal(replaceNumberInput("1.25", "en", 3, 3, decimalFromPaste("00", "en")).value, "1.2005");
  const source = "9007199254740993.123456789012345678";
  for (const locale of ["en", "fr", "de", "de-CH"]) {
    const display = formatNumberWithSpaces(source, locale);
    assert.equal(canonicalizeLocalizedNumberString(display, locale).canonical, source);
    assert.equal(parseInputToBigInt(display, 18, locale), 9007199254740993123456789012345678n);
    assert.equal(ungroupLocalizedNumber(display, locale).replace(",", "."), source);
  }
});

test("changing language reformats the same exact value", () => {
  const source = "1234567.8900";
  for (const from of ["en", "fr", "de"]) for (const to of ["en", "fr", "de"]) {
    const canonical = canonicalizeLocalizedNumberString(formatNumberWithSpaces(source, from), from).canonical;
    assert.equal(formatNumberWithSpaces(canonical, to), formatNumberWithSpaces(source, to));
  }
});
