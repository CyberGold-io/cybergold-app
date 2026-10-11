import assert from "node:assert/strict";
import test from "node:test";

import type { erc20Token } from "../config/tokens.ts";
import { computeSwapBudgetsExactIn } from "./swapBudgets.ts";
import { tokenFlowAdapterState } from "./tokenFlowAdapterState.ts";
import { QuotePreviewError } from "./quoteErrors.ts";

const token: erc20Token = {
  id: "asset", symbol: "ASSET", name: "Asset", type: "erc20", decimals: 18,
  address: "0x0000000000000000000000000000000000000001",
};
const unavailableApproval = {
  data: undefined, isSuccess: false, isError: true, isLoading: false, isFetching: false,
};

test("direct issuance remains available with a missing or unavailable adapter", () => {
  const plan = computeSwapBudgetsExactIn({
    inputToken: token.address,
    inputAmount: 1_000n,
    components: [
      { token, targetWeight: 10_000n },
      { token: { ...token, address: "0x0000000000000000000000000000000000000002" },
        targetWeight: 0n },
    ],
  });
  assert.ok(plan);
  for (const hasConfiguredAdapter of [false, true]) {
    assert.deepEqual(tokenFlowAdapterState({
      requiresSwapAdapter: plan.budgets.length > 0,
      hasConfiguredAdapter,
      approval: unavailableApproval,
    }), { ready: true, pending: false, error: undefined });
  }
});

test("an unavailable adapter read reports the returned RPC cause rather than an opaque approval error", () => {
  assert.equal(tokenFlowAdapterState({ requiresSwapAdapter: true, hasConfiguredAdapter: true,
    approval: { ...unavailableApproval, error: new QuotePreviewError("rpc-timeout", "rpc-timeout") },
  }).error, "quoteRpcTimeout");
});

test("a direct redemption with recovery-share outputs is independent of adapter approval", () => {
  // The flow filters direct ERC-20 outputs and ERC-1155 recovery shares out of its swap legs.
  assert.deepEqual(tokenFlowAdapterState({
    requiresSwapAdapter: false,
    hasConfiguredAdapter: true,
    approval: { ...unavailableApproval, data: false, isSuccess: true, isError: false },
  }), { ready: true, pending: false, error: undefined });
});

test("an external input route still requires a currently approved adapter", () => {
  const plan = computeSwapBudgetsExactIn({
    inputToken: "0x0000000000000000000000000000000000000003",
    inputAmount: 1_000n,
    components: [{ token, targetWeight: 10_000n }],
  });
  assert.ok(plan);
  const state = (approval: typeof unavailableApproval | {
    data: boolean; isSuccess: boolean; isError: boolean; isLoading: boolean; isFetching: boolean;
  }, hasConfiguredAdapter = true) => tokenFlowAdapterState({
    requiresSwapAdapter: plan.budgets.length > 0, hasConfiguredAdapter, approval,
  });
  assert.equal(state(unavailableApproval, false).error, "tokenSwapAdapterInvalid");
  assert.equal(state(unavailableApproval).error, "tokenSwapAdapterApprovalUnavailable");
  const approved = { ...unavailableApproval, data: true, isSuccess: true, isError: false };
  assert.equal(state({ ...approved, data: false }).error, "tokenSwapAdapterNotApproved");
  assert.equal(state(approved).ready, true);
  assert.equal(state({ ...approved, isSuccess: false, isError: true }).ready, false);
});
