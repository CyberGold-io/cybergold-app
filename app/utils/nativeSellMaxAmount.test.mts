import assert from "node:assert/strict";
import test from "node:test";
import { nativeSellMaxAmount } from "./nativeSellMaxAmount.ts";

test("native MAX deducts the fee-cap budget once and preserves every wei", () => {
  const balance = 1_234_567_890_123_456_789n;
  const gas = 415_000n;
  const baseFee = 2_000_000_000n;
  const priorityFee = 1_000_000_000n;
  const feeCap = baseFee * 12n / 10n + priorityFee;
  const maximum = nativeSellMaxAmount(balance, gas * feeCap);
  assert.equal(maximum, 1_233_156_890_123_456_789n);
  assert.equal(balance - maximum, gas * feeCap);
});

test("native MAX is zero when the balance only covers gas or less", () => {
  assert.equal(nativeSellMaxAmount(100n, 100n), 0n);
  assert.equal(nativeSellMaxAmount(99n, 100n), 0n);
  assert.equal(nativeSellMaxAmount(0n, 100n), 0n);
});

test("native MAX retains the full balance for an actual zero fee budget", () => {
  assert.equal(nativeSellMaxAmount(123n, 0n), 123n);
});

test("native MAX handles balances beyond JavaScript number precision", () => {
  const balance = 2n ** 200n + 321n;
  const gasBudget = 2n ** 70n + 123n;
  assert.equal(nativeSellMaxAmount(balance, gasBudget), 2n ** 200n - 2n ** 70n + 198n);
});
