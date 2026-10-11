import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";
import { useWalletClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Address, Hex } from "viem";
import { HELPERS_ABI_REDEEM } from "@/app/contracts/cybergold-helpers/redeemFacet";
import { EXPECTED_CHAIN_ID, assertWalletOnExpectedChain } from "@/app/utils/expectedChain";

import type { CoreTokenMinimum } from "@/app/types";

export type RedeemToBasketExactInWithPermitArgs = {
  request: {
    grossCygldIn: bigint;
    recipient: Address;
    expectedCoreOutputs: readonly CoreTokenMinimum[];
  };

  permit: {
    value: bigint;
    deadline: bigint;
    v: number; // uint8
    r: Hex;    // bytes32
    s: Hex;    // bytes32
  };
};

export function useRedeemToBasketExactInWithPermit() {
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

  const redeemToBasketExactInWithPermit = (args: RedeemToBasketExactInWithPermitArgs) => {
    const { request, permit } = args;

    return assertWalletOnExpectedChain(walletClient).then(() => writeContractAsync({
      chainId: EXPECTED_CHAIN_ID,
      address: requireProtocolAddress(HELPERS_DIAMOND_ADDRESS, "Helpers"),
      abi: HELPERS_ABI_REDEEM,
      functionName: "redeemToBasketExactInWithPermit",
      args: [
        request,
        {
          value: permit.value,
          deadline: permit.deadline,
          v: permit.v,
          r: permit.r,
          s: permit.s,
        },
      ] as const,
    }));
  };

  return {
    redeemToBasketExactInWithPermit,

    // write state
    hash,
    isPending,
    error,
    reset,

    // receipt state
    isConfirming: tx.isLoading,
    isConfirmed: tx.isSuccess,
    receipt: tx.data,
    txError: tx.error,
  };
}
