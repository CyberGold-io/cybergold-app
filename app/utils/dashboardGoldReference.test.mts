import assert from "node:assert/strict";
import test from "node:test";
import { dashboardGoldReference } from "./dashboardGoldReference.ts";

test("the dashboard needs a real configured weight before showing a gold reference", () => {
  for (const grams of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.deepEqual(dashboardGoldReference(grams, 3110.34768), { grams: null, usd: null });
  }
});

test("missing gold prices preserve the known weight without inventing a fiat price", () => {
  for (const quote of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.deepEqual(dashboardGoldReference(2, quote), { grams: 2, usd: null });
  }
});

test("the gold reference uses the actual configured weight and available quote", () => {
  const reference = dashboardGoldReference(2, 3110.34768);
  assert.equal(reference.grams, 2);
  assert.ok(Math.abs(reference.usd! - 200) < 1e-10);
  assert.equal(dashboardGoldReference(Number.MAX_VALUE, Number.MAX_VALUE).usd, null);
});
