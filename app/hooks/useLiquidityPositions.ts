"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { targetChainId } from "../config/chain";
import { useSandboxForkGeneration } from "../context/sandboxForkContext";
import type { LiquidityPositionsSnapshot } from "../utils/liquidityPositions";

export function useLiquidityPositions(holder: Address | undefined, enabled: boolean) {
  const generation = useSandboxForkGeneration();
  const query = useQuery({
    queryKey: ["liquidity-positions", targetChainId, generation, holder?.toLowerCase()],
    enabled: enabled && Boolean(holder),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/account/liquidity-positions?${new URLSearchParams({ holder: holder! })}`, {
        cache: "no-store", signal,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Liquidity positions are temporarily unavailable.");
      return payload as LiquidityPositionsSnapshot;
    },
  });
  return {
    data: query.data,
    isLoading: query.isPending,
    isRefreshing: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
