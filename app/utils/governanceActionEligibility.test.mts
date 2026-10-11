import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import {
  governanceActionEligibility,
  governancePauseActionEligibility,
  noArgFunctionName,
  type GovernanceActionPrincipal,
} from "./governanceActionEligibility.ts";

const connected = "0x1111111111111111111111111111111111111111" as Address;
const safe = "0x2222222222222222222222222222222222222222" as Address;
const outsider = "0x3333333333333333333333333333333333333333" as Address;

test("noArgFunctionName accepts only zero-argument function signatures", () => {
  assert.equal(noArgFunctionName("pause()"), "pause");
  assert.equal(noArgFunctionName(" unpause() "), "unpause");
  assert.equal(noArgFunctionName("setFee(uint256)"), undefined);
  assert.equal(noArgFunctionName("not a signature"), undefined);
});

test("governanceActionEligibility detects direct role membership", () => {
  const result = governanceActionEligibility({
    functionSignature: "pause()",
    roleMembers: [connected],
    principalsByAddress: new Map(),
    connectedAddress: connected,
  });

  assert.equal(result.supportsDirectSubmit, true);
  assert.equal(result.canDirectCall, true);
  assert.equal(result.eligibleSafes.length, 0);
});

test("governanceActionEligibility detects Safe-backed permissions", () => {
  const safePrincipal = {
    address: safe,
    kind: "safe",
    connectedIsOwner: true,
  } satisfies GovernanceActionPrincipal;

  const result = governanceActionEligibility({
    functionSignature: "pause()",
    roleMembers: [safe],
    principalsByAddress: new Map([[safe.toLowerCase(), safePrincipal]]),
    connectedAddress: connected,
  });

  assert.equal(result.canDirectCall, false);
  assert.deepEqual(result.eligibleSafes, [safePrincipal]);
});

test("governanceActionEligibility keeps parameterized actions form-gated", () => {
  const result = governanceActionEligibility({
    functionSignature: "setBasket(address[],uint256[],uint256[])",
    roleMembers: [connected, safe],
    principalsByAddress: new Map([
      [
        safe.toLowerCase(),
        {
          address: safe,
          kind: "safe",
          connectedIsOwner: true,
        },
      ],
    ]),
    connectedAddress: connected,
  });

  assert.equal(result.supportsDirectSubmit, false);
  assert.equal(result.functionName, undefined);
  assert.equal(result.canDirectCall, true);
  assert.equal(result.eligibleSafes.length, 1);
});

test("governanceActionEligibility ignores Safes where the wallet is not an owner", () => {
  const result = governanceActionEligibility({
    functionSignature: "pause()",
    roleMembers: [safe],
    principalsByAddress: new Map([
      [
        safe.toLowerCase(),
        {
          address: safe,
          kind: "safe",
          connectedIsOwner: false,
        },
      ],
    ]),
    connectedAddress: outsider,
  });

  assert.equal(result.canDirectCall, false);
  assert.equal(result.eligibleSafes.length, 0);
});

test("governance pause eligibility follows Safe-owner emergency authority", () => {
  const pause = governancePauseActionEligibility("pause()", {
    connectedCanPause: true,
    connectedCanUnpause: false,
    configuredSafe: safe,
    configuredSafeCanUnpause: true,
    connectedIsConfiguredSafeOwner: true,
  });
  assert.equal(pause.canDirectCall, true);
  assert.deepEqual(pause.eligibleSafes, []);

  const unpause = governancePauseActionEligibility("unpause()", {
    connectedCanPause: true,
    connectedCanUnpause: false,
    configuredSafe: safe,
    configuredSafeCanUnpause: true,
    connectedIsConfiguredSafeOwner: true,
  });
  assert.equal(unpause.canDirectCall, false);
  assert.deepEqual(unpause.eligibleSafes, [
    { address: safe, kind: "safe", connectedIsOwner: true },
  ]);
});

test("governance unpause fails closed for outsiders and rejected Safes", () => {
  for (const authority of [
    {
      connectedCanPause: false,
      connectedCanUnpause: false,
      configuredSafe: safe,
      configuredSafeCanUnpause: true,
      connectedIsConfiguredSafeOwner: false,
    },
    {
      connectedCanPause: false,
      connectedCanUnpause: false,
      configuredSafe: safe,
      configuredSafeCanUnpause: false,
      connectedIsConfiguredSafeOwner: true,
    },
  ]) {
    const result = governancePauseActionEligibility("unpause()", authority);
    assert.equal(result.canDirectCall, false);
    assert.deepEqual(result.eligibleSafes, []);
  }
});
