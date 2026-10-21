"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageVisible } from "@/app/hooks/usePageVisible";
import { useAccount } from "wagmi";
import { zeroAddress } from "viem";
import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { useSandboxForkGeneration } from "@/app/context/sandboxForkContext";
import { useQuoteCacheScope } from "@/app/context/chainHeadContext";
import { buildQuoteDeadline } from "@/app/utils/swapPolicy";
import { fetchUniversalExactInputQuote, type UniversalExactInputRequest } from "@/app/utils/universalExactInput";

/** Basket executable bodies and continuations come from the canonical quote producer. */
export function useUniversalExactInputQuote(input: Omit<UniversalExactInputRequest, "recipient" | "deadline">, enabled: boolean) {
  const { address } = useAccount();
  const visible = usePageVisible();
  const { identity } = useProtocolConfiguration();
  const generation = useSandboxForkGeneration(), scope = useQuoteCacheScope();
  const key = JSON.stringify(input);
  const [deadlineRevision, renewDeadline] = useState(0);
  const request = useMemo<UniversalExactInputRequest>(() => { void visible; void deadlineRevision; return { ...JSON.parse(key), recipient: address ?? zeroAddress,
    deadline: String(buildQuoteDeadline(scope)) }; }, [key, address, scope, visible, deadlineRevision]);
  const query = useQuery({ queryKey: ["universal-exact-input", generation, identity, scope, request], enabled: enabled && visible,
    retry: false, staleTime: 10_000,
    queryFn: ({ signal }) => fetchUniversalExactInputQuote(request, signal) });
  const deadline = query.data?.plan.deadline;
  useEffect(() => {
    if (!enabled || !visible || deadline === undefined || deadline === "0") return;
    // Reuse the existing ten-minute quote policy before a later click can select stale bytes.
    const timer = setTimeout(() => renewDeadline(revision => revision + 1),
      Math.max(0, Number(deadline) * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline, enabled, visible]);
  return query;
}
