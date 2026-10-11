import assert from "node:assert/strict";
import test from "node:test";
import { fetchGovernanceAuthorityFacts, governanceAuthorityFlag, governanceSafeWallet, type GovernanceAuthorityFacts } from "./governanceAuthorityFacts.ts";

const owner = `0x${"1".repeat(40)}` as const;
const safe = `0x${"2".repeat(40)}` as const;
const success = <T,>(value: T) => ({ status: "success" as const, value });
const facts: GovernanceAuthorityFacts = { context: { chainId: 31338, blockNumber: "101", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1", observedAt: "2026-10-02T00:00:00Z" },
  surface: "core", address: owner, account: owner, safeWallet: success(safe), paused: success(false),
  accountCanPause: success(true), accountCanUnpause: success(false), safeCanUnpause: success(true) };

test("configured surface/account observation uses a fixed no-store route and caller cancellation", async () => {
  for (const surface of ["core", "staking", "governance-diamond"] as const) {
    const signal = new AbortController().signal;
    assert.deepEqual(await fetchGovernanceAuthorityFacts(surface, owner, signal, (async (url, init) => {
      assert.equal(url, `/api/governance/authority?surface=${surface}&account=${owner}`);
      assert.equal(init?.cache, "no-store"); assert.equal(init?.signal, signal);
      assert.equal(new Headers(init?.headers).has("authorization"), false);
      return Response.json(facts);
    }) as typeof fetch), facts);
  }
});

test("disconnected authority lookup omits the account rather than inventing a principal", async () => {
  await fetchGovernanceAuthorityFacts("staking", undefined, undefined, (async (url) => {
    assert.equal(url, "/api/governance/authority?surface=staking"); return Response.json(facts);
  }) as typeof fetch);
});

test("false pause and permission results remain distinct from unavailable facts", () => {
  assert.equal(governanceAuthorityFlag(facts, "paused"), false);
  assert.equal(governanceAuthorityFlag(facts, "accountCanUnpause"), false);
  assert.equal(governanceAuthorityFlag(facts, "accountCanPause"), true);
  assert.equal(governanceAuthorityFlag({ ...facts, paused: { status: "failure", error: "contract-read-failed" } }, "paused"), undefined);
  assert.equal(governanceAuthorityFlag(undefined, "safeCanUnpause"), undefined);
});

test("Safe authority failure is neither a zero address nor a new authority", () => {
  assert.equal(governanceSafeWallet(facts), safe);
  assert.equal(governanceSafeWallet({ ...facts, safeWallet: success(`0x${"0".repeat(40)}`) }), `0x${"0".repeat(40)}`);
  assert.throws(() => governanceSafeWallet({ ...facts, safeWallet: { status: "failure", error: "not-configured" } }), /temporarily unavailable/);
});

test("provider failure makes one attempt without browser RPC fallback", async () => {
  let count = 0;
  await assert.rejects(fetchGovernanceAuthorityFacts("core", owner, undefined, (async () => {
    count++; return Response.json({ error: "unavailable" }, { status: 503 });
  }) as typeof fetch), /temporarily unavailable/);
  assert.equal(count, 1);
});
