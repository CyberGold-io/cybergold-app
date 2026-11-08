import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { createSwapDiagnostics, type ClientDiagnostic } from "./clientDiagnostics.ts";
import { signWalletTypedDataGroup } from "./walletTypedData.ts";
import type { WalletTypedData } from "./walletBatch.ts";

const signature = `0x${"ab".repeat(65)}` as Hex;
const payload = { account: `0x${"1".repeat(40)}`, domain: { name: "private-domain", chainId: 31338 },
  types: { Permit: [{ name: "value", type: "uint256" }] }, primaryType: "Permit", message: { value: 123n } } as WalletTypedData;

test("signature fulfillment observes the returned request once without receiving signing data", async () => {
  const events: ClientDiagnostic[] = [];
  const swap = createSwapDiagnostics({ direction: "redeem" }, undefined, event => events.push(event));
  const entered = Promise.withResolvers<void>(), response = Promise.withResolvers<Hex>();
  const callbackArguments: unknown[][] = [];
  let calls = 0;
  const result = signWalletTypedDataGroup([payload], async request => {
    calls++; assert.equal(request, payload); entered.resolve(); return response.promise;
  }, undefined, { requestNext: swap.walletStep, signatureFulfilled: (...args) => {
    callbackArguments.push(args); swap.signatureFulfilled();
  } });
  await entered.promise;
  assert.deepEqual(events.map(event => [event.operation, event.outcome]), [["swap", "started"], ["wallet", "requested"]]);
  response.resolve(signature);
  assert.deepEqual(await result, [signature]);
  assert.equal(calls, 1); assert.deepEqual(callbackArguments, [[]]);
  const complete = events.at(-1)!;
  assert.equal(complete.operation, "wallet"); assert.equal(complete.outcome, "succeeded");
  assert.equal(complete.stage, "authorization"); assert.equal(complete.walletStep, "signature");
  assert.equal(complete.attemptId, swap.id); assert.equal(complete.transactionHash, undefined);
  assert.ok(complete.durationMs! >= events.at(-2)!.durationMs!);
  assert.doesNotMatch(JSON.stringify(events), /private-domain|abababab|primaryType|Permit|message/);
});

test("a failed optional fulfillment observer cannot discard or retry returned signatures", async () => {
  let calls = 0, observations = 0;
  const signatures = await signWalletTypedDataGroup([payload, payload], async () => { calls++; return signature; }, undefined,
    { requestNext: () => {}, signatureFulfilled: () => { observations++; throw new Error("observer unavailable"); } });
  assert.deepEqual(signatures, [signature, signature]); assert.equal(calls, 2); assert.equal(observations, 2);
});

test("a rejected asynchronous observation remains detached from existing signing", async () => {
  let calls = 0, observations = 0;
  assert.deepEqual(await signWalletTypedDataGroup([payload], async () => { calls++; return signature; }, undefined,
    { requestNext: () => {}, signatureFulfilled: async () => { observations++; throw new Error("observer unavailable"); } }), [signature]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(observations, 1);
});

test("rejected signing retains the original error and does not invent a fulfilled request", async () => {
  const rejected = { code: 4001, message: "private rejected response" };
  let calls = 0, observations = 0;
  await assert.rejects(signWalletTypedDataGroup([payload, payload, payload], async () => {
    if (++calls === 2) throw rejected;
    return signature;
  }, undefined, { requestNext: () => {}, signatureFulfilled: () => { observations++; } }), error => error === rejected);
  assert.equal(calls, 2); assert.equal(observations, 1);
});

test("an empty signing group makes no wallet request or completion observation", async () => {
  assert.deepEqual(await signWalletTypedDataGroup([], async () => { assert.fail("No request"); }, undefined,
    { requestNext: () => { assert.fail("No request"); }, signatureFulfilled: () => { assert.fail("No completion"); } }), []);
});
