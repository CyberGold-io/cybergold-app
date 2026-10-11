"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { targetChainId } from "../config/chain";
import { useSandboxForkGeneration } from "../context/sandboxForkContext";
import { fetchSafeNonce } from "../utils/safeTransactionFacts";

export function useSafeNonce(address: Address | undefined, enabled: boolean) {
  const generation = useSandboxForkGeneration();
  return useQuery({
    queryKey: ["safe-onchain-nonce", targetChainId, address?.toLowerCase(), generation],
    queryFn: ({ signal }) => fetchSafeNonce(address!, signal),
    enabled: enabled && !!address,
    staleTime: 15_000,
  });
}
