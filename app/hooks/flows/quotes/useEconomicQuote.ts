"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { economicQuoteKey, economicQuoteOptions, type EconomicRequest } from "@/app/utils/economicQuotes";
import { createEconomicQuoteSearch } from "@/app/utils/economicQuoteSearch";
import { diagnosticReferences, retainDiagnosticReferences } from "@/app/utils/diagnosticReferences";
import { usePageVisible } from "@/app/hooks/usePageVisible";

/** Display the Backend-selected stream and retain only this request owner's tuple. */
export function useEconomicQuote(request: EconomicRequest, enabled: boolean) {
  const { identity: configuration } = useProtocolConfiguration(), generation = useSandboxForkGeneration();
  const client = useQueryClient(), visible = usePageVisible();
  const scope = { chainId: targetChainId, configuration, generation };
  const key = JSON.stringify(economicQuoteKey(request, scope)), refreshing = useRef(new Map<string, symbol>());
  const search = useMemo(() => createEconomicQuoteSearch(client, JSON.parse(key)), [client, key]);
  const accepted = useSyncExternalStore(search.subscribe, search.snapshot, search.snapshot);
  const options = economicQuoteOptions(request, scope);
  const query = useQuery<null>({ ...options, staleTime: accepted.settled ? Infinity : 0, enabled: enabled && visible && !accepted.stopped,
    queryFn: async ({ signal }) => { await search.run(request, signal, refreshing.current.has(key)); return null; } });
  useLayoutEffect(() => {
    // Stop obsolete ownership before a late frame can replace another input.
    if (!enabled || !visible) search.stop();
  }, [enabled, visible, search]);
  useEffect(() => () => search.stop(), [search]);
  const { refetch } = query;
  const refresh = useCallback(async () => {
    const token = Symbol();
    refreshing.current.set(key, token);
    search.stop();
    try { return await refetch({ cancelRefetch: true }); }
    finally { if (refreshing.current.get(key) === token) refreshing.current.delete(key); }
  }, [key, refetch, search]);
  const data = accepted.value;
  const captureReady = useCallback(() => {
    const value = search.current();
    if (!value) return undefined;
    const captured = structuredClone(value); retainDiagnosticReferences(captured, diagnosticReferences(value)); return captured;
  }, [search]);
  // Submission owns its stop even when preparation later unfreezes this key.
  const stopSearch = useCallback(() => search.stop(true), [search]);
  return { ...query, data, refresh, captureReady, stopSearch,
    isError: !accepted.optimizing && (query.isError || Boolean(accepted.error)),
    invalidated: accepted.invalidated && !data,
    optimizing: accepted.optimizing, historical: accepted.historical,
    refreshError: data ? accepted.error ?? (query.isError ? query.error : undefined) : undefined };
}
