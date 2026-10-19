import { decodeEventLog, type Address, type Hex } from "viem";
import { HELPERS_DIAMOND_ABI } from "../contracts/generated/helpersDiamond.ts";
import { marketSwapReceipt } from "./marketSwap.ts";

export type TradeReceipt = {
  strategy: "core" | "market"; operation: "issue" | "redeem" | "swap";
  inputUsed: bigint; amountOut: bigint; inputRefund: bigint; outputRefund: bigint;
  protocolFeeCygld: bigint; helperFeeCygld: bigint; feeRecipient?: Address;
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
  strategy: "core" | "market", inputToken: Address): TradeReceipt | undefined {
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
