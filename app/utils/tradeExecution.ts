import type { Address } from "viem";
import type { SubmitBasketFlowParams } from "../hooks/flows/shared/types";
import type { useTokenPurchaseExecution } from "../hooks/flows/shared/useTokenPurchaseExecution";
import type { useRedemptionExecution } from "../hooks/flows/shared/useRedemptionExecution";
import type { useMarketSwapExecution } from "../hooks/flows/shared/useMarketSwapExecution";
import { captureTradeQuote, type TradeQuoteResult } from "./tradeQuote.ts";
import { quoteIntentResult } from "./quoteIntent.ts";
import { marketQuoteResult } from "./marketQuote.ts";

type Executors = {
  tokenPurchase: ReturnType<typeof useTokenPurchaseExecution>["submitTokenPurchase"];
  redemption: ReturnType<typeof useRedemptionExecution>["submitRedemption"];
  market: ReturnType<typeof useMarketSwapExecution>["submit"];
};

/** Only the captured winning family prepares permits or submits a transaction. */
export async function submitTradeQuote(selected: TradeQuoteResult, params: SubmitBasketFlowParams, executors: Executors) {
  const accepted = captureTradeQuote(selected);
  if (accepted.value.strategy === "market") {
    return executors.market({ ...marketQuoteResult(accepted.value.providerQuote), deployment: accepted.deployment },
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
  if (!result.expectedCoreOutputs) throw new Error("Core output binding is unavailable");
  const redemption = { grossCygldIn: result.executionAmount, recipient: params.recipient,
    minimumAmountOut: accepted.outputMinimum, expectedCoreOutputs: result.expectedCoreOutputs };
  return executors.redemption({ ...params, deployment: accepted.deployment, grossCygldIn: result.executionAmount,
    operation: request.native ? "redeemToNativeExactIn" : "redeemToTokenExactIn",
    request: request.native ? redemption : { ...redemption, outputToken: request.token as Address },
    legs: result.redemptionQuotes.map(row => ({ adapter: row.adapter, minimumAmountOut: row.minimumAmountOut, data: row.data })) });
}
