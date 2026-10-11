"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { usePageVisible } from "@/app/hooks/usePageVisible";
import { marketModelFamily, type MarketModelRequest } from "@/app/utils/marketQuote";
import { fetchMarketModel, predictMarketModel } from "@/app/utils/marketModels";
import { getMarketQuoteModel, receiveMarketQuoteModel, subscribeQuoteModels } from "@/app/utils/quoteModelStore";

const empty = () => undefined;
/** Activation acquires a baseline without an amount, wallet or previous quote. */
export function useMarketModel(input: MarketModelRequest, amount: bigint) {
  const { identity } = useProtocolConfiguration();
  const family = marketModelFamily(input), generation = useSandboxForkGeneration();
  const scope = useQuoteCacheScope(), visible = usePageVisible();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["market-model", targetChainId, generation, scope, family, identity], enabled: visible && Boolean(input.counterToken),
    queryFn: ({ signal }) => fetchMarketModel(input, signal), retry: false, staleTime: 10_000 });
  const resolvedFamily = query.data?.family ?? family;
  const retained = useSyncExternalStore(subscribeQuoteModels, () => getMarketQuoteModel(resolvedFamily, identity), empty);
  useEffect(() => { if (query.data) receiveMarketQuoteModel(query.data, identity); }, [query.data, identity]);
  useEffect(() => {
    if (!visible) void client.cancelQueries({ queryKey: ["market-model", targetChainId, generation, scope, family, identity], exact: true });
  }, [client, visible, generation, scope, family, identity]);
  return retained ? predictMarketModel(retained, amount) : undefined;
}
