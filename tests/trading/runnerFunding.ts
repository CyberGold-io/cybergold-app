import { formatUnits } from "viem";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { WalletBalancesSnapshot } from "../../app/utils/walletBalanceSnapshot.ts";
import type { MatrixScenario, ValuationSnapshot } from "./matrix.ts";
import { configuredToken } from "./scenarios.ts";
import { setupPurchase } from "./setupPurchase.ts";

export type RunnerFundingPlan = {
  suite: "sequential" | "independent"; valuationId: string;
  inventoryPolicy: "sum-redemption-budgets" | "maximum-redemption-budget";
  requiredCygldRaw: string; requiredPaxgRaw: string;
  bootstrapPaxgRaw: string; rejectionPaxgRaw: string; plannedPaxgSpendsRaw: string;
  redemptionBudgets: { scenarioId: string; amountRaw: string }[];
  paxgSpendBudgets: { scenarioId: string; amountRaw: string }[];
  availablePaxgRaw?: string; paxgShortfallRaw?: string;
  actualCygldRaw?: string; acquiredCygldRaw?: string; cygldShortfallRaw?: string;
};

/** Plan from frozen inputs without assuming future issue proceeds or refunds.
 * The setup is one ordinary exact-input purchase, not an output guarantee. */
export function runnerFundingPlan(config: ProtocolConfiguration, valuation: ValuationSnapshot,
  scenarios: readonly MatrixScenario[], suite: RunnerFundingPlan["suite"]) {
  const redemptionBudgets = scenarios.filter(row => row.side === "sell" && row.inputMode === "exact-in" && !row.sizingError)
    .map(row => ({ scenarioId: row.id, amountRaw: row.amountRaw }));
  const combine = (left: bigint, right: bigint) => suite === "sequential" ? left + right : left > right ? left : right;
  const required = redemptionBudgets.reduce((amount, row) => combine(amount, BigInt(row.amountRaw)), 0n);
  const cygld = configuredToken(config, "CYGLD");
  const rejection = setupPurchase(config, valuation, "0.25", "fixture-wallet-rejection");
  const bootstrap = setupPurchase(config, valuation, formatUnits(required, cygld.decimals), "fixture-cygld-bootstrap");
  const paxgSpendBudgets = scenarios.filter(row => row.asset === "PAXG" && row.side === "buy"
    && row.inputMode === "exact-in" && !row.sizingError).map(row => ({ scenarioId: row.id, amountRaw: row.amountRaw }));
  const plannedPaxg = paxgSpendBudgets.reduce((amount, row) => combine(amount, BigInt(row.amountRaw)), 0n);
  const executionPaxg = BigInt(bootstrap.amountRaw!) + plannedPaxg;
  const rejectionPaxg = BigInt(rejection.amountRaw!);
  const plan: RunnerFundingPlan = { suite, valuationId: valuation.id,
    inventoryPolicy: suite === "sequential" ? "sum-redemption-budgets" : "maximum-redemption-budget",
    requiredCygldRaw: String(required), bootstrapPaxgRaw: bootstrap.amountRaw!, rejectionPaxgRaw: rejection.amountRaw!,
    plannedPaxgSpendsRaw: String(plannedPaxg),
    // Rejection needs collateral but cancels before spending it. Cover its
    // balance requirement without adding an unspent debit to the bankroll.
    requiredPaxgRaw: String(executionPaxg > rejectionPaxg ? executionPaxg : rejectionPaxg),
    redemptionBudgets, paxgSpendBudgets };
  return { plan, bootstrap, rejection };
}

/** Optional existing wallet/receipt evidence. It never rejects a setup or trade. */
export function observeRunnerPaxg(plan: RunnerFundingPlan, snapshot: Pick<WalletBalancesSnapshot, "tokens">) {
  const balance = snapshot.tokens.find(token => token.id === "paxg")?.balance;
  if (balance?.status !== "success") return;
  const available = BigInt(balance.value), required = BigInt(plan.requiredPaxgRaw);
  plan.availablePaxgRaw = String(available);
  plan.paxgShortfallRaw = String(required > available ? required - available : 0n);
}

export function observeRunnerCygld(plan: RunnerFundingPlan, actualRaw: string, acquiredRaw?: string) {
  const required = BigInt(plan.requiredCygldRaw), actual = BigInt(actualRaw);
  plan.actualCygldRaw = String(actual);
  if (acquiredRaw !== undefined) plan.acquiredCygldRaw = String(BigInt(acquiredRaw));
  plan.cygldShortfallRaw = String(required > actual ? required - actual : 0n);
}
