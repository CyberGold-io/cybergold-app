import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePersistedSwapFormState,
  readPersistedSwapFormState,
  writePersistedSwapFormState,
} from "./swapFormState.ts";

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
      showOnlyWalletTokens: false,
      sellAmount: "1 234,56",
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
      showOnlyWalletTokens: undefined,
      sellAmount: undefined,
      sellTokenId: undefined,
      buyTokenId: undefined,
      driverAmountStr: undefined,
    }
  );
});

test("old output-driven drafts preserve pair and preferences while clearing amounts and basket driver", () => {
  assert.deepEqual(normalizePersistedSwapFormState({
    isSellInputEnabled: false,
    showOnlyWalletTokens: true,
    sellTokenId: "cygld", buyTokenId: "goldbasket",
    sellAmount: "quoted spend", buyAmount: "requested output",
    driverToken: "0x45804880De22913dAFE09f4980848ECE6EcbAf78", driverAmountStr: "9",
  }), {
    showOnlyWalletTokens: true,
    sellTokenId: "cygld", buyTokenId: "goldbasket",
    sellAmount: undefined, driverToken: undefined, driverAmountStr: undefined,
  });
});

test("an old exact-in draft and a current draft restore the same spend intent", () => {
  const draft = { sellTokenId: "goldbasket", buyTokenId: "cygld", sellAmount: "",
    driverToken: "0x45804880De22913dAFE09f4980848ECE6EcbAf78", driverAmountStr: "0,123456789012345678" };
  const normalized = normalizePersistedSwapFormState(draft)!;
  assert.equal(normalized.driverAmountStr, draft.driverAmountStr);
  assert.deepEqual(normalizePersistedSwapFormState({ ...draft, isSellInputEnabled: true, buyAmount: "stale estimate" }), normalized);
  assert.equal("buyAmount" in normalized, false);
  assert.equal("isSellInputEnabled" in normalized, false);
});

test("session writes use the existing key and store only a normalized input draft", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } } });
  try {
    const draft = { sellTokenId: "usdc", buyTokenId: "cygld", sellAmount: "12,5",
      buyAmount: "stale quote", isSellInputEnabled: true, ignored: "not persisted" };
    writePersistedSwapFormState(draft);
    assert.deepEqual([...storage.keys()], ["cg:swap-form-state:v1"]);
    assert.deepEqual(JSON.parse(storage.get("cg:swap-form-state:v1")!), {
      sellAmount: "12,5", sellTokenId: "usdc", buyTokenId: "cygld",
    });
    assert.deepEqual(readPersistedSwapFormState(), normalizePersistedSwapFormState(draft));
    storage.set("cg:swap-form-state:v1", "malformed");
    assert.equal(readPersistedSwapFormState(), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
