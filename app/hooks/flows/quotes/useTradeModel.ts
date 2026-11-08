"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { usePageVisible } from "@/app/hooks/usePageVisible";
import { fetchTradeModel, receiveTradeModel, type TradeModelRequest } from "@/app/utils/tradeQuote";
import { getTradeBudgetRange, subscribeQuoteModels, tradeDisplayModelScope } from "@/app/utils/quoteModelStore";

type TradeDisplayEstimate = {
  quotedOutput: bigint; quotedInput?: bigint; inputMaximum?: bigint; fullBudget?: true;
  basis?: string;
  fees?: { protocolFeeCygld: bigint; helperFeeCygld: bigint; marketFeeCygld: bigint };
};

export function useTradeModel(input: TradeModelRequest, enabled: boolean): TradeDisplayEstimate | undefined {
  const { identity } = useProtocolConfiguration(), generation = useSandboxForkGeneration();
  const scope = useQuoteCacheScope(), visible = usePageVisible();
  const modelScope = input.mode === "exact-in" ? undefined : scope;
  const displayScope = tradeDisplayModelScope(identity, generation), inputKey = JSON.stringify(input);
  const readRange = useCallback(() => enabled ? getTradeBudgetRange(JSON.parse(inputKey), displayScope) : undefined,
    [enabled, inputKey, displayScope]);
  const range = useSyncExternalStore(subscribeQuoteModels, readRange, () => undefined);
  const client = useQueryClient(), key = JSON.stringify(["trade-model", targetChainId, generation, modelScope, input, identity]);
  const query = useQuery({ queryKey: ["trade-model", targetChainId, generation, modelScope, input, identity],
    enabled: enabled && visible && Boolean(input.counterToken), retry: false, staleTime: 10_000,
    queryFn: ({ signal }) => fetchTradeModel(input, signal) });
  useEffect(() => { if (query.data) receiveTradeModel(query.data, identity, displayScope); }, [query.data, identity, displayScope]);
  useEffect(() => {
    if (!enabled || !visible) void client.cancelQueries({ queryKey: JSON.parse(key), exact: true });
  }, [client, enabled, visible, key]);
  if (!enabled) return undefined;
  const estimate = query.data?.estimate;
  if (estimate?.strategy === "universal") {
    return { quotedOutput: BigInt(estimate.amount), basis: estimate.basis, fullBudget: estimate.fullBudget,
      fees: { protocolFeeCygld: BigInt(estimate.fees.coreProtocolFeeCygld),
        helperFeeCygld: BigInt(estimate.fees.coreHelpersFeeCygld), marketFeeCygld: BigInt(estimate.fees.marketFeeCygld) } };
  }
  if (range) return { quotedInput: BigInt(range.quotedInput), quotedOutput: BigInt(range.quotedOutput),
    inputMaximum: BigInt(range.minimumBudget) };
  return estimate ? { quotedOutput: BigInt(estimate.amount) } : undefined;
}
