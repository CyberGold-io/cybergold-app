import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPendingSafeTxRows,
  splitPendingSafeTxRows,
  sortAndConcatSignatures,
} from "./governanceSafeTxViewModel.ts";
import type { Address, Hex } from "viem";
import type { SafeServicePendingTx } from "@/app/hooks/useSafeTransactionService";

const OWNER_A = "0x00000000000000000000000000000000000000a1" as Address;
const OWNER_B = "0x00000000000000000000000000000000000000b2" as Address;
const OWNER_C = "0x00000000000000000000000000000000000000c3" as Address;
const VALID_SIGNATURE_A = `0x${"11".repeat(65)}` as Hex;
const VALID_SIGNATURE_B = `0x${"22".repeat(65)}` as Hex;

function tx(overrides: Partial<SafeServicePendingTx> = {}): SafeServicePendingTx {
  return {
    safeTxHash: `0x${"01".repeat(32)}`,
    to: "0x0000000000000000000000000000000000000010" as Address,
    value: "0",
    data: "0x" as Hex,
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: "0x0000000000000000000000000000000000000000" as Address,
    refundReceiver: "0x0000000000000000000000000000000000000000" as Address,
    nonce: 1,
    isExecuted: false,
    confirmationsRequired: 2,
    confirmations: [
      { owner: OWNER_A, signature: VALID_SIGNATURE_A },
      { owner: OWNER_B, signature: VALID_SIGNATURE_B },
    ],
    submissionDate: "2026-06-01T10:00:00.000Z",
    ...overrides,
  } as SafeServicePendingTx;
}

test("buildPendingSafeTxRows splits confirmation and execution rows", () => {
  const rows = buildPendingSafeTxRows({
    transactions: [
      tx({ safeTxHash: `0x${"01".repeat(32)}` as Hex, confirmations: [{ owner: OWNER_A, signature: VALID_SIGNATURE_A }] }),
      tx({ safeTxHash: `0x${"02".repeat(32)}` as Hex, nonce: 2 }),
    ],
    liveSafeThreshold: 2,
    connectedAddress: OWNER_A,
    liveSafeNonce: 2,
  });

  const { confirmRows, executeRows } = splitPendingSafeTxRows(rows);

  assert.equal(confirmRows.length, 1);
  assert.equal(confirmRows[0].signerConfirmed, true);
  assert.equal(executeRows.length, 1);
  assert.equal(executeRows[0].isExecutableNow, true);
});

test("buildPendingSafeTxRows queues higher nonces behind the live Safe nonce", () => {
  const rows = buildPendingSafeTxRows({
    transactions: [
      tx({ safeTxHash: `0x${"01".repeat(32)}` as Hex, nonce: 3 }),
      tx({ safeTxHash: `0x${"02".repeat(32)}` as Hex, nonce: 4 }),
    ],
    liveSafeThreshold: 2,
    liveSafeNonce: 3,
  });

  const { executeRows } = splitPendingSafeTxRows(rows);

  assert.equal(executeRows[0].tx.nonce, 3);
  assert.equal(executeRows[0].isExecutableNow, true);
  assert.equal(executeRows[1].tx.nonce, 4);
  assert.equal(executeRows[1].isQueuedByNonce, true);
  assert.equal(executeRows[1].nextExecutableNonce, 3);
});

test("buildPendingSafeTxRows marks fully signed same-nonce conflicts", () => {
  const rows = buildPendingSafeTxRows({
    transactions: [
      tx({ safeTxHash: `0x${"01".repeat(32)}` as Hex, nonce: 7 }),
      tx({ safeTxHash: `0x${"02".repeat(32)}` as Hex, nonce: 7 }),
    ],
    liveSafeThreshold: 2,
    liveSafeNonce: 7,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.hasNonceConflict), true);
  assert.equal(rows.every((row) => row.isExecutableNow), true);
});

test("sortAndConcatSignatures sorts by owner address and ignores non-executable signatures", () => {
  const signatures = sortAndConcatSignatures([
    { owner: OWNER_C, signature: "0x1234" },
    { owner: OWNER_B, signature: VALID_SIGNATURE_B },
    { owner: OWNER_A, signature: VALID_SIGNATURE_A },
  ]);

  assert.equal(signatures, `0x${"11".repeat(65)}${"22".repeat(65)}`);
});
