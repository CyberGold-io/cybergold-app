"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { targetChainId } from "../config/chain";
import { useSandboxForkGeneration } from "../context/sandboxForkContext";
import { fetchGovernanceSafePrincipal, type GovernanceSafePrincipal } from "../utils/governanceSafePrincipal";

export function safePrincipalQueryOptions(address: Address | undefined, generation: string | null | undefined) {
  return {
    queryKey: ["governance-safe-principal", targetChainId, address?.toLowerCase(), generation],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchGovernanceSafePrincipal(address!, signal),
    retry: false as const,
  };
}

export function useGovernanceSafePrincipal<T>(address: Address | undefined,
  select: (facts: GovernanceSafePrincipal) => T, options: { enabled?: boolean } = {}) {
  const generation = useSandboxForkGeneration();
  return useQuery({
    ...safePrincipalQueryOptions(address, generation), select, staleTime: 30_000,
    enabled: (options.enabled ?? true) && address !== undefined,
  });
}
