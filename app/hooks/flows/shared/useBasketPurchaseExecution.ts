"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useCallback } from "react";
import { useWalletClient, useWriteContract } from "wagmi";

import { HELPERS_DIAMOND_ABI } from "@/app/contracts/generated/helpersDiamond";
import { fetchBasketPermitIssuanceInstalled } from "@/app/utils/helpersRouterFacts";
import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import { useExecutionFeeEstimate } from "./useExecutionFeeEstimate";
import { usePurchaseAuthorization } from "./usePurchaseAuthorization";
import { usePermit2Transfer } from "./usePermit2Transfer";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams, TokenPermissions } from "./types";

export function useBasketPurchaseExecution(feeHandlers: FlowNetworkFeeEstimateHandlers) {
  const { addresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const { preparePurchaseAuthorization } = usePurchaseAuthorization();
  const { prepareBatchPermit2 } = usePermit2Transfer();
  const { estimateSignedContractFee } = useExecutionFeeEstimate(feeHandlers);
  const submitBasketPurchase = useCallback(async ({ owner, walletBatch, walletConfirmationTracker, feeEstimateSignal,
    mode, permitted, request, deployment, diagnosticStage,
  }: SubmitBasketFlowParams & { mode: "exact-in" | "exact-out"; permitted: readonly TokenPermissions[];
    request: { recipient: `0x${string}`; minimumNetCygldOut?: bigint; netCygldOut?: bigint } }) => {
    const helpers = requireProtocolAddress(deployment?.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers");
    diagnosticStage?.("authorization");
    const mixed = await fetchBasketPermitIssuanceInstalled(mode);
    const authorization = mixed ? await preparePurchaseAuthorization({ owner, permitted,
      nativePermitsInstalled: true, spender: helpers, walletBatch, walletConfirmationTracker }) : undefined;
    const permit2 = authorization?.permit2 ?? await prepareBatchPermit2({ owner, permitted, spender: helpers, walletBatch, walletConfirmationTracker });
    const functionName = mode === "exact-in"
      ? mixed ? "issueFromBasketExactInWithMixedPermits" : "issueFromBasketExactInWithPermit2"
      : mixed ? "issueFromBasketExactOutWithMixedPermits" : "issueFromBasketExactOutWithPermit2";
    const args = authorization ? [request, authorization.inputs, permit2] : [request, permit2];
    diagnosticStage?.("simulation");
    if (!walletBatch?.approvals.length) await estimateSignedContractFee({ account: owner, functionName, args, helpers, signal: feeEstimateSignal });
    diagnosticStage?.("submission");
    if (walletBatch?.mode !== "requests") walletConfirmationTracker?.requestNext("transaction", "Transaction confirmation");
    if (walletBatch)
      return walletBatch.submit(functionName, args, undefined, walletConfirmationTracker);
    await assertWalletOnExpectedChain(walletClient);
    return writeContractAsync({ chainId: EXPECTED_CHAIN_ID, account: owner, address: helpers,
      abi: HELPERS_DIAMOND_ABI, functionName, args: args as never });
  }, [walletClient, writeContractAsync, preparePurchaseAuthorization, prepareBatchPermit2, estimateSignedContractFee, HELPERS_DIAMOND_ADDRESS]);
  return { submitBasketPurchase };
}
