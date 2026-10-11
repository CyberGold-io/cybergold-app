import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { staleMarketDataFeedNames } from "./marketDataFreshness.ts";

test("market-data freshness names every stale feed shown to users", () => {
  assert.deepEqual(
    staleMarketDataFeedNames({
      gold: { fetchedAt: "2026-07-23T10:00:00.000Z", isStale: true },
      fx: { fetchedAt: "2026-07-23T10:05:00.000Z", isStale: true },
    }),
    ["gold quote", "FX rates"]
  );
  assert.deepEqual(
    staleMarketDataFeedNames({
      gold: { fetchedAt: "2026-07-23T10:00:00.000Z", isStale: false },
      fx: { fetchedAt: "2026-07-23T10:05:00.000Z", isStale: false },
    }),
    []
  );
});

test("initial loading is quiet while an acquired stale observation remains disclosed", () => {
  assert.deepEqual(staleMarketDataFeedNames({ gold: { isStale: true, isLoading: true } }), []);
  assert.deepEqual(staleMarketDataFeedNames({ gold: { isStale: true, isLoading: false } }), []);
  assert.deepEqual(staleMarketDataFeedNames({ gold: { fetchedAt: "2026-10-06T00:00:00Z", isStale: true, isLoading: false } }), ["gold quote"]);
  assert.deepEqual(staleMarketDataFeedNames({ fx: { fetchedAt: "2026-10-06T00:00:00Z", isStale: true, isLoading: false } }), ["FX rates"]);
});

test("every locale labels stale market data as estimated rather than live", () => {
  for (const locale of ["en", "fr", "de", "ru"]) {
    const messages = JSON.parse(
      readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")
    ) as {
      MarketData?: Record<string, string>;
    };
    assert.deepEqual(
      Object.keys(messages.MarketData ?? {}).sort(),
      [
        "fxFetched",
        "fxRates",
        "goldFetched",
        "goldQuote",
        "notice",
        "timeUnavailable",
        "title",
      ]
    );
    assert.match(messages.MarketData?.notice ?? "", /\{feeds\}/);
  }
});
