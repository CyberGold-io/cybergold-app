import { useCallback } from "react";
import type { Address } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { targetChain } from "@/app/config/chain";
import { poolSnapshotOptions } from "@/app/utils/poolSnapshot";

export function useUniswapV3PoolAddress() {
  const queryClient = useQueryClient();

  return useCallback(
    async (params: {
      tokenA: Address;
      tokenB: Address;
      fee: number;
    }) => {
      const snapshot = await queryClient.fetchQuery(poolSnapshotOptions(targetChain.id, params));
      return snapshot.exists ? snapshot.poolAddress as Address : undefined;
    },
    [queryClient]
  );
}
