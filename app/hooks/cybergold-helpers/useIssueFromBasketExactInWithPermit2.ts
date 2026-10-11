"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useWalletClient, useWriteContract } from "wagmi";
import { HELPERS_ABI_ISSUE_FROM_BASKET } from "@/app/contracts/cybergold-helpers/issueFacet";
import type { Address } from "viem";
import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import type { PermitBatchTransferFromWithSignature } from "@/app/hooks/flows/shared/types";

export type IssueFromBasketExactInRequest = {
  recipient: Address;
  minimumNetCygldOut: bigint;
};

export function useIssueFromBasketExactInWithPermit2() {
  const { addresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const { writeContractAsync, ...rest } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const issueFromBasketExactInWithPermit2 = (params: {
    request: IssueFromBasketExactInRequest;
    permit: PermitBatchTransferFromWithSignature;
  }) => {
    return assertWalletOnExpectedChain(walletClient).then(() => writeContractAsync({
      chainId: EXPECTED_CHAIN_ID,
      address: requireProtocolAddress(HELPERS_DIAMOND_ADDRESS, "Helpers"),
      abi: HELPERS_ABI_ISSUE_FROM_BASKET,
      functionName: "issueFromBasketExactInWithPermit2",
      args: [params.request, params.permit],
    }));
  };
  return {
    issueFromBasketExactInWithPermit2,
    ...rest,
  };
}
