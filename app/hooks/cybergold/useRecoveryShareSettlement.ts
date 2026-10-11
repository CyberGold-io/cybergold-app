"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { assertObservedAddress, requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useConfig, useWriteContract } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import type { Address } from "viem";
import { simulateRecoveryRedemption } from "@/app/utils/recoveryRedemption";

import { CORE_ABI } from "@/app/contracts/cybergold";
import {
  EXPECTED_CHAIN_ID,
  assertWalletOnExpectedAccount,
  assertWalletOnExpectedChain,
} from "@/app/utils/expectedChain";

export function useRecoveryShareSettlement(expectedHolder?: Address) {
  const { core: CORE_DIAMOND_ADDRESS } = useProtocolConfiguration().addresses;
  const config = useConfig();
  const { writeContractAsync, ...state } = useWriteContract();

  const requireExpectedHolder = async () => {
    if (!expectedHolder) throw new Error("Recovery-share holder is unavailable.");
    // Connection can render before useWalletClient's query resolves. Await
    // the current client at action time, including after the simulation.
    const walletClient = await getWalletClient(config, { chainId: EXPECTED_CHAIN_ID });
    await assertWalletOnExpectedChain(walletClient);
    return assertWalletOnExpectedAccount(walletClient, expectedHolder);
  };

  return {
    ...state,
    redeem: async (params: {
      asset: Address;
      shares: bigint;
      minRawOut: bigint;
    }) => {
      const core = requireProtocolAddress(CORE_DIAMOND_ADDRESS, "Core");
      const account = await requireExpectedHolder();
      // Simulate the exact current-state operation: preview alone cannot prove a
      // frozen/blacklisted token can transfer. Existing amount minima bind consent.
      const observation = await simulateRecoveryRedemption({ holder: account, ...params });
      assertObservedAddress(observation.core, core, "Recovery simulation target");
      await requireExpectedHolder();
      // Build wallet intent from the unchanged local values. The backend
      // observes the call; it supplies no alternate recipient or calldata.
      return writeContractAsync({
        chainId: EXPECTED_CHAIN_ID,
        account,
        address: core,
        abi: CORE_ABI,
        functionName: "redeemRecoveryShares",
        args: [
          params.asset,
          params.shares,
          account,
          params.minRawOut,
        ],
      });
    },
  };
}
