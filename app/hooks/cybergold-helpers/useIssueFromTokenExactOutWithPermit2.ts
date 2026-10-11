"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useWalletClient, useWriteContract } from "wagmi";
import type { Address } from "viem";

import { HELPERS_ABI_ISSUE_FROM_TOKEN } from "@/app/contracts/cybergold-helpers/issueFacet";
import type { SwapToQuote } from "@/app/types";
import type { CygldPermit } from "../flows/shared/types";
import {
  EXPECTED_CHAIN_ID,
  assertWalletOnExpectedChain,
} from "@/app/utils/expectedChain";

export type IssueFromTokenExactOutParams = {
  inputToken: Address;
  maximumInputAmount: bigint;
  netCygldOut: bigint;
};

export type IssueExecutionParams = {
  recipient: Address;
  expectedOrderedCoreAssets: readonly Address[];
};

export type Permit2Params = {
  permit: {
    permitted: { token: Address; amount: bigint };
    nonce: bigint;
    deadline: bigint;
  };
  signature: `0x${string}`;
};

function encodeLegs(quotes: readonly SwapToQuote[]) {
  return quotes.map((quote) => ({
    adapter: quote.adapter,
    amountIn: quote.amountIn,
    minimumAmountOut: quote.minimumAmountOut,
    data: quote.data,
  }));
}

export function useIssueFromTokenExactOutWithPermit2() {
  const { addresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const { writeContractAsync, ...rest } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const issueFromTokenExactOut = (params: {
    account?: Address;
    helpers?: Address;
    params: IssueFromTokenExactOutParams;
    execution: IssueExecutionParams;
    quotes: readonly SwapToQuote[];
  }) =>
    assertWalletOnExpectedChain(walletClient).then(() =>
      writeContractAsync({
        chainId: EXPECTED_CHAIN_ID,
        account: params.account,
        address: requireProtocolAddress(params.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers"),
        abi: HELPERS_ABI_ISSUE_FROM_TOKEN,
        functionName: "issueFromTokenExactOut",
        args: [params.params, params.execution, encodeLegs(params.quotes)],
      })
    );

  const issueFromTokenExactOutWithPermit2 = (params: {
    account?: Address;
    helpers?: Address;
    params: IssueFromTokenExactOutParams;
    execution: IssueExecutionParams;
    permit: Permit2Params;
    quotes: readonly SwapToQuote[];
  }) =>
    assertWalletOnExpectedChain(walletClient).then(() =>
      writeContractAsync({
        chainId: EXPECTED_CHAIN_ID,
        account: params.account,
        address: requireProtocolAddress(params.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers"),
        abi: HELPERS_ABI_ISSUE_FROM_TOKEN,
        functionName: "issueFromTokenExactOutWithPermit2",
        args: [
          params.params,
          params.execution,
          params.permit,
          encodeLegs(params.quotes),
        ],
      })
    );

  const issueFromTokenExactOutWithPermit = (params: {
    account?: Address;
    helpers?: Address;
    params: IssueFromTokenExactOutParams;
    execution: IssueExecutionParams;
    permit: CygldPermit;
    quotes: readonly SwapToQuote[];
  }) => assertWalletOnExpectedChain(walletClient).then(() => writeContractAsync({
    chainId: EXPECTED_CHAIN_ID,
    account: params.account,
    address: requireProtocolAddress(params.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers"),
    abi: HELPERS_ABI_ISSUE_FROM_TOKEN,
    functionName: "issueFromTokenExactOutWithPermit",
    args: [params.params, params.execution, params.permit, encodeLegs(params.quotes)],
  }));

  const issueFromNativeExactOut = (params: {
    account?: Address;
    helpers?: Address;
    maximumNativeIn: bigint;
    netCygldOut: bigint;
    execution: IssueExecutionParams;
    quotes: readonly SwapToQuote[];
  }) =>
    assertWalletOnExpectedChain(walletClient).then(() =>
      writeContractAsync({
        chainId: EXPECTED_CHAIN_ID,
        account: params.account,
        address: requireProtocolAddress(params.helpers ?? HELPERS_DIAMOND_ADDRESS, "Helpers"),
        abi: HELPERS_ABI_ISSUE_FROM_TOKEN,
        functionName: "issueFromNativeExactOut",
        args: [
          {
            maximumNativeIn: params.maximumNativeIn,
            netCygldOut: params.netCygldOut,
          },
          params.execution,
          encodeLegs(params.quotes),
        ],
        value: params.maximumNativeIn,
      })
    );

  return {
    issueFromNativeExactOut,
    issueFromTokenExactOut,
    issueFromTokenExactOutWithPermit,
    issueFromTokenExactOutWithPermit2,
    writeContractAsync,
    ...rest,
  };
}
