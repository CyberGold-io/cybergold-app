import assert from "node:assert/strict";
import test from "node:test";
import { coreConfigFromFacts, coreSafeWalletFromFacts, fetchGovernanceCoreFacts, type GovernanceCoreFacts } from "./governanceCoreFacts.ts";
const success = <T,>(value: T) => ({ status: "success" as const, value });
const failure = { status: "failure" as const, error: "contract-read-failed" as const };
function facts(): GovernanceCoreFacts { return {
  context: { chainId: 31338, blockNumber: "101", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1800000000", observedAt: "2026-10-01T00:00:00Z" },
  core: `0x${"4".repeat(40)}`, configuration: { treasury: success(`0x${"6".repeat(40)}`), basketConfigHash: success(`0x${"7".repeat(64)}`),
    issuanceFeePpm: success("0"), redemptionFeePpm: success("15"), maxFeePpm: success("1000000"), maxTotalSupply: success((2n**255n).toString()), totalSupply: success((2n**200n).toString()) } }; }

test("governance configuration retains wide amounts, zero fees and original field failures", () => {
  const payload = facts();
  assert.equal(coreConfigFromFacts(payload)?.maxTotalSupply, 2n**255n);
  assert.equal(coreConfigFromFacts(payload)?.issuanceFeePpm, 0n);
  payload.configuration.totalSupply = failure;
  assert.equal(coreConfigFromFacts(payload)?.totalSupply, undefined);
  assert.equal(coreConfigFromFacts(payload)?.maxTotalSupply, 2n**255n);
  payload.configuration.treasury = failure;
  assert.equal(coreConfigFromFacts(payload), undefined);
  assert.equal(coreConfigFromFacts(), undefined);
});
test("zero treasury remains an undefined address in the existing configuration shape", () => {
  const payload = facts(); payload.configuration.treasury = success("0x0000000000000000000000000000000000000000");
  assert.equal(coreConfigFromFacts(payload)?.treasury, undefined);
  assert.equal(coreConfigFromFacts(payload)?.totalSupply, 2n**200n);
});
test("Core Safe authority preserves configured addresses/zero and rejects failed or retained missing observations", () => {
  const payload = facts();
  assert.throws(() => coreSafeWalletFromFacts(payload), /temporarily unavailable/);
  payload.configuration.safeWallet = success("0x0000000000000000000000000000000000000000");
  assert.equal(coreSafeWalletFromFacts(payload), "0x0000000000000000000000000000000000000000");
  payload.configuration.safeWallet = success(`0x${"8".repeat(40)}`);
  assert.equal(coreSafeWalletFromFacts(payload), `0x${"8".repeat(40)}`);
  payload.configuration.safeWallet = failure;
  assert.throws(() => coreSafeWalletFromFacts(payload), /temporarily unavailable/);
  assert.equal(coreConfigFromFacts(payload)?.maxTotalSupply, 2n**255n);
});
test("fixed API fetch propagates cancellation and never uses a browser bearer or RPC fallback", async () => {
  const controller = new AbortController(); let calls = 0;
  await fetchGovernanceCoreFacts(controller.signal, (async (url, init) => {
    calls++; assert.equal(url, "/api/governance/core-facts"); assert.equal(init?.signal, controller.signal);
    assert.equal(init?.cache, "no-store"); assert.equal(new Headers(init?.headers).has("authorization"), false);
    return Response.json(facts());
  }) as typeof fetch);
  await assert.rejects(fetchGovernanceCoreFacts(undefined, (async () => { calls++; return new Response(null, { status: 503 }); }) as typeof fetch), /temporarily unavailable/);
  assert.equal(calls, 2);
});
