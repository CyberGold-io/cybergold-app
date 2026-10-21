"use client";

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { targetChainId } from "../config/chain";
import { pools } from "../config/pools";
import { useProtocolConfiguration } from "../context/protocolConfigurationContext";
import type { TokenType } from "../types";
import { poolCatalogOptions, poolIdentifierFromRef, poolSnapshotOptions, type PoolSnapshot } from "../utils/poolSnapshot";
import { tokenUsdPricesFromSnapshots, type TokenUsdPriceOptions } from "../utils/tokenUsdPricing";
import { usePublicDisplayCache } from "./usePublicDisplayCache";
import { displayTokenUsdPrices, parseDisplayTokenUsdPrices, projectDisplayTokenUsdPrices,
  readPublicDisplayCache, tokenUsdDisplayCacheKey, writePublicDisplayCache } from "../utils/publicDisplayCache";

const referencePoolIds = new Set(pools.map(pool => pool.address.toLowerCase()));
const noDisplayOverrides: Record<string, number | undefined> = {};

function combine(results: UseQueryResult<PoolSnapshot>[]) {
  return {
    observations: results.map(result => result.data),
    isLoading: results.some(result => result.isLoading),
    isRefreshing: results.some(result => result.isFetching),
    isError: results.some(result => result.isError),
    error: results.find(result => result.error)?.error ?? null,
  };
}

export function useTokenUsdPrices(tokenList: TokenType[], options?: TokenUsdPriceOptions,
  displayOverrides: Record<string, number | undefined> = noDisplayOverrides) {
  const { tokenAddresses, displayTokens } = useProtocolConfiguration();
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
  const cacheKey = tokenUsdDisplayCacheKey(targetChainId);
  const cachedPrices = usePublicDisplayCache(cacheKey, parseDisplayTokenUsdPrices);
  // An explicitly unresolved reference keeps its cached approximation instead
  // of silently substituting a pool-derived price for a different reference.
  const presentationPrices = useMemo(() => ({ ...prices, ...displayOverrides }), [prices, displayOverrides]);
  const presentationTokens = useMemo(() => [...new Map([...displayTokens, ...tokenList]
    .map(token => [token.id, token])).values()], [displayTokens, tokenList]);
  const displayPrices = useMemo(() => displayTokenUsdPrices(presentationTokens, presentationPrices, cachedPrices),
    [presentationTokens, presentationPrices, cachedPrices]);
  useEffect(() => {
    const observed = projectDisplayTokenUsdPrices(tokenList, presentationPrices);
    if (Object.keys(observed).length) {
      const previous = readPublicDisplayCache(cacheKey, parseDisplayTokenUsdPrices);
      writePublicDisplayCache(cacheKey, { ...previous, ...observed });
    }
  }, [cacheKey, tokenList, presentationPrices]);
  return { prices, displayPrices, isLoading: observation.isLoading || catalog.isLoading,
    isRefreshing: observation.isRefreshing || catalog.isFetching,
    isError: observation.isError || catalog.isError, error: observation.error ?? catalog.error };
}
