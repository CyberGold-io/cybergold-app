"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { progressiveEconomicQuoteOptions, type EconomicQuote, type EconomicRequest } from "@/app/utils/economicQuotes";
import { createEconomicQuoteSearch, type UpperEstimateDisplayPolicy } from "@/app/utils/economicQuoteSearch";
import { diagnosticReferences, retainDiagnosticReferences } from "@/app/utils/diagnosticReferences";
import { usePageVisible } from "@/app/hooks/usePageVisible";

/** Wallet-free whole quotes; only changed input and explicit Refresh start searches. */
export function useEconomicQuote(request: EconomicRequest, enabled: boolean, upperEstimate?: UpperEstimateDisplayPolicy) {
  const { identity: configuration } = useProtocolConfiguration(), generation = useSandboxForkGeneration();
  const client = useQueryClient(), visible = usePageVisible();
  const options = progressiveEconomicQuoteOptions(request, { chainId: targetChainId, configuration, generation });
  const key = JSON.stringify(options.queryKey), refreshing = useRef(new Set<string>());
  const search = useMemo(() => createEconomicQuoteSearch(client, JSON.parse(key)), [client, key]);
  const accepted = useSyncExternalStore(search.subscribe, search.snapshot, search.snapshot);
  const query = useQuery<EconomicQuote | null>({ ...options, enabled: enabled && visible,
    queryFn: ({ signal }) => search.run(request, signal, refreshing.current.has(key), undefined, upperEstimate) });
  const upperRequestKey = upperEstimate?.requestKey, upperOutput = upperEstimate?.quotedOutput;
  useLayoutEffect(() => {
    // Stop obsolete ownership before a disappearing model could release hidden work.
    if (!enabled || !visible) search.stop();
    else search.setUpperEstimate(upperRequestKey !== undefined && upperOutput !== undefined ?
      { requestKey: upperRequestKey, quotedOutput: upperOutput } : undefined);
  }, [enabled, visible, search, upperRequestKey, upperOutput]);
  useEffect(() => () => search.stop(), [search]);
  const { refetch } = query;
  const refresh = useCallback(async () => {
    refreshing.current.add(key);
    try { return await refetch({ cancelRefetch: false }); }
    finally { refreshing.current.delete(key); }
  }, [key, refetch]);
  const data = accepted.value ?? (!accepted.invalidated ? query.data ?? undefined : undefined);
  const captureReady = useCallback(() => {
    const value = search.current();
    if (!value) return undefined;
    const captured = structuredClone(value); retainDiagnosticReferences(captured, diagnosticReferences(value)); return captured;
  }, [search]);
  return { ...query, data, refresh, captureReady, stopSearch: search.stop,
    isError: !accepted.optimizing && (query.isError || Boolean(accepted.error)),
    invalidated: accepted.invalidated && !data,
    optimizing: accepted.optimizing, refreshError: data ? accepted.error ?? (query.isError ? query.error : undefined) : undefined };
}
