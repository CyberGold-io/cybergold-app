import { getAddress, toHex, decodeEventLog, type Address, type Hex } from "viem";
import { HELPERS_TRADE_EXACT_INPUT_ABI } from "../contracts/generated/helpersTradeExactInput.ts";
import { HELPERS_DIAMOND_ABI } from "../contracts/generated/helpersDiamond.ts";
import { marketSwapReceipt } from "./marketSwap.ts";

export type TradeReceipt = {
  strategy: "core" | "market" | "universal"; operation: "issue" | "redeem" | "swap";
  inputUsed: bigint; amountOut: bigint; inputRefund: bigint; outputRefund: bigint;
  protocolFeeCygld: bigint; helperFeeCygld: bigint; feeRecipient?: Address;
  acquiredInputs?: readonly { currency: Address; amount: bigint }[];
  recipientOutputs?: readonly { kind: number; token: Address; id: bigint; amount: bigint }[];
  retainedInputs?: readonly { branch: bigint; stage: bigint; currency: Address; amount: bigint }[];
  stages?: readonly { branch: bigint; stage: bigint; inputCurrency: Address; outputCurrency: Address; fundedInput: bigint; returnedInput: bigint; consumedInput: bigint; inputGain: bigint; amountOut: bigint }[];
  marketFeeCygld?: bigint; retainedCustodian?: Address;
  recoveryAssets: readonly Address[]; recoveryShareAmounts: readonly bigint[];
};
type Log = { address: Address; data: Hex; topics: readonly Hex[] };

/** Retain every owned Helpers refund in receipt order, including other assets.
 * These are observed event amounts, not complete wallet/value reconciliation.
 */
export function tradeRefundEvidence(logs: readonly Log[], helpers: Address, payer: Address): { asset: Address; amount: string }[] {
  return logs.flatMap(log => {
    if (log.address.toLowerCase() !== helpers.toLowerCase()) return [];
    try {
      const event = decodeEventLog({ abi: HELPERS_DIAMOND_ABI, data: log.data,
        topics: log.topics as [Hex, ...Hex[]] });
      return event.eventName === "DustRefunded" && event.args.payer.toLowerCase() === payer.toLowerCase()
        ? [{ asset: event.args.asset, amount: String(event.args.amount) }] : [];
    } catch { return []; }
  });
}

/** Decode measured receipts only for the captured operation's Helpers and payer. */
export function tradeReceipt(logs: readonly Log[], helpers: Address, payer: Address,
  strategy: "core" | "market" | "universal", inputToken: Address): TradeReceipt | undefined {
  if (strategy === "universal") return universalTradeReceipt(logs, helpers, payer);
  if (strategy === "market") {
    const value = marketSwapReceipt(logs, helpers, payer);
    return value && { strategy, operation: "swap", inputUsed: value.swapInput + (value.side === 1 ? value.feeCygld : 0n), amountOut: value.amountOut,
      inputRefund: value.inputRefund, outputRefund: value.outputRefund,
      protocolFeeCygld: 0n, helperFeeCygld: value.feeCygld, feeRecipient: value.feeRecipient, recoveryAssets: [], recoveryShareAmounts: [] };
  }
  let result: TradeReceipt | undefined, inputRefund = 0n;
  for (const log of logs) {
    if (log.address.toLowerCase() !== helpers.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: HELPERS_DIAMOND_ABI, data: log.data,
        topics: log.topics as [Hex, ...Hex[]] });
      if (event.eventName === "Issued" && event.args.payer.toLowerCase() === payer.toLowerCase()) {
        result = { strategy, operation: "issue", inputUsed: event.args.inputUsed, amountOut: event.args.netCygldOut,
          inputRefund: 0n, outputRefund: 0n, protocolFeeCygld: event.args.protocolFeeCygld,
          helperFeeCygld: event.args.helperFeeCygld, recoveryAssets: [], recoveryShareAmounts: [] };
      } else if (event.eventName === "Redeemed" && event.args.payer.toLowerCase() === payer.toLowerCase()) {
        result = { strategy, operation: "redeem", inputUsed: event.args.grossCygldIn, amountOut: event.args.amountOut,
          inputRefund: 0n, outputRefund: 0n, protocolFeeCygld: event.args.protocolFeeCygld,
          helperFeeCygld: event.args.helperFeeCygld, recoveryAssets: event.args.recoveryAssets,
          recoveryShareAmounts: event.args.recoveryShareAmounts };
      } else if (event.eventName === "DustRefunded" && event.args.payer.toLowerCase() === payer.toLowerCase()
        && event.args.asset.toLowerCase() === inputToken.toLowerCase()) inputRefund += event.args.amount;
    } catch { /* Other logs cannot fabricate this operation's measured receipt. */ }
  }
  return result && { ...result, inputRefund };
}

/** A single aggregate event is authoritative even when underlying Core events coexist. */
export function universalTradeReceipt(logs: readonly Log[], helpers: Address, payer: Address): TradeReceipt | undefined {
  for (const log of logs) {
    if (log.address.toLowerCase() !== helpers.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: HELPERS_TRADE_EXACT_INPUT_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (event.eventName !== "ExactInputExecuted" || event.args.payer.toLowerCase() !== payer.toLowerCase()) continue;
      const result = event.args.result;
      return { strategy: "universal", operation: event.args.intent === 0 || event.args.intent === 2 ? "issue" : "redeem",
        inputUsed: result.acquiredInputs.length === 1 ? result.acquiredInputs[0].amount : 0n,
        amountOut: event.args.intent === 3 ? 0n : result.recipientOutputs[0]?.amount ?? 0n,
        inputRefund: 0n, outputRefund: 0n, acquiredInputs: result.acquiredInputs, recipientOutputs: result.recipientOutputs,
        retainedInputs: result.retainedInputs, stages: result.stages, retainedCustodian: result.retainedCustodian,
        protocolFeeCygld: result.coreProtocolFeeCygld, helperFeeCygld: result.coreHelpersFeeCygld,
        marketFeeCygld: result.marketFeeCygld, feeRecipient: result.feeBeneficiaryAtSettlement,
        recoveryAssets: result.recoveryShares.map(row => getAddress(toHex(row.id, { size: 20 }))),
        recoveryShareAmounts: result.recoveryShares.map(row => row.amount) };
    } catch { /* Only this operation's complete aggregate event can establish settlement. */ }
  }
}
