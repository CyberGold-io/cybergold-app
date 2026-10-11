"use client";

import { useEffect, useState } from "react";
import { remainingMarketLifetime } from "../utils/marketDataValidation";

/** Acquisition age survives server, intermediary and browser reuse. */
export function useMarketExpired(fetchedAt: string | undefined, ttl: number) {
  const [, update] = useState(0);
  useEffect(() => {
    const remaining = remainingMarketLifetime(fetchedAt, ttl);
    if (!remaining) return;
    const timer = setTimeout(() => update(value => value + 1), remaining + 1);
    return () => clearTimeout(timer);
  }, [fetchedAt, ttl]);
  return remainingMarketLifetime(fetchedAt, ttl) === 0;
}
