import assert from "node:assert/strict";
import test from "node:test";

import { resolveFlowState } from "./resolveFlowState.ts";

test("resolveFlowState resolves all supported exact-in flows", () => {
  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "goldbasket",
      buyTokenId: "cygld",
      isSellInputEnabled: true,
      hasBasketComponents: true,
    }),
    { direction: "issue", route: "basket", inputMode: "exact-in" }
  );

  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "cygld",
      buyTokenId: "goldbasket",
      isSellInputEnabled: true,
      hasBasketComponents: true,
    }),
    { direction: "redeem", route: "basket", inputMode: "exact-in" }
  );

  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "usdc",
      buyTokenId: "cygld",
      isSellInputEnabled: true,
      hasBasketComponents: true,
    }),
    { direction: "issue", route: "token", inputMode: "exact-in" }
  );

  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "cygld",
      buyTokenId: "usdc",
      isSellInputEnabled: true,
      hasBasketComponents: true,
    }),
    { direction: "redeem", route: "token", inputMode: "exact-in" }
  );
});

test("resolveFlowState defaults an active form to its spend intent", () => {
  assert.deepEqual(resolveFlowState({ sellTokenId: "usdc", buyTokenId: "cygld", hasBasketComponents: true }),
    { direction: "issue", route: "token", inputMode: "exact-in" });
});

test("resolveFlowState rejects unavailable or unsupported flows", () => {
  assert.equal(
    resolveFlowState({
      sellTokenId: "goldbasket",
      buyTokenId: "cygld",
      isSellInputEnabled: true,
      hasBasketComponents: false,
    }),
    undefined
  );

  assert.equal(
    resolveFlowState({
      sellTokenId: "usdc",
      buyTokenId: "usdt",
      isSellInputEnabled: true,
      hasBasketComponents: true,
    }),
    undefined
  );

  assert.equal(
    resolveFlowState({
      sellTokenId: "cygld",
      buyTokenId: "cygld",
      isSellInputEnabled: true,
      hasBasketComponents: true,
    }),
    undefined
  );

  assert.equal(
    resolveFlowState({
      sellTokenId: undefined,
      buyTokenId: "cygld",
      isSellInputEnabled: true,
      hasBasketComponents: true,
    }),
    undefined
  );
});

test("resolveFlowState supports custom token ids", () => {
  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "basket",
      buyTokenId: "cybergold",
      isSellInputEnabled: true,
      hasBasketComponents: true,
      cygldTokenId: "cybergold",
      basketTokenId: "basket",
    }),
    { direction: "issue", route: "basket", inputMode: "exact-in" }
  );
});
