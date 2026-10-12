"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { buildQuoteDeadline } from "@/app/utils/swapPolicy";
import type { TradeQuoteRequest, TradeQuoteResult } from "@/app/utils/tradeQuote";

export function useCachedTradeQuote(input: Omit<TradeQuoteRequest, "deadline" | "retainedPlan">, enabled: boolean) {
  const client = useQueryClient(), scope = useQuoteCacheScope(), generation = useSandboxForkGeneration();
  const { identity } = useProtocolConfiguration(), inputKey = JSON.stringify(input);
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe(changed), [client]);
  const read = useCallback(() => {
    if (!enabled || !scope) return false;
    const request = { ...JSON.parse(inputKey), deadline: String(buildQuoteDeadline(scope)) };
    const entry = client.getQueryState<TradeQuoteResult>(["trade-quote", targetChainId, generation, scope, request, identity]);
    return Boolean(entry?.data && entry.status === "success" && !entry.isInvalidated
      && Date.now() - entry.dataUpdatedAt < 10_000 && Number(request.deadline) > Date.now() / 1000
      && entry.data.value.context.blockHash.toLowerCase() === scope.split(":").at(-1)?.toLowerCase());
  }, [client, enabled, generation, inputKey, scope, identity]);
  return useSyncExternalStore(subscribe, read, () => false);
}
