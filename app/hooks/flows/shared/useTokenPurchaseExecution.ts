"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";
import { useCallback } from "react";
import { type Address } from "viem";
import { useIssueFromTokenExactOutWithPermit2 } from "@/app/hooks/cybergold-helpers/useIssueFromTokenExactOutWithPermit2";
import { fetchTokenPermitIssuanceInstalled } from "@/app/utils/helpersRouterFacts";
import type { SwapToQuote } from "@/app/types";
import type { FlowNetworkFeeEstimateHandlers, SubmitBasketFlowParams } from "./types";
import { useExecutionFeeEstimate } from "./useExecutionFeeEstimate";
import { usePurchaseAuthorization } from "./usePurchaseAuthorization";

/** Exact-in and exact-out quotes settle through the same exact-output executor. */
export function useTokenPurchaseExecution(feeHandlers: FlowNetworkFeeEstimateHandlers) {
  const { addresses } = useProtocolConfiguration();
  const { issueFromNativeExactOut, issueFromTokenExactOut, issueFromTokenExactOutWithPermit,
    issueFromTokenExactOutWithPermit2 } = useIssueFromTokenExactOutWithPermit2();
  const { preparePurchaseAuthorization } = usePurchaseAuthorization();
  const { estimateSignedContractFee } = useExecutionFeeEstimate(feeHandlers);

  const submitTokenPurchase = useCallback(async ({
    owner, recipient, walletConfirmationTracker, walletBatch, feeEstimateSignal, deployment,
    inputToken, maximumInputAmount, netCygldOut, expectedOrderedCoreAssets, quotes, nativeInput,
  }: SubmitBasketFlowParams & {
    inputToken: Address; maximumInputAmount: bigint; netCygldOut: bigint;
    expectedOrderedCoreAssets: readonly Address[]; quotes: readonly SwapToQuote[]; nativeInput: boolean;
  }) => {
    const helpers = requireProtocolAddress(deployment?.helpers ?? addresses.helpers, "Helpers");
    const authorization = nativeInput ? undefined : await preparePurchaseAuthorization({ owner,
      permitted: [{ token: inputToken, amount: maximumInputAmount }],
      nativePermitsInstalled: fetchTokenPermitIssuanceInstalled, singlePermit2: true, spender: helpers, walletBatch, walletConfirmationTracker });
    if (nativeInput) walletConfirmationTracker?.setTotal(1);
    const input = authorization?.inputs[0];
    const permit = input?.authorization === 1 ? input.permit : undefined;
    const permit2 = input?.authorization === 2 ? { permit: { ...authorization!.permit2.permit,
      permitted: authorization!.permit2.permit.permitted[0] }, signature: authorization!.permit2.signature } : undefined;
    const params = { inputToken, maximumInputAmount, netCygldOut };
    const execution = { recipient, expectedOrderedCoreAssets };
    const legs = quotes.map(quote => ({ adapter: quote.adapter, amountIn: quote.amountIn,
      minimumAmountOut: quote.minimumAmountOut, data: quote.data }));
    const functionName = nativeInput ? "issueFromNativeExactOut" : permit ? "issueFromTokenExactOutWithPermit"
      : permit2 ? "issueFromTokenExactOutWithPermit2" : "issueFromTokenExactOut";
    const args = nativeInput ? [{ maximumNativeIn: maximumInputAmount, netCygldOut }, execution, legs]
      : permit ? [params, execution, permit, legs] : permit2 ? [params, execution, permit2, legs] : [params, execution, legs];
    if (!walletBatch?.approvals.length) await estimateSignedContractFee({ account: owner, helpers, functionName, args,
      signal: feeEstimateSignal, value: nativeInput ? maximumInputAmount : undefined });
    if (walletBatch?.mode !== "requests") walletConfirmationTracker?.requestNext("transaction", "Transaction confirmation");
    if (walletBatch)
      return walletBatch.submit(functionName, args, nativeInput ? maximumInputAmount : undefined, walletConfirmationTracker);
    if (nativeInput) return issueFromNativeExactOut({ account: owner, helpers, maximumNativeIn: maximumInputAmount, netCygldOut, execution, quotes });
    if (permit) return issueFromTokenExactOutWithPermit({ account: owner, helpers, params, execution, permit, quotes });
    if (permit2) return issueFromTokenExactOutWithPermit2({ account: owner, helpers, params, execution, permit: permit2, quotes });
    return issueFromTokenExactOut({ account: owner, helpers, params, execution, quotes });
  }, [preparePurchaseAuthorization, estimateSignedContractFee, issueFromNativeExactOut,
    issueFromTokenExactOut, issueFromTokenExactOutWithPermit, issueFromTokenExactOutWithPermit2, addresses]);

  return { submitTokenPurchase };
}
