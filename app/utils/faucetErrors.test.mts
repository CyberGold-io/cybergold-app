import assert from "node:assert/strict";
import test from "node:test";
import { faucetFailureFeedback, faucetResponseError } from "./faucetErrors.ts";

const reference = "aa0ebe56-365d-4132-924d-aaed680e49e1";

test("uncertain and in-progress funding remain distinct without treating a generic conflict as a failed transfer", () => {
  for (const [code, messageKey] of [["REQUEST_UNCERTAIN", "fundFailedDescription"],
    ["REQUEST_IN_PROGRESS", "fundInProgress"], ["REQUEST_CONFLICT", "fundConflict"]]) {
    const error = faucetResponseError(new Response(null, { status: 409 }), { code, correlationId: reference });
    assert.equal(faucetFailureFeedback(error).messageKey, messageKey);
    assert.equal(faucetFailureFeedback(error).correlationId, reference);
  }
  assert.equal(faucetFailureFeedback(faucetResponseError(new Response(null, { status: 409 }),
    { error: "legacy conflict" })).messageKey, "fundFailedDescription");
});

test("quota feedback preserves a producer-supplied retry delay", () => {
  const error = faucetResponseError(new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
    { code: "ADDRESS_QUOTA_EXHAUSTED", correlationId: reference });
  assert.deepEqual(faucetFailureFeedback(error), {
    messageKey: "fundRateLimited", correlationId: reference, retryAfterSeconds: 60,
  });
  const response = new Response(null, { status: 502, headers: { "Retry-After": "60" } });
  assert.equal(faucetFailureFeedback(faucetResponseError(response, { code: "BAD_GATEWAY" })).retryAfterSeconds, undefined);
});

test("timeouts and interrupted replies do not assert that no funds were added", () => {
  for (const payload of [{ code: "TIMEOUT" }, { code: "INVALID_RESPONSE" }, undefined, null, "private failure text"]) {
    assert.equal(faucetFailureFeedback(faucetResponseError(new Response(null, { status: 504 }), payload))
      .messageKey, "fundFailedDescription");
  }
  assert.deepEqual(faucetFailureFeedback(new TypeError("network failed")), { messageKey: "fundFailedDescription" });
  assert.equal(faucetFailureFeedback(faucetResponseError(new Response(null, { status: 502 }),
    { code: "FUNDING_FAILED" })).messageKey, "fundIncomplete");
});

test("unknown or malformed diagnostic metadata cannot publish raw error text in feedback", () => {
  for (const payload of [{ code: "private-token", correlationId: "Bearer secret", error: "private body" },
    { code: "toString", correlationId: { unsafe: "private body" } }, [], false]) {
    const feedback = faucetFailureFeedback(faucetResponseError(new Response(null, { status: 500 }), payload));
    assert.equal(feedback.messageKey, "fundFailedDescription");
    assert.equal(feedback.correlationId, undefined);
    assert.doesNotMatch(JSON.stringify(feedback), /private|secret|Bearer/);
  }
});
