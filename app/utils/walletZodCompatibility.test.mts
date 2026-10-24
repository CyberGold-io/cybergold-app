import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { CreatePolicyBodySchema } from "@coinbase/cdp-sdk";
import { W3mFrameSchema } from "@reown/appkit-wallet";

const require = createRequire(import.meta.url);
const address = `0x${"11".repeat(20)}`;

test("AppKit preserves optional RPC fields and both supported chain-id formats", () => {
  for (const method of ["wallet_revokePermissions", "wallet_getAssets"]) {
    const request = { type: "@w3m-app/RPC_REQUEST", payload: { method } };
    assert.deepEqual(W3mFrameSchema.appEvent.parse(request), request);
  }
  const response = { id: "request-1", type: "@w3m-frame/RPC_REQUEST_SUCCESS" };
  assert.deepEqual(W3mFrameSchema.frameEvent.parse(response), response);
  for (const chainId of [31338, "eip155:31338"]) {
    const request = { type: "@w3m-app/SWITCH_NETWORK", payload: { chainId } };
    assert.deepEqual(W3mFrameSchema.appEvent.parse(request), request);
  }
  assert.equal(W3mFrameSchema.appEvent.safeParse({
    type: "@w3m-app/SWITCH_NETWORK", payload: { chainId: null },
  }).success, false);
});

test("CDP policies validate nonempty ABIs through their installed ABI schema", () => {
  const policy = {
    scope: "account",
    rules: [{
      action: "accept",
      operation: "signEvmTransaction",
      criteria: [{
        type: "evmData",
        abi: [{
          type: "function", name: "transfer", stateMutability: "nonpayable",
          inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
          outputs: [{ name: "", type: "bool" }],
        }],
        conditions: [{
          function: "transfer", params: [{ name: "to", operator: "==", value: address }],
        }],
      }],
    }],
  };
  const malformed = structuredClone(policy);
  malformed.rules[0].criteria[0].abi[0].inputs[0].type = "invalid-solidity-type";
  // CDP publishes both formats; its CommonJS path also resolves abitype's
  // CommonJS export and must remain usable after regenerating declarations.
  for (const schema of [CreatePolicyBodySchema, require("@coinbase/cdp-sdk").CreatePolicyBodySchema]) {
    assert.deepEqual(schema.parse(policy), policy);
    assert.equal(schema.safeParse(malformed).success, false);
  }
});

test("wallet and test consumers reject oversized bounded arrays before parsing their items", () => {
  // Two small elements reproduce the advisory's ordering defect without
  // allocating an attack-sized input or imposing new application limits.
  for (const name of [
    "@reown/appkit-wallet", "@coinbase/cdp-sdk",
    "@synthetixio/synpress-cache", "@synthetixio/synpress-metamask/playwright",
  ]) {
    const consumerRequire = createRequire(require.resolve(name));
    const { z } = consumerRequire("zod");
    let parsedItems = 0;
    const schema = z.array(z.string().transform((value: string) => {
      parsedItems += 1;
      return value;
    })).max(1);
    assert.equal(schema.safeParse(["one", "two"]).success, false, name);
    assert.equal(parsedItems, 0, `${name} must check the existing bound first`);
    assert.deepEqual(schema.parse(["one"]), ["one"]);
    assert.equal(parsedItems, 1);
  }
});
