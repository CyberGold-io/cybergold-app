import assert from "node:assert/strict";
import test from "node:test";
import { purchaseBudgetAmounts } from "./tradeBudget.ts";

test("a capped purchase exposes only its spending and whether it matches the budget", () => {
  const unit = 10n ** 18n;
  assert.deepEqual(purchaseBudgetAmounts(100n * unit, { quotedInput: 30n * unit, inputMaximum: 303n * unit / 10n }), {
    spending: 30n * unit, matchesBudget: false,
  });
});

test("budget arithmetic preserves sub-token and wide raw quantities", () => {
  const budget = 2n ** 210n + 17n;
  assert.deepEqual(purchaseBudgetAmounts(budget, { quotedInput: budget - 1n, inputMaximum: budget }), {
    spending: budget - 1n, matchesBudget: false,
  });
});

test("a fully spent budget still exposes its spending without a limited-budget highlight", () => {
  assert.deepEqual(purchaseBudgetAmounts(100n, { quotedInput: 100n, inputMaximum: 100n }), {
    spending: 100n, matchesBudget: true,
  });
});

test("an unquoted positive budget has no invented spending, while a zero budget spends zero", () => {
  assert.equal(purchaseBudgetAmounts(100n), undefined);
  assert.deepEqual(purchaseBudgetAmounts(0n), { spending: 0n, matchesBudget: true });
});
