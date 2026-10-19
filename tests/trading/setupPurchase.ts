import { formatUnits, parseUnits } from "viem";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { ValuationSnapshot } from "./matrix.ts";
import { configuredToken, ScenarioUnavailableError, type Scenario } from "./scenarios.ts";

/** Size a PAXG spending budget using the fixture's existing indicative valuation.
 * The nominal inventory is sizing context, never a requested or guaranteed output. */
export function setupPurchase(config: ProtocolConfiguration, valuation: ValuationSnapshot,
  nominalCygld: string, id: string): Scenario {
  const input = configuredToken(config, "PAXG"), output = configuredToken(config, "CYGLD");
  const inputPrice = input.type === "erc20" ? valuation.prices[input.address.toLowerCase()] : undefined;
  const outputPrice = output.type === "erc20" ? valuation.prices[output.address.toLowerCase()] : undefined;
  if (!inputPrice || !outputPrice) throw new ScenarioUnavailableError("valuation-unavailable");
  const amount = parseUnits(nominalCygld, output.decimals) * BigInt(outputPrice.numerator) * BigInt(inputPrice.denominator)
    / (BigInt(outputPrice.denominator) * BigInt(inputPrice.numerator));
  return { id, family: "issue-token", requestedStrategy: "core", side: "buy", inputMode: "exact-in", asset: "PAXG",
    displayAmount: formatUnits(amount, input.decimals), amountRaw: String(amount), valuationId: valuation.id };
}
