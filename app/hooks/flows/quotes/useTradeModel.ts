"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { usePageVisible } from "@/app/hooks/usePageVisible";
import { fetchTradeModel, receiveTradeModel, type TradeModelRequest } from "@/app/utils/tradeQuote";

export function useTradeModel(input: TradeModelRequest, enabled: boolean) {
  const { identity } = useProtocolConfiguration(), generation = useSandboxForkGeneration();
  const scope = useQuoteCacheScope(), visible = usePageVisible();
  const client = useQueryClient(), key = JSON.stringify(["trade-model", targetChainId, generation, scope, input, identity]);
  const query = useQuery({ queryKey: ["trade-model", targetChainId, generation, scope, input, identity],
    enabled: enabled && visible && Boolean(input.counterToken), retry: false, staleTime: 10_000,
    queryFn: ({ signal }) => fetchTradeModel(input, signal) });
  useEffect(() => { if (query.data) receiveTradeModel(query.data, identity); }, [query.data, identity]);
  useEffect(() => {
    if (!enabled || !visible) void client.cancelQueries({ queryKey: JSON.parse(key), exact: true });
  }, [client, enabled, visible, key]);
  return enabled && query.data?.estimate ? BigInt(query.data.estimate.amount) : undefined;
}
