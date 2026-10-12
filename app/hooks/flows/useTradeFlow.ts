"use client";

import { useCallback } from "react";
import { getAddress, toHex } from "viem";
import { CORE_TOKEN_KIND } from "@/app/types";
import { tradeAdapter, type TradeQuoteRequest, type TradeQuoteResult } from "@/app/utils/tradeQuote";
import { submitTradeQuote } from "@/app/utils/tradeExecution";
import { quoteIntentResult } from "@/app/utils/quoteIntent";
import { useTradeQuote } from "./quotes/useTradeQuote";
import { useTokenPurchaseExecution } from "./shared/useTokenPurchaseExecution";
import { useRedemptionExecution } from "./shared/useRedemptionExecution";
import { useMarketSwapExecution } from "./shared/useMarketSwapExecution";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams } from "./shared/types";

export function useTradeFlow({ input, enabled, frozen, onNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange }:
  { input: Omit<TradeQuoteRequest, "deadline" | "retainedPlan">; enabled: boolean; frozen?: TradeQuoteResult } & FlowNetworkFeeEstimateHandlers) {
  const active = enabled && BigInt(input.amount) > 0n;
  const quote = useTradeQuote(input, active), selected = frozen ?? quote.data;
  const { submitTokenPurchase } = useTokenPurchaseExecution({ onNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange });
  const { submitRedemption } = useRedemptionExecution({ onNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange });
  const market = useMarketSwapExecution();
  const core = selected?.value.strategy === "core" ? quoteIntentResult(selected.value.providerQuote, input.slippageBps) : undefined;
  const recovery = core?.projectedCoreOutputs?.filter(row => row.kind === CORE_TOKEN_KIND.ERC1155 && row.amount > 0n);
  const submit = useCallback(async (params: SubmitBasketFlowParams) => {
    if (!selected) throw new Error("Trading quote is not ready");
    return submitTradeQuote(selected, params, { market: market.submit, tokenPurchase: submitTokenPurchase, redemption: submitRedemption });
  }, [selected, market.submit, submitTokenPurchase, submitRedemption]);
  const fees = selected?.value.strategy === "market"
    ? { protocolFeeCygld: 0n, helperFeeCygld: BigInt(selected.value.providerQuote.fee.amount) } : core?.fees;
  const expected = selected ? input.mode === "exact-in" ? selected.quotedOutput : selected.quotedInput : quote.estimate;
  return {
    selected, strategy: selected?.value.strategy, optimizing: !frozen && quote.optimizing,
    adapter: selected ? tradeAdapter(selected.value) : undefined,
    requiresSwapAdapter: selected?.value.strategy === "market" || (core?.quotes.length ?? 0) + (core?.redemptionQuotes.length ?? 0) > 0,
    execution: selected, canSubmit: active && Boolean(selected), submit,
    quoteStatus: frozen ? "success" as const : quote.status, quoteError: frozen ? undefined : quote.error, quoteErrorCode: frozen ? undefined : quote.errorCode,
    quoteFailure: frozen ? undefined : quote.failure,
    progressCounts: quote.progress, fees, maximumInputAmount: selected?.inputMaximum, minimumOutputAmount: selected?.outputMinimum,
    displayExpectedInputAmount: input.mode === "exact-out" ? expected : undefined,
    displayMaxInputAmount: selected?.inputMaximum,
    displayNetCygldOut: input.side === "buy" && input.mode === "exact-in" ? expected : selected?.quotedOutput,
    displayNetAmountOut: input.side === "sell" && input.mode === "exact-in" ? expected : selected?.quotedOutput,
    grossCygldInToDisplay: input.side === "sell" && input.mode === "exact-out" ? expected : undefined,
    grossCygldOut: core ? core.executionAmount + core.fees.protocolFeeCygld + core.fees.helperFeeCygld : undefined,
    netCygldOutTarget: input.side === "buy" && input.mode === "exact-out" ? BigInt(input.amount) : undefined,
    requestedGrossCygldOut: core?.requestedGrossCygldOut,
    remainingGrossCapacity: undefined, remainingNetCapacity: undefined,
    projectedCoreOutputs: core?.projectedCoreOutputs,
    recoverySharesOut: recovery?.map(row => row.amount),
    orderedRecoveryAssets: recovery?.map(row => getAddress(toHex(row.id, { size: 20 }))),
    isAmountTooSmall: false,
  };
}
