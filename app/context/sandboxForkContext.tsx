"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { createSandboxForkTracker, resetSandboxQueries } from "@/app/utils/sandboxForkState";

const SandboxForkContext = createContext<string | null | undefined>(undefined);
export const useSandboxForkGeneration = () => useContext(SandboxForkContext);
const GENERATION_QUERY = "sandbox-fork-generation";

export function SandboxForkBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const tracker = useRef<ReturnType<typeof createSandboxForkTracker> | undefined>(undefined);
  const [resetId, setResetId] = useState(0);
  const query = useQuery({
    queryKey: [GENERATION_QUERY], enabled: targetChainId === 31338,
    retry: false, staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/dashboard/onchain-summary", { signal, cache: "no-store" });
      if (!response.ok) throw new Error("Sandbox fork generation is temporarily unavailable.");
      return response.json() as Promise<{ sandboxForkGeneration?: string | null }>;
    },
  });
  const generation = query.data?.sandboxForkGeneration;
  useEffect(() => {
    if (targetChainId !== 31338) return;
    tracker.current ??= createSandboxForkTracker(window.localStorage);
    void tracker.current(generation, async () => {
      await resetSandboxQueries(client);
      // Reset in-memory pending transactions/receipts and permit reservations.
      // The outer Wagmi connection remains; persisted display preferences stay.
      setResetId((value) => value + 1);
    }).catch(() => { /* Storage restrictions cannot block the App's normal reads. */ });
  }, [client, generation]);

  return <SandboxForkContext.Provider value={generation}>
    <div key={resetId} className="contents">{children}</div>
  </SandboxForkContext.Provider>;
}
