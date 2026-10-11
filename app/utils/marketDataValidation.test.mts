import assert from "node:assert/strict";
import test from "node:test";
import { parseGoldMarketDataPayload, parseFxMarketDataPayload, remainingMarketLifetime } from "./marketDataValidation.ts";

test("client market-data envelopes preserve freshness and reject unexpected fields", () => {
  const gold = {
    price: 3320.25,
    fetchedAt: "2026-07-23T10:30:00.000Z",
    stale: true,
  };
  const fx = {
    base: "USD",
    rates: { USD: 1, EUR: 0.92, CHF: 0.89, RUB: 91.5 },
    fetchedAt: "2026-07-23T10:30:00.000Z",
    stale: false,
  };

  assert.deepEqual(parseGoldMarketDataPayload(gold), gold);
  assert.deepEqual(parseFxMarketDataPayload(fx), fx);
  assert.equal(
    parseGoldMarketDataPayload({ ...gold, providerInternalId: "secret" }),
    undefined
  );
  assert.equal(
    parseFxMarketDataPayload({
      ...fx,
      rates: { ...fx.rates, GBP: 0.8 },
    }),
    undefined
  );
  assert.equal(
    parseGoldMarketDataPayload({
      ...gold,
      fetchedAt: "2026-02-31T10:30:00.000Z",
    }),
    undefined
  );
});


test("market reuse preserves acquisition age rather than starting a new lifetime", () => {
  const acquired = "2026-10-04T10:00:00.000Z";
  const start = Date.parse(acquired), ttl = 300_000;
  assert.equal(remainingMarketLifetime(acquired, ttl, start + ttl - 1_000), 1_000);
  assert.equal(remainingMarketLifetime(acquired, ttl, start + ttl), 0);
  assert.equal(remainingMarketLifetime(acquired, ttl, start - 10_000), ttl);
  assert.equal(remainingMarketLifetime(undefined, ttl, start), 0);
});
