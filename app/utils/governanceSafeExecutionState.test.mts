import assert from "node:assert/strict";
import test from "node:test";

import {
  finalHistoryStatusFromLocalState,
  isLocalSafeExecutionState,
  resolveLocalSafeExecutionState,
} from "./governanceSafeExecutionState.ts";

test("isLocalSafeExecutionState recognizes supported execution states", () => {
  assert.equal(isLocalSafeExecutionState("submitted"), true);
  assert.equal(isLocalSafeExecutionState("executed"), true);
  assert.equal(isLocalSafeExecutionState("bogus"), false);
});

test("finalHistoryStatusFromLocalState only returns final Safe outcomes", () => {
  assert.equal(finalHistoryStatusFromLocalState("executed"), "executed");
  assert.equal(finalHistoryStatusFromLocalState("failed"), "failed");
  assert.equal(finalHistoryStatusFromLocalState("replaced"), undefined);
  assert.equal(finalHistoryStatusFromLocalState("submitted"), undefined);
});

test("resolveLocalSafeExecutionState prefers verified Safe event status", () => {
  assert.equal(resolveLocalSafeExecutionState({ safeEventStatus: "executed" }), "executed");
  assert.equal(resolveLocalSafeExecutionState({ safeEventStatus: "failed" }), "failed");
});

test("resolveLocalSafeExecutionState falls back to replacement reason when Safe event is absent", () => {
  assert.equal(resolveLocalSafeExecutionState({ replacementReason: "repriced" }), "repriced");
  assert.equal(resolveLocalSafeExecutionState({ replacementReason: "replaced" }), "replaced");
  assert.equal(resolveLocalSafeExecutionState({ replacementReason: "cancelled" }), "cancelled");
  assert.equal(resolveLocalSafeExecutionState({}), "unknown");
});
