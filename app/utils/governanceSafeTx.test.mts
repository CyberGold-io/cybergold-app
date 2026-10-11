import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExecutedSafeTxHashSet,
  filterPendingSafeTransactions,
  localSafeExecutionStorageKey,
  localSafeNonceStorageKey,
  parseStoredSafeNonce,
  shouldResetLocalExecutionCache,
} from "./governanceSafeTx.ts";

test("storage keys normalize safe address casing", () => {
  assert.equal(
    localSafeExecutionStorageKey(31337, "0xAbCdEf0000000000000000000000000000000000"),
    "cybergold:governance-safe-executions:31337:0xabcdef0000000000000000000000000000000000"
  );
  assert.equal(
    localSafeNonceStorageKey(31337, "0xAbCdEf0000000000000000000000000000000000"),
    "cybergold:governance-safe-nonce:31337:0xabcdef0000000000000000000000000000000000"
  );
});

test("parseStoredSafeNonce parses valid values and rejects invalid values", () => {
  assert.equal(parseStoredSafeNonce("12"), 12);
  assert.equal(parseStoredSafeNonce("0"), 0);
  assert.equal(parseStoredSafeNonce("-1"), undefined);
  assert.equal(parseStoredSafeNonce("not-a-number"), undefined);
  assert.equal(parseStoredSafeNonce(undefined), undefined);
  assert.equal(parseStoredSafeNonce(null), undefined);
});

test("shouldResetLocalExecutionCache detects nonce regressions", () => {
  assert.equal(shouldResetLocalExecutionCache(8, 7), true);
  assert.equal(shouldResetLocalExecutionCache(8, 8), false);
  assert.equal(shouldResetLocalExecutionCache(8, 9), false);
  assert.equal(shouldResetLocalExecutionCache(undefined, 1), false);
  assert.equal(shouldResetLocalExecutionCache(1, undefined), false);
});

test("buildExecutedSafeTxHashSet merges and normalizes hashes", () => {
  const hashes = buildExecutedSafeTxHashSet([
    ["0xABC", "0xdef"],
    ["0xabc", "0x123"],
    undefined,
  ]);
  assert.deepEqual([...hashes].sort(), ["0x123", "0xabc", "0xdef"]);
});

test("filterPendingSafeTransactions excludes executed, stale nonce, and executed hash duplicates", () => {
  const rows = [
    { safeTxHash: "0x01", nonce: 5, isExecuted: false },
    { safeTxHash: "0x02", nonce: 4, isExecuted: false },
    { safeTxHash: "0x03", nonce: 3, isExecuted: true },
    { safeTxHash: "0x04", nonce: 2, isExecuted: false },
  ];

  const filtered = filterPendingSafeTransactions(rows, {
    liveSafeNonce: 3,
    executedSafeTxHashes: new Set(["0x02"]),
  });

  assert.deepEqual(filtered, [{ safeTxHash: "0x01", nonce: 5, isExecuted: false }]);
});
