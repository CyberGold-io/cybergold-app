"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";

import { useQuery } from "@tanstack/react-query";

import { targetChain } from "@/app/config/chain";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { attachedRecoveryAssets, fetchCoreRecoveryAssets } from "@/app/utils/coreRecoveryAssets";

export function useCoreRecoveryAssets(enabled: boolean) {
  const { core: CORE_DIAMOND_ADDRESS } = useProtocolConfiguration().addresses;
  const generation = useSandboxForkGeneration();
  return useQuery({
    queryKey: ["core-recovery-assets", targetChain.id, CORE_DIAMOND_ADDRESS, generation],
    queryFn: ({ signal }) => fetchCoreRecoveryAssets(signal),
    select: attachedRecoveryAssets,
    enabled: enabled && Boolean(CORE_DIAMOND_ADDRESS),
    staleTime: Infinity,
  });
}
