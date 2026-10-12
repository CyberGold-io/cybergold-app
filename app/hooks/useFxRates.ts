"use client";

import useSWR from "swr";
import { useMarketExpired } from "./useMarketFreshness";
import {
  parseFxMarketDataPayload,
  remainingMarketLifetime,
  type FxMarketDataPayload,
} from "../utils/marketDataValidation";
import { usePublicDisplayCache } from "./usePublicDisplayCache";
import { fxDisplayCacheKey, writePublicDisplayCache } from "../utils/publicDisplayCache";

export type DisplayCurrency = "USD" | "EUR" | "CHF" | "RUB";

const DEFAULT_RATES: Record<DisplayCurrency, number> = {
  USD: 1,
  EUR: 0.92,
  CHF: 0.89,
  RUB: 91.5,
};

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("FX market data request failed");
  }
  const payload = parseFxMarketDataPayload(await response.json());
  if (!payload) {
    throw new Error("FX market data response was invalid");
  }
  if (!payload.stale) writePublicDisplayCache(fxDisplayCacheKey, payload);
  return payload;
};

export function useFxRates() {
  const fallbackData = usePublicDisplayCache(fxDisplayCacheKey, parseFxMarketDataPayload);
  const { data, error, isLoading } = useSWR<FxMarketDataPayload>("/api/fx", fetcher, {
    fallbackData,
    refreshInterval: data => data?.stale ? 10_000 : Math.max(1_000, remainingMarketLifetime(data?.fetchedAt, 300_000)),
    dedupingInterval: 1_000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const expired = useMarketExpired(data?.fetchedAt, 300_000);

  return {
    rates: data?.rates ?? DEFAULT_RATES,
    fetchedAt: data?.fetchedAt,
    isStale: expired || Boolean(error) || (data?.stale ?? true),
    isLoading: isLoading && !data,
    isError: Boolean(error),
  };
}
