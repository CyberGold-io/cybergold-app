import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import {
  observeApprovalConfirmation,
  preparePermitWithPendingApproval,
} from "./pendingApproval.ts";

const signedPermit = { signature: "0x1234", nonce: 3n } as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function trackSettlement(promise: Promise<unknown>) {
  let settled = false;
  void promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  return () => settled;
}

test("Permit2 signing starts while approval is pending; the signed permit waits for confirmation", async () => {
  const receipt = deferred<unknown>();
  const signature = deferred<typeof signedPermit>();
  let signingRequests = 0;
  const operation = preparePermitWithPendingApproval(
    observeApprovalConfirmation(receipt.promise),
    () => {
      signingRequests++;
      return signature.promise;
    },
  );
  const isSettled = trackSettlement(operation);
  assert.equal(signingRequests, 1, "request signing without waiting for the receipt");

  signature.resolve(signedPermit);
  await setImmediate();
  assert.equal(isSettled(), false, "do not release the permit to swap before approval confirms");

  receipt.resolve({ status: "success" });
  assert.equal(await operation, signedPermit);
  assert.equal(signingRequests, 1);
});

test("an approval confirming first still waits for the wallet signature", async () => {
  const receipt = deferred<unknown>();
  const signature = deferred<typeof signedPermit>();
  const operation = preparePermitWithPendingApproval(
    observeApprovalConfirmation(receipt.promise),
    () => signature.promise,
  );
  const isSettled = trackSettlement(operation);

  receipt.resolve({ status: "success" });
  await setImmediate();
  assert.equal(isSettled(), false);

  signature.resolve(signedPermit);
  assert.equal(await operation, signedPermit);
});

test("an early receipt failure is handled while signing is pending and prevents returning the permit", async () => {
  const receipt = deferred<unknown>();
  const signature = deferred<typeof signedPermit>();
  const receiptError = new Error("Approval confirmation observations unavailable");
  const operation = preparePermitWithPendingApproval(
    observeApprovalConfirmation(receipt.promise),
    () => signature.promise,
  );
  const isSettled = trackSettlement(operation);

  receipt.reject(receiptError);
  await setImmediate();
  assert.equal(isSettled(), false, "keep the current wallet prompt active until it settles");

  const rejectedOperation = assert.rejects(operation, error => error === receiptError);
  signature.resolve(signedPermit);
  await rejectedOperation;
});

test("rejecting the signature returns promptly and a later receipt rejection stays handled", async () => {
  const receipt = deferred<unknown>();
  const signature = deferred<typeof signedPermit>();
  const signatureError = Object.assign(new Error("User rejected the request"), { code: 4001 });
  const receiptError = new Error("Later approval receipt observation failure");
  const confirmation = observeApprovalConfirmation(receipt.promise);
  const operation = preparePermitWithPendingApproval(confirmation, () => signature.promise);

  const rejectedOperation = assert.rejects(operation, error => error === signatureError);
  signature.reject(signatureError);
  await rejectedOperation;

  receipt.reject(receiptError);
  // Yield a complete event-loop turn so an unhandled rejection would fail this test.
  await setImmediate();
  assert.deepEqual(await confirmation, { status: "rejected", reason: receiptError });
});

test("a flow with no pending approval requests signing immediately and returns its original permit", async () => {
  const requests: string[] = [];
  const operation = preparePermitWithPendingApproval(
    observeApprovalConfirmation(Promise.resolve()),
    async () => {
      requests.push("signature");
      return signedPermit;
    },
  );
  assert.deepEqual(requests, ["signature"]);
  assert.equal(await operation, signedPermit);
});
