import assert from "node:assert/strict";
import test from "node:test";
import { runnerFundingPlan, observeRunnerCygld, observeRunnerPaxg } from "../../tests/trading/runnerFunding.ts";
import { ownedPaxgStartupFunding } from "../../tests/trading/ownedWalletFunding.ts";
import { activeMatrixTemplates, type MatrixScenario, type ValuationSnapshot } from "../../tests/trading/matrix.ts";
import { protocolConfigurationFixture as config, tokenAddresses } from "../../tests/fixtures/protocol-configuration.ts";

const unit = 10n ** 18n;
const valuation = { id: "frozen-before-setup", prices: {
  [tokenAddresses.PAXG.toLowerCase()]: { numerator: "2000", denominator: String(unit) },
  [tokenAddresses.CYGLD.toLowerCase()]: { numerator: "100", denominator: String(unit) },
} } as ValuationSnapshot;
const scenario = (id: string, side: "buy" | "sell", asset: "PAXG" | "USDC", amount: bigint) => ({ id, side, asset,
  family: side === "buy" ? "issue-token" : "redeem-token", requestedStrategy: "core", inputMode: "exact-in",
  amountRaw: String(amount), displayAmount: String(amount), size: "large", nominalUsd: "10000", valuationId: valuation.id }) as MatrixScenario;
const selected = [scenario("paxg-buy-small", "buy", "PAXG", unit), scenario("paxg-buy-large", "buy", "PAXG", 5n * unit),
  scenario("paxg-redeem", "sell", "PAXG", 75n * unit), scenario("usdc-redeem", "sell", "USDC", 80n * unit)];

test("sequential setup nominates a largest-case CYGLD buffer while retaining cumulative PAXG spending", () => {
  const { plan, bootstrap } = runnerFundingPlan(config, valuation, selected, "sequential");
  assert.equal(plan.requiredCygldRaw, String(80n * unit));
  assert.equal(plan.bootstrapPaxgRaw, String(4n * unit));
  assert.equal(plan.plannedPaxgSpendsRaw, String(6n * unit));
  assert.equal(plan.requiredPaxgRaw, String(10n * unit));
  assert.equal(plan.inventoryPolicy, "maximum-redemption-budget");
  assert.equal(bootstrap.inputMode, "exact-in");
  assert.equal(plan.valuationId, valuation.id);
  assert.deepEqual(plan.redemptionBudgets.map(row => row.scenarioId), ["paxg-redeem", "usdc-redeem"]);
  assert.equal(selected[2].amountRaw, String(75n * unit));
});

test("independent reset inventory uses the largest case, without summing mutually restored attempts", () => {
  const { plan } = runnerFundingPlan(config, valuation, selected, "independent");
  assert.equal(plan.requiredCygldRaw, String(80n * unit));
  assert.equal(plan.plannedPaxgSpendsRaw, String(5n * unit));
  assert.equal(plan.requiredPaxgRaw, String(9n * unit));
  assert.equal(plan.inventoryPolicy, "maximum-redemption-budget");
});

test("PAXG collateral includes its actual basket component and applies SUM or per-case MAX", () => {
  const basket = { ...scenario("basket-buy", "buy", "USDC", 900n * unit), asset: "BASKET",
    basketAssets: [tokenAddresses.USDC, tokenAddresses.PAXG], basketAmounts: [String(900n * unit), String(3n * unit)] } as MatrixScenario;
  const sequential = runnerFundingPlan(config, valuation, [...selected, basket], "sequential").plan;
  assert.equal(sequential.plannedPaxgSpendsRaw, String(9n * unit));
  assert.equal(sequential.paxgSpendBudgets.at(-1)?.amountRaw, String(3n * unit));
  assert.equal(sequential.requiredPaxgRaw, String(13n * unit));
  const largerBasket = { ...basket, basketAmounts: [String(900n * unit), String(31n * unit)] };
  const independent = runnerFundingPlan(config, valuation, [...selected, largerBasket], "independent").plan;
  assert.equal(independent.plannedPaxgSpendsRaw, String(31n * unit));
  assert.equal(independent.requiredPaxgRaw, String(35n * unit));
});

