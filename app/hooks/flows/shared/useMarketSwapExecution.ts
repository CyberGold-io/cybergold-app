"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useCallback } from "react";
import { useWalletClient, useWriteContract } from "wagmi";
import type { Address } from "viem";
import { HELPERS_MARKET_ABI } from "@/app/contracts/generated/helpersMarket";

import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import { fetchMarketSwapInstalled } from "@/app/utils/helpersRouterFacts";
import { estimateHelpersExecutionGas } from "@/app/utils/helpersExecutionGas";
import { marketFundingAuthorization } from "@/app/utils/marketSwap";
import type { MarketQuoteResult } from "@/app/utils/marketQuote";
import type { WalletConfirmationTracker } from "./types";
import type { DiagnosticStage } from "@/app/utils/clientDiagnostics";
import { usePurchaseAuthorization } from "./usePurchaseAuthorization";

type ExactOutputMarketQuoteResult = Omit<MarketQuoteResult, "value"> & { value: MarketQuoteResult["value"] & { mode: "exact-out" } };

/** Retained true exact-output calls use the input token's native permit. */
export function useMarketSwapExecution() {
  const { addresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const { preparePurchaseAuthorization } = usePurchaseAuthorization();
  const submit = useCallback(async (quote: ExactOutputMarketQuoteResult, owner: Address,
    walletConfirmationTracker?: WalletConfirmationTracker, signal?: AbortSignal, diagnosticStage?: (stage: DiagnosticStage) => void) => {
    const helpers = requireProtocolAddress(quote.deployment?.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers");
    const amount = quote.params.bound;
    diagnosticStage?.("authorization");
    const authorization = await preparePurchaseAuthorization({ owner,
      permitted: [{ token: quote.value.tokenIn as Address, amount }],
      nativePermitsInstalled: () => fetchMarketSwapInstalled("exact-out"),
      singlePermit2: true, spender: helpers, walletConfirmationTracker });
    const functionName = "swapExactOutput";
    const args = [quote.params, marketFundingAuthorization(authorization)] as const;
    signal?.throwIfAborted();
    // This is the actual signed call. Economic Quoter qualification alone does
    // not prove native-permit funding, settlement or the selected net bounds.
    diagnosticStage?.("simulation");
    const gas = await estimateHelpersExecutionGas(owner, functionName, args, undefined, fetch, signal, helpers);
    signal?.throwIfAborted();
    await assertWalletOnExpectedChain(walletClient);
    diagnosticStage?.("submission");
    walletConfirmationTracker?.requestNext("transaction", "Transaction confirmation");
    return writeContractAsync({ chainId: EXPECTED_CHAIN_ID, account: owner,
      address: helpers, abi: HELPERS_MARKET_ABI,
      functionName, args, gas: gas * 12n / 10n });
  }, [preparePurchaseAuthorization, walletClient, writeContractAsync, HELPERS_DIAMOND_ADDRESS]);
  return { submit };
}
