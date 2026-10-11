import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { targetChainId } from "@/app/config/chain";
import { liquidityFromSnapshot, poolSnapshotOptions, type PoolIdentifier } from "@/app/utils/poolSnapshot";

/** Shares the native query used by discovery and USD display; all state comes from Backend. */
export function useUniswapPoolSnapshot() {
  const client = useQueryClient();
  return useCallback(async (identifier: PoolIdentifier) => {
    const value = await client.fetchQuery(poolSnapshotOptions(targetChainId, identifier));
    return liquidityFromSnapshot(value);
  }, [client]);
}
