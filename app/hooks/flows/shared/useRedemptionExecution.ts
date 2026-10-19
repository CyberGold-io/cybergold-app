"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useCallback } from "react";
import { useWalletClient, useWriteContract } from "wagmi";
import { HELPERS_DIAMOND_ABI } from "@/app/contracts/generated/helpersDiamond";

import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import { useCygldPermit } from "./useCygldPermit";
import { useExecutionFeeEstimate } from "./useExecutionFeeEstimate";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams } from "./types";

type RedemptionOperation = "redeemToBasketExactIn" | "redeemToTokenExactIn" | "redeemToNativeExactIn";

export function useRedemptionExecution(feeHandlers: FlowNetworkFeeEstimateHandlers) {
  const { addresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const { signCygldPermit } = useCygldPermit();
  const { estimateSignedContractFee } = useExecutionFeeEstimate(feeHandlers);
  const submitRedemption = useCallback(async ({ owner, walletBatch, walletConfirmationTracker, feeEstimateSignal,
    operation, grossCygldIn, request, legs, deployment, diagnosticStage,
  }: SubmitBasketFlowParams & { operation: RedemptionOperation; grossCygldIn: bigint; request: unknown; legs?: readonly unknown[] }) => {
    const helpers = requireProtocolAddress(deployment?.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers");
    diagnosticStage?.("authorization");
    const permit = await signCygldPermit({ owner, value: grossCygldIn, walletBatch, walletConfirmationTracker, deployment });
    const functionName = permit ? `${operation}WithPermit` as const : operation;
    const args = permit ? [request, permit] : [request];
    if (legs) args.push(legs);
    diagnosticStage?.("simulation");
    if (!walletBatch?.approvals.length) await estimateSignedContractFee({ account: owner, functionName, args, helpers, signal: feeEstimateSignal });
    diagnosticStage?.("submission");
    if (walletBatch?.mode !== "requests") walletConfirmationTracker?.requestNext("transaction", "Transaction confirmation");
    if (walletBatch)
      return walletBatch.submit(functionName, args, undefined, walletConfirmationTracker);
    await assertWalletOnExpectedChain(walletClient);
    return writeContractAsync({ chainId: EXPECTED_CHAIN_ID, account: owner, address: helpers,
      abi: HELPERS_DIAMOND_ABI, functionName, args: args as never });
  }, [walletClient, writeContractAsync, signCygldPermit, estimateSignedContractFee, HELPERS_DIAMOND_ADDRESS]);
  return { submitRedemption };
}
