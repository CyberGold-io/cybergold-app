"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { targetChainId } from "@/app/config/chain";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { usePageVisible } from "@/app/hooks/usePageVisible";
import { buildQuoteDeadline } from "@/app/utils/swapPolicy";
import { quoteErrorMessage } from "@/app/utils/quoteErrors";
import { fetchMarketQuote, marketModelFamily, marketQuoteResult, preferMarketQuote,
  type MarketQuoteRequest, type MarketQuoteResult } from "@/app/utils/marketQuote";
import { getMarketQuoteModel, receiveMarketQuoteModel, subscribeQuoteModels } from "@/app/utils/quoteModelStore";
import { useBoundQuoteState } from "./useBoundQuoteState";

const emptyModel = () => undefined;
export function useMarketQuote(input: Omit<MarketQuoteRequest, "adapter" | "deadline" | "retainedPlan">, enabled: boolean) {
  const { addresses, identity: configurationIdentity } = useProtocolConfiguration();
  const t = useTranslations("Home"), client = useQueryClient();
  const generation = useSandboxForkGeneration(), observedScope = useQuoteCacheScope();
  const visible = usePageVisible(), canFetch = visible && enabled && Boolean(addresses.core && addresses.helpers);
  const inputKey = JSON.stringify(input), identity = JSON.stringify([generation, configurationIdentity, inputKey, enabled]);
  const attemptSequence = useRef(0);
  const [deadlineRevision, renewDeadline] = useState(0);
  const [accepted, accept] = useState<{ identity: string; attempt: number; deadline: number; value: MarketQuoteResult }>();
  const [binding, bindScope] = useBoundQuoteState<{ scope: string | undefined }>([generation, configurationIdentity, inputKey, enabled]);
  const scope = binding ? binding.scope : observedScope;
  const request: MarketQuoteRequest = useMemo(() => {
    void deadlineRevision; void visible;
    return { ...JSON.parse(inputKey), adapter: addresses.adapter,
      deadline: String(buildQuoteDeadline(scope)) };
  }, [inputKey, scope, deadlineRevision, visible, addresses.adapter]);
  const family = marketModelFamily({ ...request, adapter: request.adapter ?? (accepted?.identity === identity ? accepted.value.params.adapter : undefined) });
  const model = useSyncExternalStore(subscribeQuoteModels, () => getMarketQuoteModel(family, configurationIdentity), emptyModel);
  const [estimate, publishEstimate] = useBoundQuoteState<bigint>([generation, configurationIdentity, scope, inputKey]);
  const [progress, publishProgress] = useBoundQuoteState<{ completed: number; total?: number }>([scope, request]);
  const publishQualified = useCallback((value: MarketQuoteResult, attempt: number) => {
    if (attemptSequence.current !== attempt) return;
    value = { ...value, deployment: { core: addresses.core, helpers: addresses.helpers, adapter: value.params.adapter } };
    accept(previous => {
      if (previous && previous.attempt > attempt) return previous;
      const current = previous?.identity === identity && previous.deadline > Date.now() / 1000 ? previous : undefined;
      const chosen = preferMarketQuote(current?.value, value);
      return chosen === current?.value ? current : { identity, attempt, deadline: Number(request.deadline), value: chosen };
    });
  }, [identity, request.deadline, addresses]);
  const query = useQuery({
    queryKey: ["market-quote", targetChainId, generation, scope, request, configurationIdentity], enabled: canFetch, retry: false,
    staleTime: query => query.state.data?.value.context.blockHash.toLowerCase() === scope?.split(":").at(-1)?.toLowerCase() ? 10_000 : 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const attempt = ++attemptSequence.current;
      const submitted = accepted?.identity === identity && accepted.deadline > Date.now() / 1000
        ? { ...request, retainedPlan: accepted.value.value.plan } : request;
      return fetchMarketQuote(submitted, signal, event => {
        if (signal.aborted || attemptSequence.current !== attempt) return;
        if (event.type === "model") receiveMarketQuoteModel(event.value, configurationIdentity);
        if (event.type === "qualified") publishQualified(marketQuoteResult(event.value), attempt);
        if (event.type === "invalidated") accept(previous => previous?.identity === identity ? undefined : previous);
        if (event.type === "estimate") publishEstimate(BigInt(event.amount));
        if (event.type === "progress") publishProgress({ completed: event.completedCandidates, total: event.totalCandidates });
      }).then(result => {
        if (!signal.aborted) publishQualified(result, attempt);
        publishEstimate(input.mode === "exact-in" ? result.netOutput : result.totalInput);
        return { ...result, deployment: { core: addresses.core, helpers: addresses.helpers, adapter: result.params.adapter } };
      });
    },
  });
  if (enabled && query.isSuccess && !query.isFetching && query.data && accepted?.identity !== identity)
    accept({ identity, attempt: 0, deadline: Number(request.deadline), value: query.data });
  const incumbent = accepted?.identity === identity ? accepted : undefined;
  useEffect(() => {
    if (!visible || !incumbent) return;
    const timer = setTimeout(() => {
      accept(previous => previous === incumbent ? undefined : previous);
      renewDeadline(revision => revision + 1);
    }, Math.max(0, incumbent.deadline * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [incumbent, visible]);
  const fetching = useRef(false);
  useEffect(() => { fetching.current = canFetch && query.isFetching; }, [canFetch, query.isFetching]);
  useEffect(() => {
    if (!binding || (!fetching.current && binding.scope !== observedScope)) bindScope({ scope: observedScope });
  }, [observedScope, binding, bindScope]);
  const queryKey = JSON.stringify(["market-quote", targetChainId, generation, scope, request, configurationIdentity]);
  useEffect(() => {
    if (!canFetch) void client.cancelQueries({ queryKey: JSON.parse(queryKey), exact: true });
  }, [client, canFetch, queryKey]);
  return { data: enabled ? incumbent?.value ?? (!query.isError && !query.isFetching ? query.data : undefined) : undefined,
    estimate: enabled && !query.isError ? estimate : undefined, model,
    error: query.isError && !incumbent ? quoteErrorMessage(query.error, t) : undefined,
    loading: enabled && !incumbent && query.isFetching, optimizing: enabled && !!incumbent && query.isFetching,
    progress: enabled ? progress : undefined, refresh: query.refetch };
}
