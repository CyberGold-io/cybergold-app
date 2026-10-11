"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Address } from "viem";
import type { BasketComponent, TokenIssueQuoteStatus } from "@/app/types";
import { sameAddressOrder } from "@/app/utils/addressOrder";
import { useQuoteIntent } from "./quotes/useQuoteIntent";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams } from "./shared/types";
import { useTokenPurchaseExecution } from "./shared/useTokenPurchaseExecution";
import { DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";

type IssueFromTokenExactOutExecution = {
  inputToken?: Address;
  maxInputAmount?: bigint;
  grossCygldOut?: bigint;
  netCygldOut?: bigint;
  orderedCoreAssets?: readonly Address[];
};

type UseIssueFromTokenExactOutFlowParams = {
  enabled: boolean;
  inputToken?: Address;
  quoteInputToken?: Address;
  netCygldOut: bigint;
  isNativeInputToken: boolean;
  basketComponents: readonly BasketComponent[];
} & FlowNetworkFeeEstimateHandlers;

export function useIssueFromTokenExactOutFlow({
  enabled,
  inputToken,
  quoteInputToken,
  netCygldOut,
  isNativeInputToken,
  basketComponents,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  onNetworkFeeEstimate,
  onNetworkFeeEstimateLoadingChange,
}: UseIssueFromTokenExactOutFlowParams) {
  const t = useTranslations("Home");
  const hasInput = enabled && !!inputToken && !!quoteInputToken && netCygldOut > 0n && basketComponents.length > 0;
  const netCygldOutTarget = hasInput ? netCygldOut : 0n;
  const intent = useQuoteIntent({ mode: "issue-exact-out", token: inputToken ?? "", quoteToken: quoteInputToken ?? "",
    native: isNativeInputToken, amount: String(netCygldOut), targets: [], slippageBps,
    orderedAssets: basketComponents.map(component => component.token.address),
  }, hasInput);
  const result = intent.data;
  const basketPreviewMatchesComponents = sameAddressOrder(result?.orderedCoreAssets, basketComponents.map(component => component.token.address));
  const finalPreviewMatchesBasket = basketPreviewMatchesComponents;
  const execution = useMemo<IssueFromTokenExactOutExecution | undefined>(() => result && basketPreviewMatchesComponents && result.executionAmount > 0n && result.maximumInputAmount > 0n ? {
    inputToken, maxInputAmount: result.maximumInputAmount, netCygldOut: result.executionAmount,
    grossCygldOut: result.executionAmount + result.fees.protocolFeeCygld + result.fees.helperFeeCygld,
    orderedCoreAssets: result.orderedCoreAssets,
  } : undefined, [result, basketPreviewMatchesComponents, inputToken]);
  const maxInputAmount = result?.maximumInputAmount;
  const estimatedMaxInputAmount = intent.estimate;
  const routeQuotes = result?.quotes;
  const fees = result?.fees;
  const quoteStatus: TokenIssueQuoteStatus = intent.status === "success" && !execution ? "failed" : intent.status;
  const quoteError = quoteStatus === "failed" ? intent.error ?? t("noQuoteAvailableMessage") : undefined;
  const progressCounts = intent.progress;

  const { submitTokenPurchase } = useTokenPurchaseExecution({
    onNetworkFeeEstimate,
    onNetworkFeeEstimateLoadingChange,
  });

  const quotesForSubmit = routeQuotes;
  const canSubmit =
    enabled &&
    !!execution?.inputToken &&
    (execution?.maxInputAmount ?? 0n) > 0n &&
    (execution?.grossCygldOut ?? 0n) > 0n &&
    (execution?.netCygldOut ?? 0n) > 0n &&
    Array.isArray(execution?.orderedCoreAssets) &&
    basketPreviewMatchesComponents &&
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
      const maxInputAmount = execution?.maxInputAmount ?? 0n;
      const grossCygldOut = execution?.grossCygldOut ?? 0n;
      const resolvedNetCygldOut = execution?.netCygldOut ?? 0n;
      const tokenIssueQuotes = quotesForSubmit ?? [];
      if (
        !enabled ||
        !executionInputToken ||
        maxInputAmount <= 0n ||
        grossCygldOut <= 0n ||
        resolvedNetCygldOut <= 0n
      ) {
        throw new Error("IssueFromTokenExactOut is not ready");
      }
      if (
        !execution?.orderedCoreAssets
      ) {
        throw new Error("IssueFromTokenExactOut Core asset binding is unavailable");
      }

      const quotedSwapInputSum = tokenIssueQuotes.reduce(
        (sum, quote) => sum + quote.amountIn,
        0n
      );
      if (quotedSwapInputSum > maxInputAmount) {
        throw new Error("IssueFromTokenExactOut quotes exceed max input amount");
      }

      const shouldUseNativeInputFunding =
        isNativeInputToken && inputFundingMode !== "erc20";

      return submitTokenPurchase({ deployment: result?.deployment, owner, recipient, walletConfirmationTracker, walletBatch, feeEstimateSignal,
        inputToken: executionInputToken, maximumInputAmount: maxInputAmount, netCygldOut: resolvedNetCygldOut,
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
      isNativeInputToken,
      submitTokenPurchase,
      result?.deployment,
      quotesForSubmit,
    ]
  );

  return {
    adapter: result?.quotes[0]?.adapter,
    execution,
    requiresSwapAdapter: (result?.quotes.length ?? 0) > 0,
    netCygldOutTarget,
    maxInputAmount,
    maximumInputAmount: execution?.maxInputAmount,
    minimumOutputAmount: execution?.netCygldOut,
    displayExpectedInputAmount: quoteStatus === "failed" ? undefined : result?.expectedInputAmount ?? estimatedMaxInputAmount,
    displayMaxInputAmount: quoteStatus === "failed" ? undefined : execution?.maxInputAmount ?? estimatedMaxInputAmount,
    fees,
    quoteStatus,
    quoteError,
    quoteErrorCode: intent.errorCode,
    progressCounts,
    canSubmit,
    submit,
  };
}
