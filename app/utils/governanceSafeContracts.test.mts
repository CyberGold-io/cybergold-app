import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";

import {
  buildSafeRejectionPayload,
  isSafeRejectionPayload,
  isSafeRejectionTransaction,
} from "./governanceSafeContracts.ts";
import type { SafeServicePendingTx } from "@/app/hooks/useSafeTransactionService";

const SAFE = "0x00000000000000000000000000000000000000a1" as Address;

test("buildSafeRejectionPayload creates an empty self-call at the same nonce", () => {
  const payload = buildSafeRejectionPayload(SAFE, 7n);

  assert.equal(payload.to, SAFE);
  assert.equal(payload.data, "0x");
  assert.equal(payload.value, 0n);
  assert.equal(payload.nonce, 7n);
  assert.equal(isSafeRejectionPayload(payload, SAFE), true);
});

test("isSafeRejectionTransaction recognizes empty self-call rejection transactions", () => {
  const tx: SafeServicePendingTx = {
    safeTxHash: `0x${"01".repeat(32)}` as Hex,
    to: SAFE,
    value: "0",
    data: "0x" as Hex,
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: "0x0000000000000000000000000000000000000000" as Address,
    refundReceiver: "0x0000000000000000000000000000000000000000" as Address,
    nonce: 3,
    isExecuted: false,
    confirmationsRequired: 2,
    confirmations: [],
  };

  assert.equal(isSafeRejectionTransaction(tx, SAFE), true);
});
