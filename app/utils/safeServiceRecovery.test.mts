import assert from "node:assert/strict";
import test from "node:test";

import {
  callSafeApi,
  safeReadRefetchInterval,
  safeReadRetryDelay,
  shouldRetrySafeRead,
} from "../hooks/useSafeTransactionService.ts";

const SAFE_ADDRESS = "0x601dBc67EAb2822a3C44BdB6bbAB4147ad1F601D";

async function withFetch(
  fetchImpl: typeof fetch,
  action: () => Promise<void>
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await action();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("long Safe Retry-After surfaces the error and defers to scheduled refetch", async () => {
  await withFetch(
    (async () =>
      Response.json(
        { error: "rate limited" },
        { status: 429, headers: { "Retry-After": "3600" } }
      )) as typeof fetch,
    async () => {
      let caught: unknown;
      try {
        await callSafeApi("safe-info", { safeAddress: SAFE_ADDRESS });
      } catch (error) {
        caught = error;
      }

      assert.ok(caught instanceof Error);
      assert.equal(shouldRetrySafeRead(0, caught), false);
      assert.equal(safeReadRetryDelay(0, caught), 5_000);
      assert.equal(
        safeReadRefetchInterval({ state: { error: caught } }),
        3_600_000
      );
    }
  );
});

test("short Safe Retry-After remains eligible for a bounded immediate retry", async () => {
  await withFetch(
    (async () =>
      Response.json(
        { error: "rate limited" },
        { status: 429, headers: { "Retry-After": "2" } }
      )) as typeof fetch,
    async () => {
      let caught: unknown;
      try {
        await callSafeApi("safe-info", { safeAddress: SAFE_ADDRESS });
      } catch (error) {
        caught = error;
      }

      assert.ok(caught instanceof Error);
      assert.equal(shouldRetrySafeRead(0, caught), true);
      assert.equal(safeReadRetryDelay(0, caught), 2_000);
    }
  );
});
