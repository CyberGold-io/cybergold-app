'use client';
import useSWR from 'swr';
import { useMarketExpired } from "./useMarketFreshness";
import {
  parseGoldMarketDataPayload,
  remainingMarketLifetime,
  type GoldMarketDataPayload,
} from "../utils/marketDataValidation";
import { usePublicDisplayCache } from "./usePublicDisplayCache";
import { goldDisplayCacheKey, writePublicDisplayCache } from "../utils/publicDisplayCache";

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Gold market data request failed");
  }
  const payload = parseGoldMarketDataPayload(await response.json());
  if (!payload) {
    throw new Error("Gold market data response was invalid");
  }
  if (!payload.stale) writePublicDisplayCache(goldDisplayCacheKey, payload);
  return payload;
};
const GRAMS_PER_TROY_OUNCE = 31.1034768;
// A stable callback prevents unrelated App renders from restarting the poll timer.
const refreshInterval = (data?: GoldMarketDataPayload) => data?.stale ? 10_000 :
  Math.max(10_000, remainingMarketLifetime(data?.fetchedAt, 1_800_000));

export function useGoldPrice() {
  const fallbackData = usePublicDisplayCache(goldDisplayCacheKey, parseGoldMarketDataPayload);
  const { data, error, isLoading } = useSWR<GoldMarketDataPayload>(
    '/api/gold',
    fetcher,
    {
      fallbackData,
      refreshInterval,
      dedupingInterval: 1_000,
      revalidateOnFocus: false, // avoid refetch on tab focus
      revalidateOnReconnect: false, // avoid refetch on reconnect
    },
  );
  const expired = useMarketExpired(data?.fetchedAt, 3_600_000);

  const pricePerGram = data?.price !== undefined ? data.price / GRAMS_PER_TROY_OUNCE : undefined;

  return {
    price: pricePerGram, // price per gram
    ouncePrice: data?.price, // raw price per ounce
    fetchedAt: data?.fetchedAt,
    // A failed refresh does not expire a previously successful observation early.
    isStale: expired || (data?.stale ?? true),
    isLoading: isLoading && !data,
    isError: !!error,
  };
}
