"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { targetChainId } from "../config/chain";
import { useSandboxForkGeneration } from "./sandboxForkContext";
import { emptyProtocolConfiguration, fetchProtocolConfiguration, protocolConfigurationValues,
  type ProtocolConfiguration } from "../utils/protocolConfiguration";
import { usePublicDisplayCache } from "../hooks/usePublicDisplayCache";
import { parseDisplayTokens, projectDisplayTokens, tokenDisplayCacheKey, writePublicDisplayCache } from "../utils/publicDisplayCache";

const initial = { ...emptyProtocolConfiguration, configuration: undefined as ProtocolConfiguration | undefined,
  displayTokens: emptyProtocolConfiguration.tokens,
  error: null as Error | null, isLoading: true, isRefreshing: false, refetch: async (): Promise<unknown> => undefined };
const ProtocolConfigurationContext = createContext(initial);
export const useProtocolConfiguration = () => useContext(ProtocolConfigurationContext);

/** One browser query supplies addresses to every consumer; the shell stays interactive. */
export function ProtocolConfigurationProvider({ children }: { children: ReactNode }) {
  const generation = useSandboxForkGeneration();
  const query = useQuery({
    queryKey: ["protocol-configuration", targetChainId, generation],
    queryFn: ({ signal }) => fetchProtocolConfiguration(targetChainId, signal),
    staleTime: 60_000, retry: false, refetchOnWindowFocus: true,
  });
  const live = useMemo(() => query.data ? protocolConfigurationValues(query.data) : emptyProtocolConfiguration, [query.data]);
  const catalogKey = tokenDisplayCacheKey(targetChainId);
  const cachedTokens = usePublicDisplayCache(catalogKey, parseDisplayTokens);
  useEffect(() => {
    if (query.data) writePublicDisplayCache(catalogKey, projectDisplayTokens(live.tokens));
  }, [catalogKey, query.data, live.tokens]);
  const value = useMemo(() => ({ ...live, displayTokens: query.data ? live.tokens : cachedTokens ?? [],
    configuration: query.data, error: query.error, isLoading: query.isLoading, isRefreshing: query.isFetching, refetch: query.refetch }),
    [live, cachedTokens, query.data, query.error, query.isLoading, query.isFetching, query.refetch]);
  return <ProtocolConfigurationContext.Provider value={value}>{children}</ProtocolConfigurationContext.Provider>;
}
