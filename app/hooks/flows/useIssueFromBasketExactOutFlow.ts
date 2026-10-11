"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";

import { usePreviewIssueFromBasketExactOut } from "@/app/hooks/cybergold-helpers/usePreviewIssueFromBasketExactOut";
import type { BasketComponent, TokenIssueQuoteStatus } from "@/app/types";
import { applySlippageCeil, DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";
import type {
  FlowNetworkFeeEstimateHandlers,
  SubmitBasketFlowParams,
} from "./shared/types";
import { useBasketPurchaseExecution } from "./shared/useBasketPurchaseExecution";

type UseIssueFromBasketExactOutFlowParams = {
  enabled: boolean;
  netCygldOut: bigint;
  basketComponents: readonly BasketComponent[];
} & FlowNetworkFeeEstimateHandlers;

export function useIssueFromBasketExactOutFlow({
  enabled,
  netCygldOut,
  basketComponents,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  onNetworkFeeEstimate,
  onNetworkFeeEstimateLoadingChange,
}: UseIssueFromBasketExactOutFlowParams) {
  const t = useTranslations("Home");
  const target = enabled && netCygldOut > 0n ? netCygldOut : 0n;
  const preview = usePreviewIssueFromBasketExactOut(target, enabled);
  const quote = preview.data;
  const maximumAmountsIn = useMemo(
    () => quote?.amountsInExact.map(amount => applySlippageCeil(amount, slippageBps)),
    [quote?.amountsInExact, slippageBps]
  );
  const quoteMatchesBasket = useMemo(
    () =>
      quote !== undefined &&
      maximumAmountsIn?.length === basketComponents.length &&
      quote.orderedCoreAssets.length === basketComponents.length &&
      quote.orderedCoreAssets.every(
        (asset, index) =>
          asset.toLowerCase() ===
          basketComponents[index]?.token.address.toLowerCase()
      ),
    [basketComponents, maximumAmountsIn?.length, quote]
  );
  const canSubmit = enabled && target > 0n && quoteMatchesBasket;
  const quoteStatus = useMemo<TokenIssueQuoteStatus>(() => {
    if (!enabled || target <= 0n) return "idle";
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
    target,
  ]);
  const quoteError =
    quoteStatus === "failed"
      ? (preview.error instanceof Error ? preview.error.message : undefined) ??
        t("noQuoteAvailableMessage")
      : undefined;

  const { submitBasketPurchase } = useBasketPurchaseExecution({ onNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange });
  const submit = useCallback(async (params: SubmitBasketFlowParams) => {
    if (!quote || !maximumAmountsIn || !canSubmit) throw new Error("IssueFromBasketExactOut is not ready");
    return submitBasketPurchase({ ...params, mode: "exact-out", request: { netCygldOut: target, recipient: params.recipient },
      permitted: quote.orderedCoreAssets.map((token, index) => ({ token, amount: maximumAmountsIn[index] ?? 0n })) });
  }, [canSubmit, submitBasketPurchase, maximumAmountsIn, quote, target]);

  return {
    ...preview,
    quote,
    netCygldOutTarget: target,
    grossCygldOut: quote
      ? target + quote.fees.protocolFeeCygld + quote.fees.helperFeeCygld
      : undefined,
    netCygldOut: target > 0n ? target : undefined,
    fees: quote?.fees,
    amountsInRequired: quote?.amountsInExact,
    maximumInputAmounts: maximumAmountsIn,
    minimumOutputAmount: quote ? target : undefined,
    permitted:
      quote?.orderedCoreAssets.map((token, index) => ({
        token,
        amount: maximumAmountsIn?.[index] ?? 0n,
      })) ?? [],
    quoteStatus,
    quoteError,
    canSubmit,
    submit,
  };
}
