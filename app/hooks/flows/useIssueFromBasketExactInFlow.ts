"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";

import { usePreviewIssueFromBasketExactIn } from "@/app/hooks/cybergold-helpers/usePreviewIssueFromBasketExactIn";
import type { BasketComponent, TokenIssueQuoteStatus } from "@/app/types";
import { applySlippageFloor, DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";
import type {
  FlowNetworkFeeEstimateHandlers,
  SubmitBasketFlowParams,
} from "./shared/types";
import { useBasketPurchaseExecution } from "./shared/useBasketPurchaseExecution";

const EMPTY_AMOUNTS: readonly bigint[] = [];

type UseIssueFromBasketExactInFlowParams = {
  enabled: boolean;
  amountsIn: readonly bigint[];
  basketComponents: readonly BasketComponent[];
} & FlowNetworkFeeEstimateHandlers;

export function useIssueFromBasketExactInFlow({
  enabled,
  amountsIn,
  basketComponents,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  onNetworkFeeEstimate,
  onNetworkFeeEstimateLoadingChange,
}: UseIssueFromBasketExactInFlowParams) {
  const t = useTranslations("Home");
  const previewAmountsIn = useMemo(
    () =>
      enabled &&
      amountsIn.length === basketComponents.length &&
      amountsIn.some((amount) => amount > 0n)
        ? amountsIn
        : EMPTY_AMOUNTS,
    [amountsIn, basketComponents.length, enabled]
  );
  const preview = usePreviewIssueFromBasketExactIn(previewAmountsIn, enabled);
  const quote = preview.data;
  const minimumOutputAmount = quote ? applySlippageFloor(quote.netCygldOut, slippageBps) : undefined;
  const quoteMatchesBasket = useMemo(
    () =>
      quote !== undefined &&
      quote.amountsInExact.length === basketComponents.length &&
      quote.orderedCoreAssets.length === basketComponents.length &&
      quote.orderedCoreAssets.every(
        (asset, index) =>
          asset.toLowerCase() ===
          basketComponents[index]?.token.address.toLowerCase()
      ),
    [basketComponents, quote]
  );
  const canSubmit =
    enabled &&
    quoteMatchesBasket &&
    quote !== undefined &&
    quote.netCygldOut > 0n;
  const quoteStatus = useMemo<TokenIssueQuoteStatus>(() => {
    if (!enabled || previewAmountsIn.length === 0) return "idle";
    if (preview.isLoading || (!preview.isFetched && !preview.isError)) {
      return "loading";
    }
    return canSubmit ? "success" : "failed";
  }, [
    canSubmit,
    enabled,
    preview.isError,
    preview.isFetched,
    preview.isLoading,
    previewAmountsIn.length,
  ]);
  const quoteError =
    quoteStatus === "failed"
      ? (preview.error instanceof Error ? preview.error.message : undefined) ??
        t("noQuoteAvailableMessage")
      : undefined;

  const { submitBasketPurchase } = useBasketPurchaseExecution({ onNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange });
  const submit = useCallback(async (params: SubmitBasketFlowParams) => {
    if (!quote || !canSubmit) throw new Error("IssueFromBasketExactIn is not ready");
    return submitBasketPurchase({ ...params, mode: "exact-in",
      request: { recipient: params.recipient, minimumNetCygldOut: minimumOutputAmount! },
      permitted: quote.orderedCoreAssets.map((token, index) => ({ token, amount: previewAmountsIn[index] ?? 0n })) });
  }, [canSubmit, submitBasketPurchase, previewAmountsIn, quote, minimumOutputAmount]);

  return {
    ...preview,
    quote,
    grossCygldOut: quote
      ? quote.netCygldOut +
        quote.fees.protocolFeeCygld +
        quote.fees.helperFeeCygld
      : undefined,
    netCygldOut: quote?.netCygldOut,
    minimumOutputAmount,
    maximumInputAmounts: quote ? previewAmountsIn : undefined,
    fees: quote?.fees,
    amountsInUsed: quote?.amountsInExact,
    permitted:
      quote?.orderedCoreAssets.map((token, index) => ({
        token,
        amount: previewAmountsIn[index] ?? 0n,
      })) ?? [],
    quoteStatus,
    quoteError,
    canSubmit,
    submit,
  };
}
