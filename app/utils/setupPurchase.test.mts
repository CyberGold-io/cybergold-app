import assert from "node:assert/strict";
import test from "node:test";
import { setupPurchase } from "../../tests/trading/setupPurchase.ts";
import type { ValuationSnapshot } from "../../tests/trading/matrix.ts";
import { protocolConfigurationFixture as config, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";

const valuation = {
  id: "fixture-valuation", prices: {
    [tokenAddresses.PAXG.toLowerCase()]: { numerator: "2000", denominator: "1000000000000000000" },
    [tokenAddresses.CYGLD.toLowerCase()]: { numerator: "100", denominator: "1000000000000000000" },
  },
} as ValuationSnapshot;

test("wallet rejection and inventory setup use valued input budgets, with no exact output promise", () => {
  const rejection = setupPurchase(config, valuation, "0.25", "fixture-wallet-rejection");
  assert.equal(rejection.inputMode, "exact-in");
  assert.equal(rejection.displayAmount, "0.0125");
  assert.equal(rejection.amountRaw, "12500000000000000");
  const bootstrap = setupPurchase(config, valuation, "5", "fixture-cygld-bootstrap");
  assert.equal(bootstrap.inputMode, "exact-in");
  assert.equal(bootstrap.displayAmount, "0.25");
  assert.equal(bootstrap.amountRaw, "250000000000000000");
  assert.equal(bootstrap.valuationId, valuation.id);
  assert.equal(bootstrap.id, "fixture-cygld-bootstrap");
});

test("inventory sizing floors raw PAXG budgets and preserves integers wider than Number", () => {
  const wide = 2n ** 100n;
  const observed = { ...valuation, prices: {
    [tokenAddresses.PAXG.toLowerCase()]: { numerator: "3", denominator: "1" },
    [tokenAddresses.CYGLD.toLowerCase()]: { numerator: String(wide), denominator: "1000000000000000000" },
  } };
  const budget = setupPurchase(config, observed, "5", "fixture-cygld-bootstrap");
  assert.equal(budget.amountRaw, String(5n * wide / 3n));
});

test("missing fixture valuation keeps its ordinary unavailable result", () => {
  assert.throws(() => setupPurchase(config, { ...valuation, prices: {} }, "5", "fixture-cygld-bootstrap"), /valuation-unavailable/);
});
