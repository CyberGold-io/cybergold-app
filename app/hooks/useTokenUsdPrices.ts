"use client";

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { targetChainId } from "../config/chain";
import { pools } from "../config/pools";
import { useProtocolConfiguration } from "../context/protocolConfigurationContext";
import type { TokenType } from "../types";
import { poolCatalogOptions, poolIdentifierFromRef, poolSnapshotOptions, type PoolSnapshot } from "../utils/poolSnapshot";
import { tokenUsdPricesFromSnapshots, type TokenUsdPriceOptions } from "../utils/tokenUsdPricing";

const referencePoolIds = new Set(pools.map(pool => pool.address.toLowerCase()));

function combine(results: UseQueryResult<PoolSnapshot>[]) {
  return {
    observations: results.map(result => result.data),
    isLoading: results.some(result => result.isLoading),
    isError: results.some(result => result.isError),
    error: results.find(result => result.error)?.error ?? null,
  };
}

export function useTokenUsdPrices(tokenList: TokenType[], options?: TokenUsdPriceOptions) {
  const { tokenAddresses } = useProtocolConfiguration();
  const referenceQueries = useMemo(() => {
    const priceTokens: Record<string, string | undefined> = { usdc: tokenAddresses.USDC, usdt: tokenAddresses.USDT,
      weth: tokenAddresses.WETH, xaut: tokenAddresses.XAUT, paxg: tokenAddresses.PAXG };
    return pools.flatMap(pool => {
      const tokenA = priceTokens[pool.token0], tokenB = priceTokens[pool.token1];
      return tokenA && tokenB ? [poolSnapshotOptions(targetChainId, { tokenA, tokenB, fee: pool.fee })] : [];
    });
  }, [tokenAddresses]);
  // Reuse the same native TanStack queries as pool discovery/liquidity. The
  // existing fork boundary cancels and removes these observations on refresh.
  const catalog = useQuery(poolCatalogOptions(targetChainId));
  const queries = useMemo(() => [
    ...referenceQueries,
    ...(catalog.data?.entries ?? []).filter(pool =>
      !(pool.protocol === "v3" && referencePoolIds.has(pool.id.toLowerCase())))
      .map(pool => poolSnapshotOptions(targetChainId, poolIdentifierFromRef(pool))),
  ], [catalog.data, referenceQueries]);
  const observation = useQueries({ queries, combine });
  const goldReferenceGramsByTokenId = options?.goldReferenceGramsByTokenId;
  const goldSpotUsdPerOzt = options?.goldSpotUsdPerOzt;
  const prices = useMemo(() => observation.observations && tokenUsdPricesFromSnapshots(
    observation.observations, tokenList, { goldReferenceGramsByTokenId, goldSpotUsdPerOzt },
  ), [observation.observations, tokenList, goldReferenceGramsByTokenId, goldSpotUsdPerOzt]);
  return { prices, isLoading: observation.isLoading || catalog.isLoading,
    isError: observation.isError || catalog.isError, error: observation.error ?? catalog.error };
}
