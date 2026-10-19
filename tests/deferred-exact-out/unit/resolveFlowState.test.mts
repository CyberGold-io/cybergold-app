import assert from "node:assert/strict";
import test from "node:test";

import { resolveFlowState } from "../../../app/utils/resolveFlowState.ts";

test("resolveFlowState resolves all supported exact-out flows", () => {
  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "goldbasket",
      buyTokenId: "cygld",
      isSellInputEnabled: false,
      hasBasketComponents: true,
    }),
    { direction: "issue", route: "basket", inputMode: "exact-out" }
  );

  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "cygld",
      buyTokenId: "goldbasket",
      isSellInputEnabled: false,
      hasBasketComponents: true,
    }),
    { direction: "redeem", route: "basket", inputMode: "exact-out" }
  );

  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "usdc",
      buyTokenId: "cygld",
      isSellInputEnabled: false,
      hasBasketComponents: true,
    }),
    { direction: "issue", route: "token", inputMode: "exact-out" }
  );

  assert.deepEqual(
    resolveFlowState({
      sellTokenId: "cygld",
      buyTokenId: "usdc",
      isSellInputEnabled: false,
      hasBasketComponents: true,
    }),
    { direction: "redeem", route: "token", inputMode: "exact-out" }
  );
});

