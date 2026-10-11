import { decodeEventLog, zeroAddress, type Address, type Hex } from "viem";
import { HELPERS_MARKET_ABI } from "../contracts/generated/helpersMarket.ts";
import type { CygldPermit } from "../hooks/flows/shared/types";
import type { MarketQuoteResult } from "./marketQuote.ts";

export type MarketFundingAuthorization = {
  mode: 0 | 1 | 2; nativePermit: CygldPermit;
  permit2: { permit: { permitted: { token: Address; amount: bigint }; nonce: bigint; deadline: bigint }; signature: Hex };
};

export function marketFundingAuthorization(value: {
  inputs: { token: Address; maximumInputAmount: bigint; authorization: 0 | 1 | 2; permit: CygldPermit }[];
  permit2: { permit: { permitted: { token: Address; amount: bigint }[]; nonce: bigint; deadline: bigint }; signature: Hex };
}): MarketFundingAuthorization {
  const input = value.inputs[0];
  return { mode: input.authorization, nativePermit: input.permit,
    permit2: { permit: { ...value.permit2.permit,
      permitted: value.permit2.permit.permitted[0] ?? { token: zeroAddress, amount: 0n } }, signature: value.permit2.signature } };
}

export function marketSwapOperation(value: MarketQuoteResult): "swapExactInput" | "swapExactOutput" {
  return value.value.mode === "exact-in" ? "swapExactInput" : "swapExactOutput";
}

export type MarketSwapReceipt = {
  payer: Address; recipient: Address; counterToken: Address; side: number; exactInput: boolean;
  swapInput: bigint; amountOut: bigint; inputRefund: bigint; outputRefund: bigint;
  feeCygld: bigint; feeRecipient: Address;
};

/** Only the Helpers market event describes this operation's fee and refunds. */
export function marketSwapReceipt(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[],
  helpers: Address, payer?: Address): MarketSwapReceipt | undefined {
  for (const log of logs) {
    if (log.address.toLowerCase() !== helpers.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: HELPERS_MARKET_ABI, data: log.data,
        topics: log.topics as [Hex, ...Hex[]] });
      if (event.eventName !== "MarketSwapExecuted") continue;
      const result = event.args as MarketSwapReceipt;
      if (!payer || result.payer.toLowerCase() === payer.toLowerCase()) return result;
    } catch { /* Other ordinary Helpers/token events do not describe a market swap. */ }
  }
  return undefined;
}
