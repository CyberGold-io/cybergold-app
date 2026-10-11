"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, WalletClient } from "viem";
import { targetChainId } from "../config/chain";
import { useSandboxForkGeneration } from "../context/sandboxForkContext";
import { walletAtomicStatus } from "../utils/walletBatch";

export function useWalletAtomicStatus(client: WalletClient | undefined, owner: Address | undefined) {
  const generation = useSandboxForkGeneration();
  return useQuery({ queryKey: ["wallet-atomic-status", targetChainId, owner, client?.uid, generation],
    enabled: Boolean(client && owner), staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
    queryFn: async () => {
      const status = await walletAtomicStatus(client!, owner!, targetChainId);
      if (process.env.NODE_ENV === "development") console.info("[wallet-batch]", { chainId: targetChainId, atomic: status });
      return status;
    },
  });
}
