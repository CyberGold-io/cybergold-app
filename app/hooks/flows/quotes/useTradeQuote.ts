"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { targetChainId } from "@/app/config/chain";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { usePageVisible } from "@/app/hooks/usePageVisible";
import { buildQuoteDeadline } from "@/app/utils/swapPolicy";
import { QuotePreviewError, quoteErrorMessage } from "@/app/utils/quoteErrors";
import { fetchTradeQuote, receiveTradeModel, tradeAdapter, tradeQuoteResult,
  type TradeQuoteRequest, type TradeQuoteResult } from "@/app/utils/tradeQuote";
import { useBoundQuoteState } from "./useBoundQuoteState";

export function useTradeQuote(input: Omit<TradeQuoteRequest, "deadline" | "retainedPlan">, enabled: boolean) {
  const { addresses, identity: configurationIdentity } = useProtocolConfiguration();
  const t = useTranslations("Home"), client = useQueryClient(), visible = usePageVisible();
  const generation = useSandboxForkGeneration(), observedScope = useQuoteCacheScope();
  const canFetch = enabled && visible && Boolean(addresses.core && addresses.helpers);
  const inputKey = JSON.stringify(input), identity = JSON.stringify([generation, configurationIdentity, inputKey, enabled]);
  const sequence = useRef(0), fetching = useRef(false);
  const [deadlineRevision, renewDeadline] = useState(0);
  const [accepted, accept] = useState<{ identity: string; attempt: number; deadline: number; value: TradeQuoteResult }>();
  const [binding, bindScope] = useBoundQuoteState<{ scope: string | undefined }>([generation, configurationIdentity, inputKey, enabled]);
  const scope = binding ? binding.scope : observedScope;
  const request: TradeQuoteRequest = useMemo(() => {
    void deadlineRevision; void visible;
    return { ...JSON.parse(inputKey), deadline: String(buildQuoteDeadline(scope)) };
  }, [inputKey, scope, deadlineRevision, visible]);
  const [estimate, publishEstimate] = useBoundQuoteState<bigint>([generation, configurationIdentity, scope, inputKey]);
  const [progress, publishProgress] = useBoundQuoteState<{ completed: number; total: number }>([scope, request]);
  const publishQualified = useCallback((value: TradeQuoteResult, attempt: number) => {
    if (sequence.current !== attempt) return;
    value = { ...value, deployment: { core: addresses.core, helpers: addresses.helpers, adapter: tradeAdapter(value.value) } };
    // The Backend compares economics. The App replaces the entire selected tuple together.
    accept(previous => previous && previous.attempt > attempt ? previous
      : { identity, attempt, deadline: Number(request.deadline), value });
  }, [identity, request.deadline, addresses]);
  const query = useQuery({
    queryKey: ["trade-quote", targetChainId, generation, scope, request, configurationIdentity], enabled: canFetch, retry: false,
    staleTime: query => query.state.data?.value.context.blockHash.toLowerCase() === scope?.split(":").at(-1)?.toLowerCase() ? 10_000 : 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const attempt = ++sequence.current, stages = new Map<string, { completed: number; total: number }>();
      // Ordinary head refresh competes again; explicit retained-plan revalidation is a separate operation.
      return fetchTradeQuote(request, signal, event => {
        if (signal.aborted || sequence.current !== attempt) return;
        if (event.type === "model") receiveTradeModel(event.value, configurationIdentity);
        if (event.type === "qualified") publishQualified(tradeQuoteResult(event.value), attempt);
        if (event.type === "invalidated") accept(previous => previous?.identity === identity
          && previous.value.value.strategy === event.strategy ? undefined : previous);
        if (event.type === "estimate") publishEstimate(BigInt(event.amount));
        if (event.type === "progress") {
          const value = event.value;
          const completed = "completed" in value ? value.completed ?? 0 : value.completedCandidates ?? 0;
          const total = "total" in value ? value.total ?? completed + 1 : value.totalCandidates ?? completed + 1;
          stages.set(event.strategy + ("stage" in value ? value.stage : ""), { completed, total });
          const rows = [...stages.values()];
          publishProgress({ completed: rows.reduce((sum, row) => sum + row.completed, 0),
            total: rows.reduce((sum, row) => sum + row.total, 0) + 1 });
        }
      }).then(result => {
        if (!signal.aborted) publishQualified(result, attempt);
        return { ...result, deployment: { core: addresses.core, helpers: addresses.helpers, adapter: tradeAdapter(result.value) } };
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
  useEffect(() => { fetching.current = canFetch && query.isFetching; }, [canFetch, query.isFetching]);
  useEffect(() => {
    if (!binding || (!fetching.current && binding.scope !== observedScope)) bindScope({ scope: observedScope });
  }, [observedScope, binding, bindScope]);
  const key = JSON.stringify(["trade-quote", targetChainId, generation, scope, request, configurationIdentity]);
  useEffect(() => {
    if (!canFetch) void client.cancelQueries({ queryKey: JSON.parse(key), exact: true });
  }, [client, canFetch, key]);
  return { data: enabled ? incumbent?.value ?? (!query.isError && !query.isFetching ? query.data : undefined) : undefined,
    status: !enabled ? "idle" as const : incumbent ? "success" as const : query.isError ? "failed" as const
      : query.isFetching ? "loading" as const : query.isSuccess ? "success" as const : "loading" as const,
    error: query.isError && !incumbent ? quoteErrorMessage(query.error, t) : undefined,
    errorCode: query.isError && !incumbent && query.error instanceof QuotePreviewError ? query.error.code : undefined,
    failure: query.isError && !incumbent ? query.error : undefined,
    estimate: enabled && !query.isError ? estimate : undefined, optimizing: enabled && !!incumbent && query.isFetching,
    progress: enabled ? progress : undefined };
}
