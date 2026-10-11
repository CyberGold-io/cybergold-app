import assert from "node:assert/strict";
import test from "node:test";

import {
  SWAP_DEADLINE_TTL_SEC,
  applySlippageCeil,
  applySlippageFloor,
  buildDeadline,
  buildQuoteDeadline,
} from "./swapPolicy.ts";

test("slippage floors remain nonzero for active execution legs", () => {
  assert.equal(applySlippageFloor(0n), 0n);
  assert.equal(applySlippageFloor(1n), 1n);
  assert.equal(applySlippageFloor(10_000n), 9_900n);
});

test("slippage ceilings conservatively round exact-output maximum inputs up", () => {
  assert.equal(applySlippageCeil(0n), 0n);
  assert.equal(applySlippageCeil(1n), 2n);
  assert.equal(applySlippageCeil(10_000n), 10_100n);
  assert.equal(applySlippageCeil(10_001n), 10_102n);
});

test("selected execution tolerance adjusts bounds with exact integer rounding", () => {
  for (const [bps, minimum, maximum] of [[0, 10_000n, 10_000n], [10, 9_990n, 10_010n],
    [100, 9_900n, 10_100n], [300, 9_700n, 10_300n]] as const) {
    assert.equal(applySlippageFloor(10_000n, bps), minimum);
    assert.equal(applySlippageCeil(10_000n, bps), maximum);
  }
  assert.equal(applySlippageFloor(10_001n, 10), 9_990n);
  assert.equal(applySlippageCeil(10_001n, 10), 10_012n);
  const wide = 10n ** 40n;
  assert.equal(applySlippageFloor(wide, 37), wide * 9_963n / 10_000n);
  assert.equal(applySlippageCeil(wide, 37), wide * 10_037n / 10_000n);
});

test("execution deadlines use the bounded ten-minute policy", () => {
  const before = BigInt(Math.floor(Date.now() / 1000));
  const deadline = buildDeadline();
  const after = BigInt(Math.floor(Date.now() / 1000));

  assert.ok(deadline >= before + SWAP_DEADLINE_TTL_SEC);
  assert.ok(deadline <= after + SWAP_DEADLINE_TTL_SEC);
  assert.ok(SWAP_DEADLINE_TTL_SEC <= 60n * 60n);
});


test("preview deadlines survive revisits only within their ten-second head scope", t => {
  let elapsed = 100;
  t.mock.method(performance, "now", () => elapsed);
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const first = buildQuoteDeadline("test:head:a");
  t.mock.timers.tick(5_000); elapsed += 5_000;
  assert.equal(buildQuoteDeadline("test:head:a"), first);
  assert.notEqual(buildQuoteDeadline("test:head:b"), first);
  t.mock.timers.tick(5_000); elapsed += 5_000;
  assert.notEqual(buildQuoteDeadline("test:head:a"), first);
});
