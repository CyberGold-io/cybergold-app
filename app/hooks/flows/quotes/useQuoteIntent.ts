"use client";

import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { targetChainId } from "@/app/config/chain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TokenIssueQuoteStatus } from "@/app/types";
import { modelFamily } from "@/app/utils/quoteModels";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { fetchQuoteIntent, preferQuoteIntent, quoteIntentResult, retainedQuotePlan, type QuoteIntentRequest, type QuoteIntentResult } from "@/app/utils/quoteIntent";
import { buildQuoteDeadline } from "@/app/utils/swapPolicy";
import { receiveQuoteModel } from "@/app/utils/quoteModelStore";
import { useBoundQuoteState } from "./useBoundQuoteState";
import { useTranslations } from "next-intl";
import { quoteErrorMessage, QuotePreviewError } from "@/app/utils/quoteErrors";
import { usePageVisible } from "@/app/hooks/usePageVisible";

export function useQuoteIntent(input: Omit<QuoteIntentRequest, "adapter" | "deadline" | "retainedPlan">, enabled: boolean) {
  const { addresses, identity: configurationIdentity } = useProtocolConfiguration();
  const t = useTranslations("Home");
  const client = useQueryClient();
  const visible = usePageVisible();
  const canFetch = enabled && visible && Boolean(addresses.core && addresses.helpers);
  const observedScope = useQuoteCacheScope();
  const generation = useSandboxForkGeneration();
  const inputKey = JSON.stringify(input);
  const identity = JSON.stringify([generation, configurationIdentity, inputKey, enabled]);
  const attemptSequence = useRef(0);
  const [deadlineRevision, renewDeadline] = useState(0);
  const [accepted, accept] = useState<{ identity: string; attempt: number; deadline: number; value: QuoteIntentResult }>();
  const [binding, bindScope] = useBoundQuoteState<{ scope: string | undefined }>([generation, configurationIdentity, inputKey, enabled]);
  const scope = binding ? binding.scope : observedScope;
  const request: QuoteIntentRequest = useMemo(() => {
    // Expiry renews this request; later inputs use their own current deadline.
    // Use the same producer as the exact browser cache lookup.
    void deadlineRevision;
    // Reconsider deadlines before resuming. Short returns reuse the shared key.
    void visible;
    return { ...JSON.parse(inputKey), adapter: addresses.adapter,
      deadline: String(buildQuoteDeadline(scope)) };
  }, [inputKey, scope, deadlineRevision, visible, addresses.adapter]);
  const publishQualified = useCallback((value: QuoteIntentResult, attempt: number) => {
    if (attemptSequence.current !== attempt) return;
    value = { ...value, deployment: { core: addresses.core, helpers: addresses.helpers, adapter: value.quotes[0]?.adapter ?? value.redemptionQuotes[0]?.adapter ?? addresses.adapter } };
    accept(previous => {
      if (previous && previous.attempt > attempt) return previous;
      const current = previous?.identity === identity && previous.deadline > Date.now() / 1000 ? previous : undefined;
      const chosen = preferQuoteIntent(input.mode, current?.value, value);
      return chosen === current?.value ? current : { identity, attempt, deadline: Number(request.deadline), value: chosen };
    });
  }, [identity, input.mode, request.deadline, addresses]);
  const [estimate, publishEstimate] = useBoundQuoteState<bigint>([generation, configurationIdentity, scope, inputKey]);
  const [progress, publishProgress] = useBoundQuoteState<{ completed: number; total: number }>([scope, request]);
  const query = useQuery({
    queryKey: ["quote-intent", targetChainId, generation, scope, request, configurationIdentity], enabled: canFetch, retry: false,
    staleTime: query => query.state.data?.context.blockHash.toLowerCase() === scope?.split(":").at(-1)?.toLowerCase() ? 10_000 : 0,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const attempt = ++attemptSequence.current;
      const stages = new Map<string, { completed: number; total: number }>();
      const submitted = accepted?.identity === identity && accepted.deadline > Date.now() / 1000
        ? { ...request, retainedPlan: retainedQuotePlan(accepted.value) } : request;
      return fetchQuoteIntent(submitted, signal, event => {
        if (signal.aborted || attemptSequence.current !== attempt) return;
        if (event.type === "model") receiveQuoteModel(event.value, modelFamily(request), configurationIdentity);
        if (event.type === "qualified") publishQualified(quoteIntentResult(event.value, request.slippageBps), attempt);
        if (event.type === "invalidated") accept(previous => previous?.identity === identity ? undefined : previous);
        if (event.type === "estimate") {
          publishEstimate(BigInt(event.amount));
        }
        if (event.type === "progress") {
          stages.set(event.stage, event);
          const rows = [...stages.values()];
          publishProgress({ completed: rows.reduce((sum, row) => sum + row.completed, 0),
            total: rows.reduce((sum, row) => sum + row.total, 0) + 1 });
        }
      }).then(result => {
        if (!signal.aborted) publishQualified(result, attempt);
        publishEstimate(input.mode === "issue-exact-in" ? result.executionAmount : result.displayAmount);
        return { ...result, deployment: { core: addresses.core, helpers: addresses.helpers, adapter: result.quotes[0]?.adapter ?? result.redemptionQuotes[0]?.adapter ?? addresses.adapter } };
      });
    },
  });
  // A completed same-browser cache hit has no stream callback.
  if (enabled && query.isSuccess && !query.isFetching && query.data && accepted?.identity !== identity) {
    accept({ identity, attempt: 0, deadline: Number(request.deadline), value: query.data });
  }
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
    // Head events during a long exact calculation must not abandon its answer.
    // Keep this intent's scope until completion, then refresh on the next head.
    // An input/generation/enabled change gets a new binding immediately.
    if (!binding || (!fetching.current && binding.scope !== observedScope)) bindScope({ scope: observedScope });
  }, [observedScope, binding, bindScope]);
  const queryKey = JSON.stringify(["quote-intent", targetChainId, generation, scope, request, configurationIdentity]);
  useEffect(() => {
    if (!canFetch) void client.cancelQueries({ queryKey: JSON.parse(queryKey), exact: true });
  }, [client, canFetch, queryKey]);
  const status: TokenIssueQuoteStatus = !enabled ? "idle" : incumbent ? "success" : query.isError ? "failed" : query.isFetching ? "loading" : query.isSuccess ? "success" : "loading";
  return { data: enabled ? incumbent?.value ?? (!query.isError && !query.isFetching ? query.data : undefined) : undefined, status,
    error: query.isError && !incumbent ? quoteErrorMessage(query.error, t) : undefined,
    errorCode: query.isError && !incumbent && query.error instanceof QuotePreviewError ? query.error.code : undefined,
    estimate: enabled && !query.isError ? estimate : undefined,
    optimizing: enabled && !!incumbent && query.isFetching,
    progress: enabled ? query.isSuccess ? { completed: progress?.total ?? 1, total: progress?.total ?? 1 } : progress : undefined,
  };
}
