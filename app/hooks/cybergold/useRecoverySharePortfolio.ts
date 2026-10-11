"use client";

import { useProtocolConfiguration } from "@/app/context/protocolConfigurationContext";
import { requireProtocolAddress } from "@/app/utils/protocolConfiguration";

import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { EMPTY_RECOVERY_PORTFOLIO, assertRecoveryPortfolioDeployment, mergeRecoveryPortfolioPages,
  type RecoverySharePortfolio } from "@/app/utils/recoveryPortfolio";

import { EXPECTED_CHAIN_ID } from "@/app/utils/expectedChain";
export type { RecoveryPool, RecoveryShareBalance } from "@/app/utils/recoveryPortfolio";

export function useRecoverySharePortfolio(holder?: Address) {
  const { core: CORE_DIAMOND_ADDRESS } = useProtocolConfiguration().addresses;
  const key = holder?.toLowerCase();
  const activeHolder = useRef(key);
  useEffect(() => {
    activeHolder.current = key;
    return () => { activeHolder.current = undefined; };
  }, [key]);
  // The swap page starts discovery; the wallet dialog shares the complete
  // snapshot without starting another read or adding background polling.
  const query = useQuery({
    queryKey: ["recovery-shares", EXPECTED_CHAIN_ID, CORE_DIAMOND_ADDRESS, key],
    enabled: Boolean(holder && CORE_DIAMOND_ADDRESS),
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      let complete: RecoverySharePortfolio | undefined;
      let next: string | null = null;
      do {
        const params = new URLSearchParams({ holder: holder! });
        if (next !== null && complete?.snapshotBlockHash) {
          params.set("offset", next);
          params.set("blockHash", complete.snapshotBlockHash);
        }
        const response = await fetch(`/api/recovery/shares?${params}`, {
          cache: "no-store", signal,
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "Recovery-share RPC snapshot is unavailable");
        }
        if (!Array.isArray(body.balances) || !Array.isArray(body.pools) ||
            (body.status !== "not-configured" && (body.enabled !== true || typeof body.complete !== "boolean"))) {
          throw new Error("Recovery snapshot is incomplete");
        }
        const page = body as RecoverySharePortfolio;
        assertRecoveryPortfolioDeployment(page, EXPECTED_CHAIN_ID, requireProtocolAddress(CORE_DIAMOND_ADDRESS, "Core"));
        complete = mergeRecoveryPortfolioPages(complete, page);
        if (!page.enabled) break;
        if (!page.complete && (!page.nextOffset || (next !== null && BigInt(page.nextOffset) <= BigInt(next)))) {
          throw new Error("Recovery continuation did not advance");
        }
        next = page.nextOffset;
      } while (next !== null);
      return complete!;
    },
  });
  const refetchQuery = query.refetch;
  const refetch = useCallback(async () => {
    // A previous wallet's receipt callback must not refresh the current wallet.
    if (activeHolder.current !== key || !holder) return;
    await refetchQuery();
  }, [holder, key, refetchQuery]);
  const data = query.data ?? EMPTY_RECOVERY_PORTFOLIO;
  return { data, isLoading: Boolean(holder) && query.isPending,
    isRefreshing: query.isFetching, isStale: Boolean(query.error && data.complete),
    error: query.error?.message, refetch };
}
