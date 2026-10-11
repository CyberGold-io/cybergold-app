"use client";

import { useEffect } from "react";
import {
  staleMarketDataFeedNames,
  type MarketDataFreshnessState,
} from "../utils/marketDataFreshness";

type MarketDataFreshnessNoticeProps = MarketDataFreshnessState & {
  className?: string;
  locale?: string;
};

export function MarketDataFreshnessNotice({
  gold,
  fx,
}: MarketDataFreshnessNoticeProps) {
  const staleFeeds = staleMarketDataFeedNames({ gold, fx }).join("|");
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && staleFeeds) {
      console.debug("[market-data] stale feeds", { feeds: staleFeeds.split("|") });
    }
  }, [staleFeeds]);

  return null;
}
