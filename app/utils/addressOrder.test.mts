import assert from "node:assert/strict";
import test from "node:test";

import { sameAddressOrder } from "./addressOrder.ts";

const FIRST = "0x0000000000000000000000000000000000000001";
const SECOND = "0x0000000000000000000000000000000000000002";

test("sameAddressOrder accepts only an exact case-insensitive positional match", () => {
  assert.equal(sameAddressOrder([FIRST, SECOND], [FIRST, SECOND]), true);
  assert.equal(
    sameAddressOrder([FIRST.toUpperCase(), SECOND], [FIRST, SECOND]),
    true
  );
  assert.equal(sameAddressOrder([SECOND, FIRST], [FIRST, SECOND]), false);
  assert.equal(sameAddressOrder([FIRST], [FIRST, SECOND]), false);
  assert.equal(sameAddressOrder(undefined, [FIRST, SECOND]), false);
});
