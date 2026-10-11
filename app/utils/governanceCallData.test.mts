import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";

import { decodeGovernanceCallData } from "./governanceCallData.ts";

test("decodeGovernanceCallData decodes Core two-step admin calls with named arguments", () => {
  const data = encodeFunctionData({
    abi: parseAbi(["function beginDefaultAdminTransfer(address newAdmin)"]),
    functionName: "beginDefaultAdminTransfer",
    args: ["0x00000000000000000000000000000000000000a1" as Address],
  });

  const decoded = decodeGovernanceCallData(data);
  assert.equal(decoded.kind, "decoded");
  if (decoded.kind !== "decoded") return;
  assert.equal(decoded.functionName, "beginDefaultAdminTransfer");
  assert.equal(decoded.functionSignature, "beginDefaultAdminTransfer(address)");
  assert.deepEqual(decoded.args, [
    {
      name: "newAdmin",
      type: "address",
      value: "0x00000000000000000000000000000000000000A1",
    },
  ]);
});

test("decodeGovernanceCallData decodes the canonical Staking claim-expiry width", () => {
  const data = encodeFunctionData({
    abi: parseAbi(["function setClaimExpiry(uint64 expirySeconds)"]),
    functionName: "setClaimExpiry",
    args: [86_400n],
  });

  const decoded = decodeGovernanceCallData(data);
  assert.equal(decoded.kind, "decoded");
  if (decoded.kind !== "decoded") return;
  assert.equal(decoded.functionSignature, "setClaimExpiry(uint64)");
  assert.deepEqual(decoded.args, [
    {
      name: "expirySeconds",
      type: "uint64",
      value: 86_400n,
    },
  ]);
});

test("decodeGovernanceCallData decodes guarded Staking performance-fee updates", () => {
  const data = encodeFunctionData({
    abi: parseAbi([
      "function setPerformanceFee(uint256 currentPerformanceFeePpm, uint256 newFeePpm)",
    ]),
    functionName: "setPerformanceFee",
    args: [30_000n, 25_000n],
  });

  const decoded = decodeGovernanceCallData(data);
  assert.equal(decoded.kind, "decoded");
  if (decoded.kind !== "decoded") return;
  assert.equal(decoded.functionSignature, "setPerformanceFee(uint256,uint256)");
  assert.deepEqual(decoded.args, [
    {
      name: "currentPerformanceFeePpm",
      type: "uint256",
      value: 30_000n,
    },
    {
      name: "newFeePpm",
      type: "uint256",
      value: 25_000n,
    },
  ]);
});

test("decodeGovernanceCallData decodes core max total supply updates", () => {
  const data = encodeFunctionData({
    abi: parseAbi([
      "function setMaxTotalSupply(uint256 currentMaxTotalSupply, uint256 newMaxTotalSupply)",
    ]),
    functionName: "setMaxTotalSupply",
    args: [250_000000000000000000n, 300_000000000000000000n],
  });

  const decoded = decodeGovernanceCallData(data);
  assert.equal(decoded.kind, "decoded");
  if (decoded.kind !== "decoded") return;
  assert.equal(decoded.functionName, "setMaxTotalSupply");
  assert.equal(decoded.functionSignature, "setMaxTotalSupply(uint256,uint256)");
  assert.deepEqual(decoded.args, [
    {
      name: "currentMaxTotalSupply",
      type: "uint256",
      value: 250_000000000000000000n,
    },
    {
      name: "newMaxTotalSupply",
      type: "uint256",
      value: 300_000000000000000000n,
    },
  ]);
});

test("decodeGovernanceCallData falls back cleanly for empty and unknown calldata", () => {
  const empty = decodeGovernanceCallData("0x");
  assert.deepEqual(empty, {
    kind: "empty",
    selector: undefined,
    rawData: "0x",
    args: [],
  });

  const unknown = decodeGovernanceCallData(`0x12345678deadbeef` as Hex);
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.selector, "0x12345678");
  assert.equal(unknown.rawData, "0x12345678deadbeef");
  assert.deepEqual(unknown.args, []);

  const removedEnableTransfers = decodeGovernanceCallData("0xaf35c6c7");
  assert.equal(removedEnableTransfers.kind, "unknown");
  assert.equal(removedEnableTransfers.selector, "0xaf35c6c7");
});
