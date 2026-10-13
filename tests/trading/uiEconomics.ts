import { zeroAddress, type Address } from "viem";
import { applySlippageCeil, applySlippageFloor } from "../../app/utils/swapPolicy.ts";
import type { WalletBalancesSnapshot } from "../../app/utils/walletBalanceSnapshot.ts";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import { requireInvariant, uint } from "./regression.ts";
import { ScenarioUnavailableError } from "./scenarios.ts";

export type UiAmount = { type: "native" | "erc20"; token: string; decimals: number; amount: string; roundingUnit: string;
  rounding: "exact" | "rounded" | "truncated" };
export type UiQuoteSnapshot = { inputMode: "exact-in" | "exact-out"; toleranceBps: number;
  input: UiAmount[]; output: UiAmount[]; executionBound: { side: "input" | "output"; amounts: UiAmount[] } };
export type UiWalletSnapshot = { input: string[]; output: string[]; native?: string };
export type UiWalletEvidence = { inputBefore: string[]; inputAfter: string[]; outputBefore: string[]; outputAfter: string[];
  inputDelta: string[]; outputDelta: string[]; nativeGasPaid: string; gasTransactionHashes: string[] };
export type ActualUiAmount = { type: UiAmount["type"]; token: string; amount: bigint };

const subscripts = "₀₁₂₃₄₅₆₇₈₉";
/** The tests visit /en; whitespace is grouping and compact subscript zeros are displayed precision. */
export function displayedAmount(text: string, decimals: number, quoted: boolean): Pick<UiAmount, "amount" | "roundingUnit" | "rounding"> {
  let canonical = text.replace(/\s/g, "");
  const compact = canonical.match(/^0\.0([₀₁₂₃₄₅₆₇₈₉]+)(\d+)$/);
  if (compact) {
    const zeros = Number([...compact[1]].map(value => subscripts.indexOf(value)).join(""));
    requireInvariant(zeros <= 255, "ui-displayed-amount-invalid");
    canonical = `0.${"0".repeat(zeros)}${compact[2]}`;
  }
  requireInvariant(/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(canonical), "ui-displayed-amount-invalid");
  const [integer, fraction = ""] = canonical.split(".");
  requireInvariant(fraction.replace(/0+$/, "").length <= decimals, "ui-displayed-precision-invalid");
  const amount = BigInt(integer) * 10n ** BigInt(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
  let digits = decimals;
  if (quoted) {
    // formatMeaningfulDecimalString keeps 3 fraction digits for >=1, or
    // 3 significant digits below1 (4 in the compact subscript presentation).
    const first = fraction.search(/[1-9]/);
    digits = compact ? Number([...compact[1]].map(value => subscripts.indexOf(value)).join("")) + compact[2].length
      : integer !== "0" ? 3 : Math.max(3, first + 3);
  }
  const roundingUnit = quoted && digits < decimals ? 10n ** BigInt(decimals - digits) : 1n;
  return { amount: String(amount), roundingUnit: String(roundingUnit), rounding: !quoted ? "exact" : compact ? "truncated" : "rounded" };
}

export function selectedTolerance(text: string): number {
  const canonical = text.trim().replace(",", ".");
  const percent = Number(canonical);
  requireInvariant(canonical !== "" && Number.isFinite(percent) && percent >= 0 && percent <= 1, "ui-tolerance-invalid");
  const bps = Math.round(percent * 100);
  return bps;
}

const identity = (value: Pick<UiAmount, "type" | "token">) => `${value.type}:${value.token.toLowerCase()}`;
const allowance = (value: UiAmount) => {
  const unit = uint(value.roundingUnit, "display-rounding-unit");
  return value.rounding === "exact" || unit <= 1n ? 0n : value.rounding === "truncated" ? unit - 1n : unit / 2n;
};
export function uiAmountLimits(snapshot: UiQuoteSnapshot) {
  return {
    maximum: snapshot.input.map(value => {
      const amount = uint(value.amount, "displayed-input");
      return snapshot.inputMode === "exact-in" ? amount : applySlippageCeil(amount + allowance(value), snapshot.toleranceBps);
    }),
    minimum: snapshot.output.map(value => {
      const amount = uint(value.amount, "displayed-output");
      const rounding = value.rounding === "rounded" ? allowance(value) : 0n;
      return snapshot.inputMode === "exact-out" ? amount : applySlippageFloor(amount > rounding ? amount - rounding : 0n, snapshot.toleranceBps);
    }),
  };
}

function orderedAmounts(expected: UiAmount[], actual: ActualUiAmount[], code: string): bigint[] {
  const entries = new Map(actual.map(value => [identity(value), value.amount]));
  requireInvariant(entries.size === actual.length && entries.size === expected.length, code);
  return expected.map(value => { const amount = entries.get(identity(value)); requireInvariant(amount !== undefined, code); return amount; });
}

export function measuredUiEconomics(snapshot: UiQuoteSnapshot, actual: { input: ActualUiAmount[]; output: ActualUiAmount[];
  maximum: ActualUiAmount[]; minimum: ActualUiAmount[] }) {
  const paid = orderedAmounts(snapshot.input, actual.input, "ui-input-asset-mismatch");
  const received = orderedAmounts(snapshot.output, actual.output, "ui-output-asset-mismatch");
  const maximum = orderedAmounts(snapshot.input, actual.maximum, "ui-input-bound-asset-mismatch");
  const minimum = orderedAmounts(snapshot.output, actual.minimum, "ui-output-bound-asset-mismatch");
  return { paid, received, maximum, minimum };
}

export function assertUiEconomics(snapshot: UiQuoteSnapshot, actual: Parameters<typeof measuredUiEconomics>[1]) {
  const { paid, received, maximum, minimum } = measuredUiEconomics(snapshot, actual);
  const limits = uiAmountLimits(snapshot);
  maximum.forEach((amount, index) => requireInvariant(amount <= limits.maximum[index], "ui-calldata-input-tolerance-exceeded"));
  minimum.forEach((amount, index) => requireInvariant(amount >= limits.minimum[index], "ui-calldata-output-tolerance-missed"));
  paid.forEach((amount, index) => requireInvariant(amount <= limits.maximum[index], "ui-paid-input-tolerance-exceeded"));
  received.forEach((amount, index) => requireInvariant(amount >= limits.minimum[index], "ui-received-output-tolerance-missed"));
  const protectedAmounts = snapshot.executionBound.side === "input"
    ? orderedAmounts(snapshot.executionBound.amounts, actual.maximum, "ui-execution-bound-asset-mismatch")
    : orderedAmounts(snapshot.executionBound.amounts, actual.minimum, "ui-execution-bound-asset-mismatch");
  protectedAmounts.forEach((amount, index) => requireInvariant(snapshot.executionBound.side === "input"
    ? amount <= BigInt(snapshot.executionBound.amounts[index].amount) : amount >= BigInt(snapshot.executionBound.amounts[index].amount),
  "ui-displayed-execution-bound-not-protected"));
  return { paid, received };
}

export function walletAmounts(value: WalletBalancesSnapshot, config: ProtocolConfiguration, quote: UiQuoteSnapshot): UiWalletSnapshot {
  const read = (amount: UiAmount) => {
    const token = amount.type === "native" ? config.tokens.find(token => token.type === "native")
      : config.tokens.find(token => token.type === "erc20" && token.address.toLowerCase() === amount.token.toLowerCase());
    const balance = amount.type === "native" ? value.native : value.tokens.find(row => row.id === token?.id)?.balance;
    if (balance?.status !== "success") throw new ScenarioUnavailableError("wallet-balance-unavailable");
    return String(uint(balance.value, "wallet-balance"));
  };
  return { input: quote.input.map(read), output: quote.output.map(read),
    ...(value.native.status === "success" ? { native: String(uint(value.native.value, "native-balance")) } : {}) };
}

export function walletEvidence(quote: UiQuoteSnapshot, before: UiWalletSnapshot, after: UiWalletSnapshot,
  gasPaid: bigint, gasTransactionHashes: string[]): UiWalletEvidence {
  const inputDelta = quote.input.map((value, index) => BigInt(before.input[index]) - BigInt(after.input[index]) - (value.type === "native" ? gasPaid : 0n));
  const outputDelta = quote.output.map((value, index) => BigInt(after.output[index]) - BigInt(before.output[index]) + (value.type === "native" ? gasPaid : 0n));
  return { inputBefore: before.input, inputAfter: after.input, outputBefore: before.output, outputAfter: after.output,
    inputDelta: inputDelta.map(String), outputDelta: outputDelta.map(String), nativeGasPaid: String(gasPaid), gasTransactionHashes };
}

export function assertWalletEconomics(evidence: UiWalletEvidence, paid: readonly bigint[], received: readonly bigint[]) {
  requireInvariant(evidence.inputDelta.length === paid.length && evidence.outputDelta.length === received.length, "wallet-receipt-vector-mismatch");
  evidence.inputDelta.forEach((amount, index) => requireInvariant(BigInt(amount) === paid[index], "wallet-paid-receipt-mismatch"));
  evidence.outputDelta.forEach((amount, index) => requireInvariant(BigInt(amount) === received[index], "wallet-received-receipt-mismatch"));
}

export function actualAmount(token: string, amount: bigint, native = false): ActualUiAmount {
  return { type: native ? "native" : "erc20", token: native ? zeroAddress : token as Address, amount };
}
