import { formatUnits } from "viem";
import type { ProtocolModel } from "./quoteModelStore.ts";
import { formatMeaningfulDecimalString } from "./formatting.ts";
import { DEFAULT_SLIPPAGE_BPS, SLIPPAGE_POLICY } from "./swapPolicy.ts";

const PPM = 1_000_000n;
const FP18 = 10n ** 18n;
type IssuanceState = Pick<ProtocolModel["state"],
  "supply" | "maxSupply" | "effectiveCap" | "issueFee" | "helperFee"> &
  Partial<Pick<ProtocolModel["state"], "assets" | "weights" | "conversions">>;
export type IssuanceModel = { context: ProtocolModel["context"]; state: IssuanceState };
const grossForNet = (net: bigint, fee: bigint) =>
  net > 0n ? net + (net - 1n) * fee / (PPM - fee) : 0n;
const ceil = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator;

/** Purchase capacity after the fees that also consume the issuance cap. */
export function cygldPurchaseCapacity(protocol?: IssuanceModel) {
  if (!protocol) return undefined;
  const state = protocol.state;
  const configuredCap = BigInt(state.maxSupply), effectiveCap = BigInt(state.effectiveCap);
  const cap = configuredCap < effectiveCap ? configuredCap : effectiveCap;
  const supply = BigInt(state.supply);
  const remaining = cap > supply ? cap - supply : 0n;
  const coreNet = remaining - remaining * BigInt(state.issueFee) / PPM;
  const available = coreNet - coreNet * BigInt(state.helperFee) / PPM;
  return { cap, supply, grossRemaining: remaining, available };
}

/** Gross new supply required by exact recipient output, including both fees. */
export function cygldGrossForNet(protocol: IssuanceModel | undefined, netCygldOut: bigint) {
  if (!protocol) return undefined;
  const coreNet = grossForNet(netCygldOut, BigInt(protocol.state.helperFee));
  return grossForNet(coreNet, BigInt(protocol.state.issueFee));
}

/** Indicative basket costs; execution previews independently enforce capacity. */
export function cygldBasketInputsForNet(protocol: IssuanceModel | undefined, netCygldOut: bigint) {
  if (!protocol || !protocol.state.weights || !protocol.state.conversions) return undefined;
  const { weights, conversions } = protocol.state;
  const gross = cygldGrossForNet(protocol, netCygldOut)!;
  return weights.map((value, index) => {
    const weight = BigInt(value);
    if (weight === 0n) return 0n;
    const shareUnits = ceil(gross * weight, PPM);
    return ceil(shareUnits * FP18, BigInt(conversions[index]));
  });
}

/**
 * Uncapped recipient issuance supported by budgets in the producer's asset order.
 * Keep Core's two floors: token conversion first, then the asset weight.
 */
export function cygldBasketPurchaseAmount(protocol: IssuanceModel | undefined,
  orderedBudgets: readonly bigint[]) {
  if (!protocol || !protocol.state.weights || !protocol.state.conversions) return undefined;
  const { weights, conversions } = protocol.state;
  let gross: bigint | undefined;
  weights.forEach((value, index) => {
    const weight = BigInt(value);
    if (weight === 0n) return;
    const shareUnits = orderedBudgets[index] * BigInt(conversions[index]) / FP18;
    const supported = shareUnits * PPM / weight;
    if (gross === undefined || supported < gross) gross = supported;
  });
  if (gross === undefined) return undefined;
  const coreNet = gross - gross * BigInt(protocol.state.issueFee) / PPM;
  const net = coreNet - coreNet * BigInt(protocol.state.helperFee) / PPM;
  // Fee plateaus can make several gross budgets produce the same recipient net.
  // Compare the canonical gross needed for that receipt with available capacity.
  return { gross: cygldGrossForNet(protocol, net)!, coreNet, net };
}

/** Largest recipient output whose protected basket inputs fit every wallet balance. */
export function cygldBasketPurchaseMax(protocol: IssuanceModel | undefined,
  orderedWalletBudgets: readonly bigint[], slippageBps = DEFAULT_SLIPPAGE_BPS) {
  const denominator = SLIPPAGE_POLICY.BPS_DENOMINATOR + BigInt(slippageBps);
  const budgets = orderedWalletBudgets.map(amount =>
    amount * SLIPPAGE_POLICY.BPS_DENOMINATOR / denominator);
  const affordable = cygldBasketPurchaseAmount(protocol, budgets)?.net;
  if (affordable === undefined) return undefined;
  const capacity = cygldPurchaseCapacity(protocol)!.available;
  return affordable < capacity ? affordable : capacity;
}

/** Use the same display rounding as quoted amounts; execution keeps exact wei. */
export function formatCygldCapacity(amount: bigint, decimals: number, locale: string) {
  return formatMeaningfulDecimalString(formatUnits(amount, decimals), locale);
}
