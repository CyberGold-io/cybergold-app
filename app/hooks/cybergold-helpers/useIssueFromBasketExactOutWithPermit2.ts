"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import type { Address } from "viem";
import { useWalletClient, useWriteContract } from "wagmi";
import { HELPERS_ABI_ISSUE_FROM_BASKET } from "@/app/contracts/cybergold-helpers/issueFacet";
import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";
import type { PermitBatchTransferFromWithSignature } from "@/app/hooks/flows/shared/types";

export type IssueFromBasketExactOutRequest = {
  netCygldOut: bigint;
  recipient: Address;
};

export function useIssueFromBasketExactOutWithPermit2() {
  const { addresses } = useProtocolConfiguration();
  const HELPERS_DIAMOND_ADDRESS = addresses.helpers;
  const { writeContractAsync, ...rest } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const issueFromBasketExactOutWithPermit2 = (params: {
    request: IssueFromBasketExactOutRequest;
    permit: PermitBatchTransferFromWithSignature;
  }) => {
    return assertWalletOnExpectedChain(walletClient).then(() => writeContractAsync({
      chainId: EXPECTED_CHAIN_ID,
      address: requireProtocolAddress(HELPERS_DIAMOND_ADDRESS, "Helpers"),
      abi: HELPERS_ABI_ISSUE_FROM_BASKET,
      functionName: "issueFromBasketExactOutWithPermit2",
      args: [params.request, params.permit],
    }));
  };
   return {
    issueFromBasketExactOutWithPermit2,
    ...rest,
  };
}
