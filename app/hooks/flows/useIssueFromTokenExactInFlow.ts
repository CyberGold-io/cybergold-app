"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Address } from "viem";
import type { BasketComponent, TokenIssueQuoteStatus, SwapToQuote } from "@/app/types";
import { sameAddressOrder } from "@/app/utils/addressOrder";
import { useQuoteIntent } from "./quotes/useQuoteIntent";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams } from "./shared/types";
import { useTokenPurchaseExecution } from "./shared/useTokenPurchaseExecution";
import { computeSwapBudgetsExactIn } from "@/app/utils/swapBudgets";
import { DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";

type IssueFromTokenExecution = {
  inputToken?: Address;
  maxInputAmount?: bigint;
  grossCygldOut?: bigint;
  netCygldOut?: bigint;
  quotes?: readonly SwapToQuote[];
  orderedCoreAssets?: readonly Address[];
};

type UseIssueFromTokenExactInFlowParams = {
  enabled: boolean;
  inputToken?: Address;
  quoteInputToken?: Address;
  exactInputAmount: bigint;
  isNativeInputToken: boolean;
  basketComponents: readonly BasketComponent[];
} & FlowNetworkFeeEstimateHandlers;

export function useIssueFromTokenExactInFlow({
  enabled,
  inputToken,
  quoteInputToken,
  exactInputAmount,
  isNativeInputToken,
  basketComponents,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  onNetworkFeeEstimate,
  onNetworkFeeEstimateLoadingChange,
}: UseIssueFromTokenExactInFlowParams) {
  const t = useTranslations("Home");
  const hasInput = enabled && !!inputToken && !!quoteInputToken && exactInputAmount > 0n && basketComponents.length > 0;
  const budgetPlan = useMemo(() => hasInput && quoteInputToken ? computeSwapBudgetsExactIn({
    inputToken: quoteInputToken, inputAmount: exactInputAmount, components: basketComponents,
  }) : undefined, [hasInput, quoteInputToken, exactInputAmount, basketComponents]);
  const budgets = budgetPlan?.budgets ?? [];
  const intent = useQuoteIntent({ mode: "issue-exact-in", token: inputToken ?? "", quoteToken: quoteInputToken ?? "",
    native: isNativeInputToken, amount: String(exactInputAmount), slippageBps,
    orderedAssets: basketComponents.map(component => component.token.address),
    targets: budgets.map(budget => ({ inputAsset: quoteInputToken ?? "", outputAsset: budget.outputAsset, amount: String(budget.amountIn) })),
  }, hasInput && budgetPlan !== undefined);
  const result = intent.data;
  const basketMatches = sameAddressOrder(result?.orderedCoreAssets, basketComponents.map(component => component.token.address));
  const execution = useMemo<IssueFromTokenExecution | undefined>(() => result && basketMatches && result.executionAmount > 0n && result.maximumInputAmount > 0n ? {
    inputToken, maxInputAmount: result.maximumInputAmount, netCygldOut: result.executionAmount,
    grossCygldOut: result.executionAmount + result.fees.protocolFeeCygld + result.fees.helperFeeCygld,
    quotes: result.quotes, orderedCoreAssets: result.orderedCoreAssets,
  } : undefined, [result, basketMatches, inputToken]);
  const grossCygldOut = execution?.grossCygldOut;
  const fees = result?.fees;
  const executionNetCygldOutTarget = execution?.netCygldOut ?? 0n;
  const quoteStatus: TokenIssueQuoteStatus = hasInput && !budgetPlan ? "failed" : intent.status === "success" && !execution ? "failed" : intent.status;
  const quoteError = quoteStatus === "failed" ? intent.error ?? t("noQuoteAvailableMessage") : undefined;
  const progressCounts = intent.progress;
  const initialPreviewMatchesBasket = basketMatches;
  const executionBasketPreviewMatchesComponents = basketMatches;
  const finalPreviewMatchesBasket = basketMatches;

  const { submitTokenPurchase } = useTokenPurchaseExecution({
    onNetworkFeeEstimate,
    onNetworkFeeEstimateLoadingChange,
  });

  const quotesForSubmit = execution?.quotes;
  const displayNetCygldOut = quoteStatus === "failed" ? undefined : result?.requestedNetCygldOut ?? execution?.netCygldOut ?? intent.estimate;
  
  const canSubmit =
    enabled &&
    !!execution?.inputToken &&
    (execution?.maxInputAmount ?? 0n) > 0n &&
    (execution?.grossCygldOut ?? 0n) > 0n &&
    (execution?.netCygldOut ?? 0n) > 0n &&
    Array.isArray(execution?.orderedCoreAssets) &&
    initialPreviewMatchesBasket &&
    executionBasketPreviewMatchesComponents &&
    finalPreviewMatchesBasket &&
    Array.isArray(quotesForSubmit);

  const submit = useCallback(
    async ({
      owner,
      recipient,
      walletConfirmationTracker,
      inputFundingMode,
      feeEstimateSignal,
      walletBatch,
    }: SubmitBasketFlowParams) => {
      const executionInputToken = execution?.inputToken;
      const maxInputAmount = execution?.maxInputAmount ?? exactInputAmount;
      const grossCygldOut = execution?.grossCygldOut ?? 0n;
      const netCygldOut = execution?.netCygldOut ?? 0n;
      const tokenIssueQuotes = execution?.quotes ?? [];
      if (
        !enabled ||
        !executionInputToken ||
        maxInputAmount <= 0n ||
        grossCygldOut <= 0n ||
        netCygldOut <= 0n
      ) {
        throw new Error("IssueFromTokenExactIn is not ready");
      }
      if (
        !execution?.orderedCoreAssets
      ) {
        throw new Error("IssueFromTokenExactIn Core asset binding is unavailable");
      }

      const shouldUseNativeInputFunding =
        isNativeInputToken && inputFundingMode !== "erc20";

      return submitTokenPurchase({ deployment: result?.deployment, owner, recipient, walletConfirmationTracker, walletBatch, feeEstimateSignal,
        inputToken: executionInputToken, maximumInputAmount: maxInputAmount, netCygldOut: netCygldOut,
        expectedOrderedCoreAssets: execution.orderedCoreAssets, quotes: tokenIssueQuotes,
        nativeInput: shouldUseNativeInputFunding,
      });
    },
    [
      enabled,
      execution?.grossCygldOut,
      execution?.inputToken,
      execution?.maxInputAmount,
      execution?.netCygldOut,
      execution?.orderedCoreAssets,
      execution?.quotes,
      exactInputAmount,
      isNativeInputToken,
      submitTokenPurchase,
      result?.deployment,
    ]
  );

  return {
    adapter: result?.quotes[0]?.adapter,
    execution,
    requiresSwapAdapter: budgets.length > 0 || (result?.quotes.length ?? 0) > 0,
    grossCygldOut,
    executionNetCygldOutTarget,
    minimumOutputAmount: execution?.netCygldOut,
    maximumInputAmount: execution?.maxInputAmount,
    displayNetCygldOut,
    quotedNetCygldOut: result?.displayAmount,
    quotedRequestedNetCygldOut: result?.requestedNetCygldOut ?? result?.displayAmount,
    requestedGrossCygldOut: result?.requestedGrossCygldOut,
    remainingGrossCapacity: result?.remainingGrossCapacity,
    remainingNetCapacity: result?.remainingNetCapacity,
    fees,
    quoteStatus,
    quoteError,
    quoteErrorCode: intent.errorCode,
    progressCounts,
    canSubmit,
    submit,
  };
}
