"use client";

import { useProtocolConfiguration } from "../context/protocolConfigurationContext";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { targetChainId } from "../config/chain";
import { useSandboxForkGeneration } from "../context/sandboxForkContext";
import { fetchGovernanceAuthorityFacts, type AuthoritySurface } from "../utils/governanceAuthorityFacts";

export function useGovernanceAuthorityFacts(surface: AuthoritySurface | undefined,
  options: { account?: Address; enabled?: boolean } = {}) {
  const { addresses } = useProtocolConfiguration();
  const target = surface === "core" ? addresses.core : surface === "staking" ? addresses.staking : surface === "governance-diamond" ? addresses.governance : undefined;
  const generation = useSandboxForkGeneration();
  return useQuery({
    queryKey: ["governance-authority", targetChainId, surface, target, options.account?.toLowerCase(), generation],
    queryFn: ({ signal }) => fetchGovernanceAuthorityFacts(surface!, options.account, signal),
    staleTime: 30_000,
    enabled: Boolean(target) && surface !== undefined && (options.enabled ?? true),
    retry: false,
  });
}
