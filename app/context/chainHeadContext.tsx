"use client";

import { useProtocolConfiguration } from "./protocolConfigurationContext";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useSandboxForkGeneration } from "./sandboxForkContext";
import { getHeadWatcher, HEAD_REFRESH_QUERIES } from "@/app/utils/chainHead";
import { clearQuoteModels } from "@/app/utils/quoteModelStore";
import { clearRouteObservations } from "@/app/utils/routeSearch";
import type { ProtocolFacts } from "@/app/utils/protocolFacts";

const ChainHeadContext = createContext<string | undefined>(undefined);
export const useChainHeadHash = () => useContext(ChainHeadContext);
export function useQuoteCacheScope() {
  const hash = useChainHeadHash();
  const generation = useSandboxForkGeneration();
  return hash ? `${targetChainId}:${generation ?? ""}:${hash}` : undefined;
}

export function ChainHeadBoundary({ children }: { children: ReactNode }) {
  const { addresses, identity } = useProtocolConfiguration();
  const client = useQueryClient();
  const generation = useSandboxForkGeneration();
  const [hash, setHash] = useState<string>();
  useEffect(() => {
    clearRouteObservations();
    clearQuoteModels();
    let watched = false;
    const bootstrap = () => {
      if (watched) return;
      const facts = client.getQueriesData<ProtocolFacts>({ queryKey: ["protocol-facts", targetChainId] })
        .find(([key, value]) => key[4] === identity && value?.core?.toLowerCase() === addresses.core?.toLowerCase() && value?.helpers?.toLowerCase() === addresses.helpers?.toLowerCase())?.[1];
      // Facts already carry a canonical context. Use it while the first head
      // read is pending so its arrival at the same hash preserves the query key.
      if (facts) setHash(facts.context.blockHash);
    };
    bootstrap();
    const unsubscribeFacts = client.getQueryCache().subscribe(event => {
      if (event.type === "updated" && event.query.queryKey[0] === "protocol-facts") bootstrap();
    });
    const unsubscribeHead = getHeadWatcher(targetChainId).subscribe((head, previous) => {
      watched = true;
      setHash(head.blockHash);
      const factsAtAnotherHead = client.getQueriesData<ProtocolFacts>({ queryKey: ["protocol-facts", targetChainId] })
        .some(([key, facts]) => facts && key[4] === identity && facts?.core?.toLowerCase() === addresses.core?.toLowerCase() && facts?.helpers?.toLowerCase() === addresses.helpers?.toLowerCase() && facts.context.blockHash !== head.blockHash);
      // The first successful head after an outage may follow already-loaded
      // facts. Their observed context establishes whether refresh is needed.
      if ((previous && previous.blockHash !== head.blockHash) || factsAtAnotherHead) {
        clearRouteObservations();
        void client.invalidateQueries({ predicate: query => HEAD_REFRESH_QUERIES.includes(String(query.queryKey[0]))
          || (query.queryKey[0] === "protocol-configuration" && query.isStale()) });
      }
    });
    return () => { unsubscribeFacts(); unsubscribeHead(); };
  }, [client, generation, identity, addresses.core, addresses.helpers]);
  return <ChainHeadContext.Provider value={hash}>{children}</ChainHeadContext.Provider>;
}
