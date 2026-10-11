import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { resolveOwnerAuthorityProbe } from "./governanceAuthority.ts";
import { fetchGovernanceSafePrincipal, safePrincipalCode, safePrincipalOwners,
  safePrincipalThreshold, type GovernanceSafePrincipal } from "./governanceSafePrincipal.ts";
const address = "0x00000000000000000000000000000000000000a1" as Address;
const success = <T,>(value: T) => ({ status: "success" as const, value });
const failure = { status: "failure" as const, error: "contract-read-failed" as const };
function facts(): GovernanceSafePrincipal { return {
  context: { chainId: 31338, blockNumber: "100", blockHash: `0x${"a".repeat(64)}`,
    blockTimestamp: "1800000000", observedAt: "2026-10-01T00:00:00Z" },
  address, code: success("0x6000"), owners: success([address]), threshold: success((2n ** 200n).toString()),
}; }

test("Safe fields preserve lossless threshold and independent partial-read failures", () => {
  const payload = facts();
  assert.equal(safePrincipalThreshold(payload), 2n ** 200n);
  payload.owners = failure;
  assert.throws(() => safePrincipalOwners(payload), /owners.*unavailable/);
  assert.equal(safePrincipalCode(payload), "0x6000");
  assert.equal(safePrincipalThreshold(payload), 2n ** 200n);
  payload.threshold = failure;
  assert.throws(() => safePrincipalThreshold(payload), /threshold.*unavailable/);
});

test("known empty bytecode preserves direct owner authority; failed code never becomes an EOA", () => {
  const payload = facts(); payload.code = success("0x"); payload.owners = failure; payload.threshold = failure;
  assert.equal(resolveOwnerAuthorityProbe({ authorityAddress: address, bytecode: safePrincipalCode(payload),
    codeProbeStatus: "success", safeOwners: [], safeProbeStatus: "idle" }).source, "owner-direct");
  payload.code = failure;
  assert.throws(() => safePrincipalCode(payload), /bytecode probe failed/);
  assert.equal(resolveOwnerAuthorityProbe({ authorityAddress: address,
    codeProbeStatus: "error", safeOwners: [], safeProbeStatus: "idle" }).source, "unknown");
});

test("fixed Safe principal fetch passes address and cancellation without browser credentials or RPC fallback", async () => {
  const controller = new AbortController(); let calls = 0;
  await fetchGovernanceSafePrincipal(address, controller.signal, (async (url, init) => {
    calls++; assert.equal(url, `/api/governance/safe-principal?address=${address}`);
    assert.equal(init?.signal, controller.signal); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return Response.json(facts());
  }) as typeof fetch);
  await assert.rejects(fetchGovernanceSafePrincipal(address, undefined, (async () => {
    calls++; return new Response(null, { status: 503 });
  }) as typeof fetch), /temporarily unavailable/);
  assert.equal(calls, 2);
});
