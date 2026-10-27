import { parseUnits } from "viem";
import { activeMatrixTemplates } from "./matrix.ts";

/** These sequential buys precede any USDC sale credits in the active matrix. */
export function ownedUsdcStartupFunding(manifestAmount: string, decimals: number) {
  const debits = activeMatrixTemplates().filter(scenario => scenario.asset === "USDC"
    && scenario.side === "buy" && scenario.inputMode === "exact-in").map(scenario => ({
    scenarioId: scenario.id, amount: String(parseUnits(scenario.nominalUsd!, decimals)),
  }));
  // The existing matrix explicitly sizes USDC on its one-USDC-is-one-USD
  // coordinate. No pool quotation or assumed future proceeds fund these buys.
  const planned = debits.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  const supplied = BigInt(manifestAmount);
  return { manifestAmount: String(supplied), plannedAmount: String(planned),
    transferAmount: String(supplied > planned ? supplied : planned),
    decimals, reason: "cumulative-active-usdc-issue-budgets", debits };
}
