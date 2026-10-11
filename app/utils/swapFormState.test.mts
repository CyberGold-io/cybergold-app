import assert from "node:assert/strict";
import test from "node:test";

import { normalizePersistedSwapFormState } from "./swapFormState.ts";

test("normalizePersistedSwapFormState keeps only valid persisted swap fields", () => {
  assert.deepEqual(
    normalizePersistedSwapFormState({
      isSellInputEnabled: true,
      showOnlyWalletTokens: false,
      sellAmount: "1 234,56",
      buyAmount: "10",
      sellTokenId: "usdc",
      buyTokenId: "cygld",
      driverToken: "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
      driverAmountStr: "5",
      invalid: "ignored",
    }),
    {
      isSellInputEnabled: true,
      showOnlyWalletTokens: false,
      sellAmount: "1 234,56",
      buyAmount: "10",
      sellTokenId: "usdc",
      buyTokenId: "cygld",
      driverToken: "0x45804880De22913dAFE09f4980848ECE6EcbAf78",
      driverAmountStr: "5",
    }
  );
});

test("normalizePersistedSwapFormState rejects invalid shapes", () => {
  assert.equal(normalizePersistedSwapFormState(null), null);
  assert.equal(normalizePersistedSwapFormState("invalid"), null);
  assert.deepEqual(
    normalizePersistedSwapFormState({
      driverToken: "not-an-address",
    }),
    {
      driverToken: undefined,
      isSellInputEnabled: undefined,
      showOnlyWalletTokens: undefined,
      sellAmount: undefined,
      buyAmount: undefined,
      sellTokenId: undefined,
      buyTokenId: undefined,
      driverAmountStr: undefined,
    }
  );
});
