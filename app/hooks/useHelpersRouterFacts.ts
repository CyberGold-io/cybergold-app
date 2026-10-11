"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";

import { useQuery } from "@tanstack/react-query";
import { targetChainId } from "../config/chain";

import { useSandboxForkGeneration } from "../context/sandboxForkContext";
import { fetchHelpersRouterFacts, type HelpersRouterFacts } from "../utils/helpersRouterFacts";

export function useHelpersRouterFacts<T>(select: (facts: HelpersRouterFacts) => T,
  options: { enabled?: boolean; staleTime?: number } = {}) {
  const { helpers: HELPERS_DIAMOND_ADDRESS } = useProtocolConfiguration().addresses;
  const generation = useSandboxForkGeneration();
  return useQuery({
    queryKey: ["helpers-router-facts", targetChainId, HELPERS_DIAMOND_ADDRESS, generation],
    queryFn: ({ signal }) => fetchHelpersRouterFacts(signal),
    select,
    staleTime: options.staleTime ?? 30_000,
    enabled: Boolean(HELPERS_DIAMOND_ADDRESS) && options.enabled !== false,
    retry: false,
  });
}
