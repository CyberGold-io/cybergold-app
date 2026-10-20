"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { getAddress, toHex, type Address } from "viem";
import { useCoreRecoveryAssets } from "@/app/hooks/cybergold/useCoreRecoveryAssets";


import { usePreviewRedeemToBasketExactOut } from "@/app/hooks/cybergold-helpers/usePreviewRedeemToBasketExactOut";
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
import { useUniversalExactInputExecution } from "./shared/useUniversalExactInputExecution";
import { fetchUniversalExactInputQuote, preserveExactInputBasketMinimums } from "@/app/utils/universalExactInput";
import { zeroAddress } from "viem";
import { buildQuoteDeadline } from "@/app/utils/swapPolicy";

const EMPTY_MINIMUMS: readonly CoreTokenMinimum[] = [];

type UseRedeemToBasketExactOutFlowParams = {
  enabled: boolean;
  amountsOut: readonly bigint[];
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

export function useRedeemToBasketExactOutFlow({
  enabled,
  amountsOut,
  basketComponents,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
  onNetworkFeeEstimate,
  onNetworkFeeEstimateLoadingChange,
}: UseRedeemToBasketExactOutFlowParams) {
  const { core: CORE_DIAMOND_ADDRESS } = useProtocolConfiguration().addresses;
  const t = useTranslations("Home");
  const hasTarget =
    enabled &&
    amountsOut.length === basketComponents.length &&
    amountsOut.some((amount) => amount > 0n);
  const recoveryAssetsRead = useCoreRecoveryAssets(hasTarget);
  const minimumOutputs = useMemo<readonly CoreTokenMinimum[]>(() => {
    if (!hasTarget || recoveryAssetsRead.data === undefined) {
      return EMPTY_MINIMUMS;
    }
    return [
      ...basketComponents.map((component, index) => ({
        kind: CORE_TOKEN_KIND.ERC20,
        token: component.token.address,
        id: 0n,
        minimumAmount: amountsOut[index] ?? 0n,
      } as const)),
      ...recoveryAssetsRead.data.map((asset) => ({
        kind: CORE_TOKEN_KIND.ERC1155,
        token: requireProtocolAddress(CORE_DIAMOND_ADDRESS, "Core"),
        id: BigInt(asset),
        minimumAmount: 0n,
      } as const)),
    ];
  }, [amountsOut, basketComponents, hasTarget, recoveryAssetsRead.data, CORE_DIAMOND_ADDRESS]);
  const preview = usePreviewRedeemToBasketExactOut(
    minimumOutputs,
    hasTarget && recoveryAssetsRead.data !== undefined
  );
  const projectedCoreOutputs = useMemo(
    () =>
      preview.data
        ? asCoreOutputs(preview.data.projectedCoreOutputs)
        : undefined,
    [preview.data]
  );
  const expectedCoreOutputs = useMemo<CoreTokenMinimum[] | undefined>(() => {
    if (
      !projectedCoreOutputs ||
      projectedCoreOutputs.length !== minimumOutputs.length
    ) {
      return undefined;
    }
    return projectedCoreOutputs.map((output, index) => ({
      kind: output.kind,
      token: output.token,
      id: output.id,
      minimumAmount:
        output.kind === CORE_TOKEN_KIND.ERC20
          ? minimumOutputs[index]?.minimumAmount ?? 0n
          : applySlippageFloor(output.amount, slippageBps),
    }));
  }, [minimumOutputs, projectedCoreOutputs, slippageBps]);
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
  const grossCygldIn = preview.data?.grossCygldIn;
  const canSubmit =
    hasTarget &&
    grossCygldIn !== undefined &&
    grossCygldIn > 0n &&
    expectedCoreOutputs !== undefined;
  const quoteStatus = useMemo<TokenIssueQuoteStatus>(() => {
    if (!hasTarget) return "idle";
    if (recoveryAssetsRead.isError) return "failed";
    if (
      recoveryAssetsRead.isLoading ||
      preview.isLoading ||
      (!preview.isFetched && !preview.isError)
    ) {
      return "loading";
    }
    return canSubmit ? "success" : "failed";
  }, [
    canSubmit,
    hasTarget,
    preview.isError,
    preview.isFetched,
    preview.isLoading,
    recoveryAssetsRead.isError,
    recoveryAssetsRead.isLoading,
  ]);
  const quoteError =
    quoteStatus === "failed"
      ? (preview.error instanceof Error ? preview.error.message : undefined) ??
        (recoveryAssetsRead.error instanceof Error
          ? recoveryAssetsRead.error.message
          : undefined) ??
        t("noQuoteAvailableMessage")
      : undefined;

  const { addresses } = useProtocolConfiguration();
  const { submit: submitUniversal } = useUniversalExactInputExecution({ onNetworkFeeEstimate, onNetworkFeeEstimateLoadingChange });
  const submit = useCallback(async (params: SubmitBasketFlowParams) => {
    if (!grossCygldIn || !expectedCoreOutputs || !canSubmit) throw new Error("RedeemToBasketExactOut is not ready");
    const fresh = await fetchUniversalExactInputQuote({ intent: 3,
      inputs: [{ currency: addresses.core!, amount: String(grossCygldIn) }], outputCurrency: zeroAddress,
      recipient: params.recipient, deadline: String(buildQuoteDeadline()), slippageBps }, params.feeEstimateSignal);
    return submitUniversal(preserveExactInputBasketMinimums(fresh, expectedCoreOutputs), params);
  }, [canSubmit, submitUniversal, expectedCoreOutputs, grossCygldIn, addresses.core, slippageBps]);

  return {
    ...preview,
    quote: preview.data,
    grossCygldIn,
    maximumInputAmount: grossCygldIn,
    netCygldIn:
      grossCygldIn === undefined || !preview.data
        ? undefined
        : grossCygldIn -
          preview.data.fees.protocolFeeCygld -
          preview.data.fees.helperFeeCygld,
    fees: preview.data?.fees,
    projectedCoreOutputs,
    amountsOut: erc20Outputs?.map((output) => output.amount),
    minimumOutputAmounts: expectedCoreOutputs?.filter(output => output.kind === CORE_TOKEN_KIND.ERC20)
      .map(output => output.minimumAmount),
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
