"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";

import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { targetChainId } from "@/app/config/chain";
import type { QuoteIntentRequest, QuoteIntentResult } from "@/app/utils/quoteIntent";
import { buildQuoteDeadline } from "@/app/utils/swapPolicy";

/** Skip typing delay only for the existing exact, fresh browser entry. */
export function useCachedQuoteIntent(input: Omit<QuoteIntentRequest, "deadline">, enabled: boolean) {
  const { identity: configurationIdentity } = useProtocolConfiguration();
  const client = useQueryClient(), scope = useQuoteCacheScope(), generation = useSandboxForkGeneration();
  const inputKey = JSON.stringify(input);
  const subscribe = useCallback((changed: () => void) => client.getQueryCache().subscribe(changed), [client]);
  const read = useCallback(() => {
    if (!enabled || !scope) return false;
    const request = { ...JSON.parse(inputKey), deadline: String(buildQuoteDeadline(scope)) };
    const entry = client.getQueryState<QuoteIntentResult>(["quote-intent", targetChainId, generation, scope, request, configurationIdentity]);
    return !!entry?.data && entry.status === "success" && !entry.isInvalidated
      && Date.now() - entry.dataUpdatedAt < 10_000 && Number(request.deadline) > Date.now() / 1000
      && entry.data.context.blockHash.toLowerCase() === scope.split(":").at(-1)?.toLowerCase();
  }, [client, enabled, generation, inputKey, scope, configurationIdentity]);
  return useSyncExternalStore(subscribe, read, () => false);
}
