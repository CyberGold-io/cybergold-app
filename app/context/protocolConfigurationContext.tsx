"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { targetChainId } from "../config/chain";
import { useSandboxForkGeneration } from "./sandboxForkContext";
import { emptyProtocolConfiguration, fetchProtocolConfiguration, protocolConfigurationValues,
  type ProtocolConfiguration } from "../utils/protocolConfiguration";

const initial = { ...emptyProtocolConfiguration, configuration: undefined as ProtocolConfiguration | undefined,
  error: null as Error | null, isLoading: true, refetch: async (): Promise<unknown> => undefined };
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
  const value = useMemo(() => ({ ...(query.data ? protocolConfigurationValues(query.data) : emptyProtocolConfiguration),
    configuration: query.data, error: query.error, isLoading: query.isLoading, refetch: query.refetch }),
    [query.data, query.error, query.isLoading, query.refetch]);
  return <ProtocolConfigurationContext.Provider value={value}>{children}</ProtocolConfigurationContext.Provider>;
}
