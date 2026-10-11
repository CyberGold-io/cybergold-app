"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";


import { fetchProtocolFacts, type FactRead, type ProtocolFacts } from "@/app/utils/protocolFacts";
import { targetChain } from "@/app/config/chain";

export function useProtocolFacts(options: { retry?: number } = {}) {
  const { addresses: { core: CORE_DIAMOND_ADDRESS, helpers: HELPERS_DIAMOND_ADDRESS }, identity } = useProtocolConfiguration();
  return useQuery({
    queryKey: ["protocol-facts", targetChain.id, CORE_DIAMOND_ADDRESS, HELPERS_DIAMOND_ADDRESS, identity],
    queryFn: ({ signal }) => fetchProtocolFacts(signal, fetch, identity),
    enabled: Boolean(CORE_DIAMOND_ADDRESS),
    staleTime: Infinity,
    retry: options.retry ?? 1,
  });
}

export function useProtocolFact<T>(select: (facts: ProtocolFacts) => FactRead<T>,
  options: { retry?: number } = {}) {
  const query = useProtocolFacts(options);
  const read = query.data ? select(query.data) : undefined;
  const fieldError = useMemo(() => read?.status === "failure" ? new Error("Protocol contract read unavailable.") : null, [read]);
  return { ...query, data: read?.status === "success" ? read.value : undefined,
    error: query.error ?? fieldError, isError: query.isError || fieldError !== null,
    isSuccess: query.isSuccess && fieldError === null };
}
