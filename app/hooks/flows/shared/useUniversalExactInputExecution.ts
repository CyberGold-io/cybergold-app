"use client";

import { useCallback } from "react";
import { useWalletClient, useWriteContract } from "wagmi";
import { type Address } from "viem";
import { HELPERS_TRADE_EXACT_INPUT_ABI } from "@/app/contracts/generated/helpersTradeExactInput";
import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import { estimateHelpersExecutionGas } from "@/app/utils/helpersExecutionGas";
import { exactInputFunding, exactInputNativeValue, exactInputPermissions, exactInputPlan,
  type UniversalExactInputQuote } from "@/app/utils/universalExactInput";
import { emptyTokenPermit, usePurchaseAuthorization } from "./usePurchaseAuthorization";
import { useExecutionFeeEstimate } from "./useExecutionFeeEstimate";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams } from "./types";

/** Execute the complete Backend plan; native ETH and every token are funded exactly. */
export function useUniversalExactInputExecution(feeHandlers: FlowNetworkFeeEstimateHandlers = {}) {
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const { preparePurchaseAuthorization } = usePurchaseAuthorization();
  const { estimateSignedContractFee } = useExecutionFeeEstimate(feeHandlers);
  const submit = useCallback(async (selected: UniversalExactInputQuote, params: SubmitBasketFlowParams) => {
    const captured = structuredClone(selected);
    const plan = exactInputPlan(captured.plan), helpers = captured.deployment.helpers as Address;
    params.diagnosticStage?.("authorization");
    const prepared = await preparePurchaseAuthorization({ owner: params.owner, permitted: exactInputPermissions(plan),
      nativePermitsInstalled: true, exactApproval: true, spender: helpers,
      walletBatch: captured.routeFamily === "core" ? params.walletBatch : undefined, walletConfirmationTracker: params.walletConfirmationTracker });
    const args = [plan, exactInputFunding(plan, prepared, emptyTokenPermit)] as const;
    const value = exactInputNativeValue(plan);
    params.feeEstimateSignal?.throwIfAborted();
    params.diagnosticStage?.("simulation");
    let gas: bigint | undefined;
    // Market approvals complete before its existing signed-call preflight. Core estimation remains advisory.
    if (captured.routeFamily !== "core") gas = await estimateHelpersExecutionGas(params.owner,
      "executeExactInput", args, value, fetch, params.feeEstimateSignal, helpers);
    else if (!params.walletBatch?.approvals.length) await estimateSignedContractFee({ account: params.owner, helpers, functionName: "executeExactInput",
      args, value, signal: params.feeEstimateSignal });
    params.feeEstimateSignal?.throwIfAborted();
    params.diagnosticStage?.("submission");
    if (params.walletBatch?.mode !== "requests") params.walletConfirmationTracker?.requestNext("transaction", "Transaction confirmation");
    if (params.walletBatch) return params.walletBatch.submit("executeExactInput", args, value, params.walletConfirmationTracker);
    await assertWalletOnExpectedChain(walletClient);
    return writeContractAsync({ chainId: EXPECTED_CHAIN_ID, account: params.owner, address: helpers,
      abi: HELPERS_TRADE_EXACT_INPUT_ABI, functionName: "executeExactInput", args, value,
      ...(gas ? { gas: gas * 12n / 10n } : {}) });
  }, [preparePurchaseAuthorization, estimateSignedContractFee, walletClient, writeContractAsync]);
  return { submit };
}
