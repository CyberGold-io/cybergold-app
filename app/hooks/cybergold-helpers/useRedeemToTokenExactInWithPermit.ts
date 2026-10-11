"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useWaitForTransactionReceipt, useWalletClient, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";

import { HELPERS_ABI_REDEEM_TO_TOKEN } from "@/app/contracts/cybergold-helpers/redeemFacet";
import type { CoreTokenMinimum, SwapFromQuote } from "@/app/types";
import {
  EXPECTED_CHAIN_ID,
  assertWalletOnExpectedChain,
} from "@/app/utils/expectedChain";

export type PermitParams = {
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
};

export type AggregatedRedemptionRequest = {
  grossCygldIn: bigint;
  outputToken: Address;
  recipient: Address;
  minimumAmountOut: bigint;
  expectedCoreOutputs: readonly CoreTokenMinimum[];
};

export type AggregatedNativeRedemptionRequest = Omit<
  AggregatedRedemptionRequest,
  "outputToken"
>;

function encodeLegs(quotes: readonly SwapFromQuote[]) {
  return quotes.map((quote) => ({
    adapter: quote.adapter,
    minimumAmountOut: quote.minimumAmountOut,
    data: quote.data,
  }));
}

export function useRedeemToTokenExactInWithPermit() {
  const { addresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const {
    writeContractAsync,
    data: hash,
    error,
    isPending,
    reset,
  } = useWriteContract();
  const { data: walletClient } = useWalletClient();
  const tx = useWaitForTransactionReceipt({
    hash,
    query: { enabled: !!hash },
  });

  const redeemToTokenExactInWithPermit = (args: {
    request: AggregatedRedemptionRequest;
    permit: PermitParams;
    quotes: readonly SwapFromQuote[];
  }) =>
    assertWalletOnExpectedChain(walletClient).then(() =>
      writeContractAsync({
        chainId: EXPECTED_CHAIN_ID,
        address: requireProtocolAddress(HELPERS_DIAMOND_ADDRESS, "Helpers"),
        abi: HELPERS_ABI_REDEEM_TO_TOKEN,
        functionName: "redeemToTokenExactInWithPermit",
        args: [args.request, args.permit, encodeLegs(args.quotes)],
      })
    );

  const redeemToNativeExactInWithPermit = (args: {
    request: AggregatedNativeRedemptionRequest;
    permit: PermitParams;
    quotes: readonly SwapFromQuote[];
  }) =>
    assertWalletOnExpectedChain(walletClient).then(() =>
      writeContractAsync({
        chainId: EXPECTED_CHAIN_ID,
        address: requireProtocolAddress(HELPERS_DIAMOND_ADDRESS, "Helpers"),
        abi: HELPERS_ABI_REDEEM_TO_TOKEN,
        functionName: "redeemToNativeExactInWithPermit",
        args: [args.request, args.permit, encodeLegs(args.quotes)],
      })
    );

  return {
    redeemToNativeExactInWithPermit,
    redeemToTokenExactInWithPermit,
    hash,
    isPending,
    error,
    reset,
    isConfirming: tx.isLoading,
    isConfirmed: tx.isSuccess,
    receipt: tx.data,
    txError: tx.error,
  };
}
