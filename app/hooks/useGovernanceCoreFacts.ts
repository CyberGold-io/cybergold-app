"use client";

import { useQuery } from "@tanstack/react-query";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { targetChain } from "@/app/config/chain";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { fetchGovernanceCoreFacts, type GovernanceCoreFacts } from "@/app/utils/governanceCoreFacts";

export function useGovernanceCoreFacts<T>(select: (facts: GovernanceCoreFacts) => T,
  options: { enabled?: boolean } = {}) {
  const generation = useSandboxForkGeneration();
  const { addresses } = useProtocolConfiguration();
  return useQuery({
    queryKey: ["governance-core-facts", targetChain.id, addresses.core, generation],
    queryFn: ({ signal }) => fetchGovernanceCoreFacts(signal),
    select,
    staleTime: 30_000,
    enabled: addresses.core !== undefined && (options.enabled ?? true),
    retry: false,
  });
}
