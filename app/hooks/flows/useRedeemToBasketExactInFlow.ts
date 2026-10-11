"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { getAddress, toHex, type Address } from "viem";

import { usePreviewRedeemToBasketExactIn } from "@/app/hooks/cybergold-helpers/usePreviewRedeemToBasketExactIn";
import {
  CORE_TOKEN_KIND,
  type BasketComponent,
  type CoreTokenAmount,
  type CoreTokenMinimum,
  type TokenIssueQuoteStatus,
} from "@/app/types";
import { applySlippageFloor, DEFAULT_SLIPPAGE_BPS } from "@/app/utils/swapPolicy";
import type {
  FlowNetworkFeeEstimateHandlers,
  SubmitBasketFlowParams,
} from "./shared/types";
import { useRedemptionExecution } from "./shared/useRedemptionExecution";

type UseRedeemToBasketExactInFlowParams = {
  enabled: boolean;
  grossCygldIn: bigint;
  basketComponents: readonly BasketComponent[];
} & FlowNetworkFeeEstimateHandlers;

function asCoreOutputs(
  outputs: readonly { kind: number; token: Address; id: bigint; amount: bigint }[]
): CoreTokenAmount[] {
  return outputs.map((output) => ({
    kind:
      output.kind === CORE_TOKEN_KIND.ERC1155
        ? CORE_TOKEN_KIND.ERC1155
        : CORE_TOKEN_KIND.ERC20,
    token: output.token,
    id: output.id,
    amount: output.amount,
  }));
}

function recoveryAssetForShareId(shareId: bigint) {
  return getAddress(toHex(shareId, { size: 20 }));
}

export function useRedeemToBasketExactInFlow({
  enabled,
  grossCygldIn,
  basketComponents,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  onNetworkFeeEstimate,
  onNetworkFeeEstimateLoadingChange,
}: UseRedeemToBasketExactInFlowParams) {
  const t = useTranslations("Home");
  const preview = usePreviewRedeemToBasketExactIn(grossCygldIn, enabled);
  const projectedCoreOutputs = useMemo(
    () =>
      preview.data
        ? asCoreOutputs(preview.data.projectedCoreOutputs)
        : undefined,
    [preview.data]
  );
  const expectedCoreOutputs = useMemo<CoreTokenMinimum[] | undefined>(
    () =>
      projectedCoreOutputs?.map((output) => ({
        kind: output.kind,
        token: output.token,
        id: output.id,
        minimumAmount: applySlippageFloor(output.amount, slippageBps),
      })),
    [projectedCoreOutputs, slippageBps]
  );
  const erc20Outputs = useMemo(
    () =>
      projectedCoreOutputs?.filter(
        (output) => output.kind === CORE_TOKEN_KIND.ERC20
      ),
    [projectedCoreOutputs]
  );
  const recoveryOutputs = useMemo(
    () =>
      projectedCoreOutputs?.filter(
        (output) =>
          output.kind === CORE_TOKEN_KIND.ERC1155 && output.amount > 0n
      ),
    [projectedCoreOutputs]
  );
  const outputVectorMatchesBasket =
    erc20Outputs?.length === basketComponents.length &&
    erc20Outputs.every(
      (output, index) =>
        output.token.toLowerCase() ===
        basketComponents[index]?.token.address.toLowerCase()
    );
  const canSubmit =
    enabled &&
    grossCygldIn > 0n &&
    expectedCoreOutputs !== undefined &&
    projectedCoreOutputs?.some((output) => output.amount > 0n) === true &&
    outputVectorMatchesBasket;
  const quoteStatus = useMemo<TokenIssueQuoteStatus>(() => {
    if (!enabled || grossCygldIn <= 0n) return "idle";
    if (preview.isLoading || (!preview.isFetched && !preview.isError)) {
      return "loading";
    }
    return canSubmit ? "success" : "failed";
  }, [
    canSubmit,
    enabled,
    grossCygldIn,
    preview.isError,
    preview.isFetched,
    preview.isLoading,
  ]);
  const quoteError =
    quoteStatus === "failed"
      ? (preview.error instanceof Error ? preview.error.message : undefined) ??
        t("noQuoteAvailableMessage")
      : undefined;

  const { submitRedemption } = useRedemptionExecution({ onNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange });
  const submit = useCallback(async (params: SubmitBasketFlowParams) => {
    if (!expectedCoreOutputs || !canSubmit) throw new Error("RedeemToBasketExactIn is not ready");
    return submitRedemption({ ...params, operation: "redeemToBasketExactIn", grossCygldIn,
      request: { grossCygldIn, recipient: params.recipient, expectedCoreOutputs } });
  }, [canSubmit, submitRedemption, expectedCoreOutputs, grossCygldIn]);

  return {
    ...preview,
    quote: preview.data,
    grossCygldIn,
    maximumInputAmount: preview.data ? grossCygldIn : undefined,
    netCygldIn: preview.data
      ? grossCygldIn -
        preview.data.fees.protocolFeeCygld -
        preview.data.fees.helperFeeCygld
      : undefined,
    fees: preview.data?.fees,
    amountsOut: erc20Outputs?.map((output) => output.amount),
    minimumOutputAmounts: expectedCoreOutputs?.filter(output => output.kind === CORE_TOKEN_KIND.ERC20)
      .map(output => output.minimumAmount),
    projectedCoreOutputs,
    recoverySharesOut: recoveryOutputs?.map((output) => output.amount),
    orderedRecoveryAssets: recoveryOutputs?.map((output) =>
      recoveryAssetForShareId(output.id)
    ),
    quoteStatus,
    quoteError,
    canSubmit,
    submit,
  };
}
