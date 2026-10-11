"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { getAddress, toHex, type Address } from "viem";
import { CORE_TOKEN_KIND, type TokenIssueQuoteStatus, type BasketComponent, type CoreTokenAmount, type CoreTokenMinimum, type RoutedSwapFromQuote } from "@/app/types";
import { computeSwapBudgetsExactOut } from "@/app/utils/swapBudgets";
import { useQuoteIntent } from "./quotes/useQuoteIntent";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams } from "./shared/types";
import { useRedemptionExecution } from "./shared/useRedemptionExecution";
import { DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";

type RedeemToTokenExactInExecution = {
  outputToken: Address;
  nativeOutput: boolean;
  grossCygldIn: bigint;
  minimumAmountOut: bigint;
  quotes: readonly RoutedSwapFromQuote[];
  expectedCoreOutputs: readonly CoreTokenMinimum[];
  projectedCoreOutputs: readonly CoreTokenAmount[];
};

type UseRedeemToTokenExactInFlowParams = {
  enabled: boolean;
  outputToken?: Address;
  quoteOutputToken?: Address;
  grossCygldIn: bigint;
  targetOut?: bigint;
  basketComponents: readonly BasketComponent[];
  isNativeOutputToken?: boolean;
  aggregateMinimumAmountOut?: bigint;
} & FlowNetworkFeeEstimateHandlers;

function recoveryAssetForShareId(shareId: bigint) {
  return getAddress(toHex(shareId, { size: 20 }));
}

export function useRedeemToTokenExactInFlow({
  enabled,
  outputToken,
  quoteOutputToken,
  grossCygldIn: enteredGrossCygldIn,
  targetOut,
  basketComponents,
  isNativeOutputToken = false,
  aggregateMinimumAmountOut,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  onNetworkFeeEstimate,
  onNetworkFeeEstimateLoadingChange,
}: UseRedeemToTokenExactInFlowParams) {
  const t = useTranslations("Home");
  const isExactOut = targetOut !== undefined;
  const hasInput = enabled && !!outputToken && !!quoteOutputToken &&
    (isExactOut ? targetOut > 0n : enteredGrossCygldIn > 0n) && basketComponents.length > 0;
  const seed = useMemo(() => isExactOut && quoteOutputToken && targetOut > 0n ? computeSwapBudgetsExactOut({
    outputToken: quoteOutputToken, outputAmount: targetOut, components: basketComponents,
  }) : undefined, [isExactOut, quoteOutputToken, targetOut, basketComponents]);
  const intent = useQuoteIntent({ mode: isExactOut ? "redeem-exact-out" : "redeem-exact-in",
    token: outputToken ?? "", quoteToken: quoteOutputToken ?? "", native: isNativeOutputToken,
    amount: String(isExactOut ? targetOut : enteredGrossCygldIn), slippageBps,
    orderedAssets: basketComponents.map(component => component.token.address),
    targets: (seed?.targets ?? []).filter(target => target.targetOut > 0n).map(target => ({
      inputAsset: target.asset, outputAsset: quoteOutputToken ?? "", amount: String(target.targetOut),
    })),
  }, hasInput && (!isExactOut || seed !== undefined));
  const result = intent.data;
  const grossCygldIn = result?.executionAmount ?? enteredGrossCygldIn;
  const routeQuotes = result?.redemptionQuotes;
  const helperPreview = { data: result ? { minimumAmountOut: result.quotedAmountOut,
    projectedCoreOutputs: result.projectedCoreOutputs, fees: result.fees } : undefined };
  const projectedCoreOutputs = useMemo(() => result?.projectedCoreOutputs, [result]);
  const expectedCoreOutputs = result?.expectedCoreOutputs;
  const execution = useMemo<RedeemToTokenExactInExecution | undefined>(() => {
    const quotedAmountOut = helperPreview.data?.minimumAmountOut;
    const minimumAmountOut = aggregateMinimumAmountOut ?? quotedAmountOut;
    if (!outputToken || !routeQuotes || !projectedCoreOutputs || !expectedCoreOutputs ||
      quotedAmountOut === undefined || minimumAmountOut === undefined ||
      quotedAmountOut < minimumAmountOut ||
      minimumAmountOut <= 0n) return undefined;
    return {
      outputToken,
      nativeOutput: isNativeOutputToken,
      grossCygldIn,
      minimumAmountOut,
      quotes: routeQuotes,
      expectedCoreOutputs,
      projectedCoreOutputs,
    };
  }, [
    aggregateMinimumAmountOut,
    expectedCoreOutputs,
    grossCygldIn,
    helperPreview.data?.minimumAmountOut,
    isNativeOutputToken,
    outputToken,
    projectedCoreOutputs,
    routeQuotes,
  ]);

  const quoteStatus: TokenIssueQuoteStatus = intent.status === "success" && !execution ? "failed" : intent.status;
  const quoteError = quoteStatus === "failed" ? intent.error ?? t("noQuoteAvailableMessage") : undefined;
  const progressCounts = intent.progress;

  const { submitRedemption } = useRedemptionExecution({ onNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange });
  const submit = useCallback(async (params: SubmitBasketFlowParams) => {
    if (!execution) throw new Error("RedeemToTokenExactIn is not ready");
    const request = { grossCygldIn: execution.grossCygldIn, recipient: params.recipient,
      minimumAmountOut: execution.minimumAmountOut, expectedCoreOutputs: execution.expectedCoreOutputs };
    return submitRedemption({ deployment: result?.deployment, ...params, grossCygldIn: execution.grossCygldIn,
      operation: execution.nativeOutput ? "redeemToNativeExactIn" : "redeemToTokenExactIn",
      request: execution.nativeOutput ? request : { ...request, outputToken: execution.outputToken },
      legs: execution.quotes.map(quote => ({ adapter: quote.adapter, minimumAmountOut: quote.minimumAmountOut, data: quote.data })) });
  }, [execution, submitRedemption, result?.deployment]);

  const recoveryOutputs = projectedCoreOutputs?.filter(
    output => output.kind === CORE_TOKEN_KIND.ERC1155 && output.amount > 0n
  );
  return {
    adapter: result?.redemptionQuotes[0]?.adapter,
    execution,
    displayGrossCygldIn: isExactOut ? execution?.grossCygldIn ?? result?.displayAmount ?? intent.estimate : grossCygldIn,
    displayExpectedInputAmount: isExactOut ? result?.expectedInputAmount ?? result?.displayAmount ?? intent.estimate : undefined,
    requiresSwapAdapter: (routeQuotes?.length ?? 0) > 0,
    netAmountOut: execution?.minimumAmountOut,
    minimumOutputAmount: execution?.minimumAmountOut,
    maximumInputAmount: execution?.grossCygldIn,
    displayNetAmountOut: quoteStatus === "failed" ? undefined : isExactOut ? execution?.minimumAmountOut
      : result?.displayAmount ?? intent.estimate,
    quotedAmountOut: helperPreview.data?.minimumAmountOut,
    projectedCoreOutputs,
    fees: helperPreview.data?.fees,
    recoverySharesOut: recoveryOutputs?.map((output) => output.amount),
    orderedRecoveryAssets: recoveryOutputs?.map((output) =>
      recoveryAssetForShareId(output.id)),
    quoteStatus,
    quoteError,
    quoteErrorCode: intent.errorCode,
    progressCounts,
    canSubmit: enabled && !!execution,
    submit,
  };
}
