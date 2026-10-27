"use client";

import { useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { economicQuoteOptions, fetchEconomicQuote, type EconomicRequest } from "@/app/utils/economicQuotes";

/** Wallet-free whole quotes; only changed input and explicit Refresh start searches. */
export function useEconomicQuote(request: EconomicRequest, enabled: boolean) {
  const { identity: configuration } = useProtocolConfiguration(), generation = useSandboxForkGeneration();
  const options = economicQuoteOptions(request, { chainId: targetChainId, configuration, generation });
  const key = JSON.stringify(options.queryKey), refreshing = useRef(new Set<string>());
  const query = useQuery({ ...options, enabled,
    queryFn: ({ signal }) => fetchEconomicQuote(request, signal, refreshing.current.has(key)) });
  const { refetch } = query;
  const refresh = useCallback(async () => {
    refreshing.current.add(key);
    try { return await refetch({ cancelRefetch: false }); }
    finally { refreshing.current.delete(key); }
  }, [key, refetch]);
  return { ...query, refresh, refreshError: query.data && query.isError ? query.error : undefined };
}
