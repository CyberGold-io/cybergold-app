import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";

import type { SafeServicePendingTx } from "@/app/hooks/useSafeTransactionService";
import { isGovernanceTargetMissingCode, fetchGovernanceTargetCodes } from "./governanceTargetCode.ts";

const SAFE = "0x00000000000000000000000000000000000000a1" as Address;
const TARGET = "0x00000000000000000000000000000000000000b2" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function buildTx(overrides: Partial<SafeServicePendingTx> = {}): SafeServicePendingTx {
  return {
    safeTxHash: `0x${"01".repeat(32)}` as Hex,
    to: TARGET,
    value: "0",
    data: "0x8456cb59" as Hex,
    operation: 0,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce: 1,
    isExecuted: false,
    confirmationsRequired: 2,
    confirmations: [],
    ...overrides,
  };
}

test("isGovernanceTargetMissingCode flags contract calls to empty-code targets", () => {
  assert.equal(
    isGovernanceTargetMissingCode({
      tx: buildTx(),
      hasCode: false,
      safeAddress: SAFE,
    }),
    true
  );
});

test("isGovernanceTargetMissingCode ignores rejection self-calls", () => {
  assert.equal(
    isGovernanceTargetMissingCode({
      tx: buildTx({ to: SAFE, data: "0x" as Hex }),
      hasCode: false,
      safeAddress: SAFE,
    }),
    false
  );
});

test("isGovernanceTargetMissingCode ignores normal targets that still have code", () => {
  assert.equal(
    isGovernanceTargetMissingCode({
      tx: buildTx(),
      hasCode: true,
      safeAddress: SAFE,
    }),
    false
  );
});

const contract = `0x${"1".repeat(40)}`, eoa = `0x${"2".repeat(40)}`;

test("proposal destination facts retain contract and empty-code classifications without browser RPC", async () => {
  const requests: string[] = [], controller = new AbortController();
  const values = await fetchGovernanceTargetCodes([contract, eoa], controller.signal, (async (url, init) => {
    requests.push(String(url));
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    const address = new URL(String(url), "http://fixture").searchParams.get("address");
    return Response.json({ address, hasCode: address === contract });
  }) as typeof fetch);
  assert.deepEqual([...values], [[contract, true], [eoa, false]]);
  assert.deepEqual(requests, [contract, eoa].map(address => `/api/governance/target-code?address=${address}`));
});

test("one unavailable destination fails the observation instead of classifying it as an EOA", async () => {
  let calls = 0;
  await assert.rejects(fetchGovernanceTargetCodes([contract, eoa], undefined, (async () => {
    return ++calls === 1 ? Response.json({ address: contract, hasCode: true })
      : Response.json({ error: "unavailable" }, { status: 503 });
  }) as typeof fetch), /temporarily unavailable/);
  assert.equal(calls, 2);
});

test("cancelled destination queries remain cancelled without a compatibility read", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchGovernanceTargetCodes([contract], controller.signal, (async (_, init) => {
    init!.signal!.throwIfAborted();
    throw new Error("Unexpected continuation");
  }) as typeof fetch), { name: "AbortError" });
});

test("an empty proposal list produces no destination request", async () => {
  assert.equal((await fetchGovernanceTargetCodes([], undefined, (async () => {
    throw new Error("Unexpected request");
  }) as typeof fetch)).size, 0);
});
