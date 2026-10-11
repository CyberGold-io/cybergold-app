import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";

import { targetChain } from "@/app/config/chain";
import { liquidityFromSnapshot, poolSnapshotOptions } from "@/app/utils/poolSnapshot";

export type UniswapV3PoolSnapshot = {
  poolAddress: Address;
  activeLiquidity: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  token0Balance: bigint;
  token1Balance: bigint;
  observedAt?: string;
};

export function useUniswapV3PoolSnapshot() {
  const queryClient = useQueryClient();

  return useCallback(
    async (params: {
      poolAddress: Address;
      token0: Address;
      token1: Address;
      fee: number;
    }): Promise<UniswapV3PoolSnapshot | undefined> => {
      const snapshot = await queryClient.fetchQuery(poolSnapshotOptions(targetChain.id, {
        tokenA: params.token0, tokenB: params.token1, fee: params.fee,
      }));
      // This compatibility hook requests the unchanged legacy V3 producer,
      // whose present-pool tuple contains all of these historical fields.
      return liquidityFromSnapshot(snapshot) as UniswapV3PoolSnapshot | undefined;
    },
    [queryClient]
  );
}
