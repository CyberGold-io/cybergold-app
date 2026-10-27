import { zeroAddress, type Address } from "viem";
import type { SubmitBasketFlowParams } from "../hooks/flows/shared/types";
import type { useUniversalExactInputExecution } from "../hooks/flows/shared/useUniversalExactInputExecution";
import type { useTokenPurchaseExecution } from "../hooks/flows/shared/useTokenPurchaseExecution";
import type { useMarketSwapExecution } from "../hooks/flows/shared/useMarketSwapExecution";
import { captureTradeQuote, type TradeQuoteResult } from "./tradeQuote.ts";
import { quoteIntentResult } from "./quoteIntent.ts";
import { fetchUniversalExactInputQuote, preserveExactInputMinimum } from "./universalExactInput.ts";
import { marketQuoteResult } from "./marketQuote.ts";
import { isEconomicQuote } from "./economicQuotes.ts";

type Executors = {
  universal?: ReturnType<typeof useUniversalExactInputExecution>["submit"];
  tokenPurchase: ReturnType<typeof useTokenPurchaseExecution>["submitTokenPurchase"];
  market: ReturnType<typeof useMarketSwapExecution>["submit"];
};

/** Only the captured winning family prepares permits or submits a transaction. */
export async function submitTradeQuote(selected: TradeQuoteResult, params: SubmitBasketFlowParams, executors: Executors, fetchImpl: typeof fetch = fetch) {
  const accepted = captureTradeQuote(selected);
  if (accepted.value.strategy === "universal") {
    if (!executors.universal) throw new Error("Universal exact-input executor is unavailable");
    return executors.universal(accepted.value, params, isEconomicQuote(accepted.value)
      ? { inputs: accepted.value.inputs, minimumOutput: accepted.outputMinimum.toString() } : undefined);
  }
  if (accepted.value.mode === "exact-in") {
    const request = accepted.value.providerRequest;
    const fresh = await fetchUniversalExactInputQuote({ intent: accepted.value.side === "buy" ? 0 : 1,
      inputs: [{ currency: accepted.value.tokenIn, amount: request.amount }], outputCurrency: accepted.value.tokenOut,
      recipient: params.recipient, deadline: request.deadline, slippageBps: request.slippageBps }, params.feeEstimateSignal, fetchImpl);
    if (!executors.universal) throw new Error("Universal exact-input executor is unavailable");
    return executors.universal(preserveExactInputMinimum(fresh, accepted.outputMinimum), params);
  }
  if (accepted.value.strategy === "market") {
    return executors.market({ ...marketQuoteResult(accepted.value.providerQuote),
      value: { ...accepted.value.providerQuote, mode: "exact-out" }, deployment: accepted.deployment },
      params.owner, params.walletConfirmationTracker, params.feeEstimateSignal, params.diagnosticStage);
  }
  const request = accepted.value.providerRequest;
  const result = quoteIntentResult(accepted.value.providerQuote, request.slippageBps);
  if (accepted.value.side === "buy") {
    if (!result.orderedCoreAssets) throw new Error("Core asset binding is unavailable");
    const nativeInput = request.native && params.inputFundingMode !== "erc20";
    return executors.tokenPurchase({ ...params, deployment: accepted.deployment,
      inputToken: (request.native && !nativeInput ? request.quoteToken : request.token) as Address,
      maximumInputAmount: accepted.inputMaximum, netCygldOut: result.executionAmount,
      expectedOrderedCoreAssets: result.orderedCoreAssets, quotes: result.quotes, nativeInput });
  }
  const fresh = await fetchUniversalExactInputQuote({ intent: 1,
    inputs: [{ currency: accepted.value.tokenIn, amount: String(result.executionAmount) }],
    outputCurrency: request.native ? zeroAddress : request.token, recipient: params.recipient,
    deadline: request.deadline, slippageBps: request.slippageBps }, params.feeEstimateSignal, fetchImpl);
  if (!executors.universal) throw new Error("Universal exact-input executor is unavailable");
  return executors.universal(preserveExactInputMinimum(fresh, accepted.outputMinimum), params);
}
