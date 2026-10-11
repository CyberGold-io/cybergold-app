import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, stringToHex } from "viem";
import { EMPTY_BYTES32, governanceRoleHash } from "./governanceRoleHash.ts";

test("governanceRoleHash returns the zero role for DEFAULT_ADMIN_ROLE", () => {
  assert.equal(governanceRoleHash("DEFAULT_ADMIN_ROLE"), EMPTY_BYTES32);
});

test("governanceRoleHash hashes non-default roles with keccak256", () => {
  assert.equal(governanceRoleHash("PAUSER_ROLE"), keccak256(stringToHex("PAUSER_ROLE")));
});
