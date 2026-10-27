"use client";
import { useCallback, useSyncExternalStore } from "react";
import { notifyManager, useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { buildQuoteDeadline } from "@/app/utils/swapPolicy";
import type { TradeQuoteRequest, TradeQuoteResult } from "@/app/utils/tradeQuote";
import { economicQuoteKey, type EconomicQuote } from "@/app/utils/economicQuotes";
import { zeroAddress } from "viem";

export function useCachedTradeQuote(input: Omit<TradeQuoteRequest, "deadline" | "retainedPlan">, enabled: boolean) {
  const client = useQueryClient(), scope = useQuoteCacheScope(), generation = useSandboxForkGeneration();
  const { identity, addresses } = useProtocolConfiguration(), inputKey = JSON.stringify(input);
  const subscribe = useCallback((changed: () => void) => {
    const notify = notifyManager.batchCalls(changed);
    return client.getQueryCache().subscribe(event => {
      if (["trade-quote", "economic-quote"].includes(String(event.query.queryKey[0]))) notify();
    });
  }, [client]);
  const read = useCallback(() => {
    if (!enabled) return false;
    const captured: Omit<TradeQuoteRequest, "deadline" | "retainedPlan"> = JSON.parse(inputKey);
    if (captured.mode === "exact-in") {
      const counter = captured.native ? zeroAddress : captured.counterToken;
      const key = economicQuoteKey({ intent: captured.side === "buy" ? 0 : 1,
        inputs: [{ currency: captured.side === "buy" ? counter : addresses.core ?? zeroAddress, amount: captured.amount }],
        outputCurrency: captured.side === "buy" ? addresses.core ?? zeroAddress : counter },
        { chainId: targetChainId, configuration: identity, generation });
      return Boolean(client.getQueryData<EconomicQuote>(key));
    }
    if (!scope) return false;
    const request = { ...JSON.parse(inputKey), deadline: String(buildQuoteDeadline(scope)) };
    const entry = client.getQueryState<TradeQuoteResult>(["trade-quote", targetChainId, generation, scope, request, identity]);
    return Boolean(entry?.data && entry.status === "success" && !entry.isInvalidated
      && Date.now() - entry.dataUpdatedAt < 10_000 && Number(request.deadline) > Date.now() / 1000
      && entry.data.value.context.blockHash.toLowerCase() === scope.split(":").at(-1)?.toLowerCase());
  }, [client, enabled, generation, inputKey, scope, identity, addresses.core]);
  return useSyncExternalStore(subscribe, read, () => false);
}