test("an ordinary partial bootstrap remains a measured shortfall, not a new target-achieved failure", () => {
  const { plan } = runnerFundingPlan(config, valuation, selected, "sequential");
  observeRunnerCygld(plan, String(7n * unit), String(5n * unit));
  assert.equal(plan.actualCygldRaw, String(7n * unit));
  assert.equal(plan.acquiredCygldRaw, String(5n * unit));
  assert.equal(plan.cygldShortfallRaw, String(73n * unit));
  observeRunnerCygld(plan, String(160n * unit));
  assert.equal(plan.cygldShortfallRaw, "0");
});

test("owned holder transfer uses the larger of manifest collateral and the exact frozen PAXG plan", () => {
  const { plan } = runnerFundingPlan(config, valuation, selected, "sequential");
  const funded = ownedPaxgStartupFunding(String(5n * unit), plan);
  assert.equal(funded.transferAmount, plan.requiredPaxgRaw);
  assert.equal(funded.valuationId, valuation.id);
  assert.equal(ownedPaxgStartupFunding(String(20n * unit), plan).transferAmount, String(20n * unit));
  const wide = String(2n ** 100n);
  assert.equal(ownedPaxgStartupFunding("0", { ...plan, requiredPaxgRaw: wide }).transferAmount, wide);
});

test("initial buffer preserves all24 frozen cases and order without subtracting prospective buy credits", () => {
  const frozen = activeMatrixTemplates().map((row, index) => ({ ...row,
    amountRaw: String(BigInt(index + 1) * unit), valuationId: valuation.id,
    ...(row.asset === "BASKET" ? { basketAssets: [tokenAddresses.USDC, tokenAddresses.PAXG],
      basketAmounts: [String(2n * unit), String(3n * unit)] } : {}),
  })) as MatrixScenario[];
  const original = structuredClone(frozen);
  const { plan } = runnerFundingPlan(config, valuation, frozen, "sequential");
  assert.equal(frozen.length, 24); assert.deepEqual(frozen, original);
  assert.equal(plan.valuationId, valuation.id);
  const redemptions = frozen.filter(row => row.side === "sell");
  assert.deepEqual(plan.redemptionBudgets, redemptions.map(row => ({ scenarioId: row.id, amountRaw: row.amountRaw })));
  const maximum = redemptions.reduce((left, row) => left > BigInt(row.amountRaw) ? left : BigInt(row.amountRaw), 0n);
  assert.equal(plan.requiredCygldRaw, String(maximum));
  const withoutIssues = runnerFundingPlan(config, valuation, frozen.filter(row => row.side === "sell"), "sequential").plan;
  assert.equal(plan.requiredCygldRaw, withoutIssues.requiredCygldRaw);
  const moreIssueFunding = frozen.map(row => row.side === "buy" ? { ...row, amountRaw: String(10n ** 30n) } : row);
  assert.equal(runnerFundingPlan(config, valuation, moreIssueFunding, "sequential").plan.requiredCygldRaw, plan.requiredCygldRaw);
  assert.equal(plan.plannedPaxgSpendsRaw, String(plan.paxgSpendBudgets.reduce((sum, row) => sum + BigInt(row.amountRaw), 0n)));
});

test("available collateral is optional evidence, including a fixed public grant's shortfall", () => {
  const { plan } = runnerFundingPlan(config, valuation, selected, "sequential");
  observeRunnerPaxg(plan, { tokens: [] });
  assert.equal(plan.availablePaxgRaw, undefined);
  observeRunnerPaxg(plan, { tokens: [{ id: "paxg", balance: { status: "success", value: String(5n * unit) } }] } as Parameters<typeof observeRunnerPaxg>[1]);
  assert.equal(plan.paxgShortfallRaw, String(BigInt(plan.requiredPaxgRaw) - 5n * unit));
});
