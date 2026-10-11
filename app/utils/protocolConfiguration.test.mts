import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, zeroAddress } from "viem";
import { QueryClient } from "@tanstack/react-query";
import { fetchProtocolConfiguration, protocolConfigurationValues, requireProtocolAddress,
  assertObservedAddress } from "./protocolConfiguration.ts";
import { protocolConfigurationFixture as configured, protocolAddresses } from "../../tests/fixtures/protocol-configuration.ts";

const changedHelpers = "0x0000000000000000000000000000000000000009" as const;
test("Backend roots and catalog replace deployment environment settings, preserving optional availability", () => {
  const normalized = protocolConfigurationValues(configured);
  assert.equal(normalized.addresses.core, getAddress(protocolAddresses.core));
  assert.equal(normalized.addresses.helpers, getAddress(protocolAddresses.helpers));
  assert.equal(normalized.addresses.adapter, getAddress(protocolAddresses.adapter));
  assert.equal(normalized.addresses.governance, undefined);
  assert.equal(normalized.tokens.length, 7);
  assert.equal(normalized.tokenAddresses.CYGLD, normalized.addresses.core);
  const partial = protocolConfigurationValues({ ...configured, contracts: { ...configured.contracts, helpers: null, uniswapAdapter: null } });
  assert.equal(partial.addresses.helpers, undefined); assert.equal(partial.tokens.length, 7);
  assert.equal(partial.addresses.core, normalized.addresses.core);
});

test("a changed target or fork generation creates a new identity, while observation timestamps do not", () => {
  const first = protocolConfigurationValues(configured);
  const changed = protocolConfigurationValues({ ...configured, contracts: { ...configured.contracts, helpers: changedHelpers } });
  const reset = protocolConfigurationValues({ ...configured, sandboxForkGeneration: "reset-two" });
  const refreshed = protocolConfigurationValues({ ...configured, adapter: { ...configured.adapter,
    observation: { blockNumber: "999", blockHash: `0x${"a".repeat(64)}`, observedAt: "2026-10-11T00:00:00Z" } } });
  assert.notEqual(first.identity, changed.identity); assert.notEqual(first.identity, reset.identity);
  assert.equal(first.identity, refreshed.identity);
  assert.equal(first.addresses.helpers, getAddress(protocolAddresses.helpers));
});

test("Governance, Staking and configured Safe refresh their targets without retiring valid trading identities", () => {
  const first = protocolConfigurationValues(configured);
  const governance = protocolConfigurationValues({ ...configured, contracts: { ...configured.contracts,
    governance: changedHelpers, staking: changedHelpers, safe: changedHelpers } });
  assert.equal(governance.identity, first.identity);
  assert.equal(governance.addresses.governance, changedHelpers);
  assert.equal(governance.addresses.staking, changedHelpers);
  assert.equal(governance.addresses.safe, changedHelpers);
  for (const target of ["core", "helpers", "uniswapAdapter"] as const) {
    assert.notEqual(protocolConfigurationValues({ ...configured, contracts: { ...configured.contracts, [target]: changedHelpers } }).identity, first.identity);
  }
});

test("configuration GET uses one fixed no-store route, no credential/header/address request fields", async () => {
  let calls = 0;
  const controller = new AbortController();
  const value = await fetchProtocolConfiguration(configured.chainId, controller.signal, (async (url, options) => {
    calls++; assert.equal(url, "/api/protocol/config"); assert.equal(options?.signal, controller.signal);
    assert.equal(options?.cache, "no-store"); assert.equal(options?.body, undefined); assert.equal(options?.headers, undefined);
    return Response.json(configured);
  }) as typeof fetch);
  assert.deepEqual(value, configured); assert.equal(calls, 1);
});

test("another profile cannot supply deployment addresses; endpoint failure remains recoverable", async () => {
  await assert.rejects(fetchProtocolConfiguration(1, undefined, (async () => Response.json(configured)) as typeof fetch), /another chain/);
  await assert.rejects(fetchProtocolConfiguration(configured.chainId, undefined,
    (async () => Response.json({ error: "offline" }, { status: 503 })) as typeof fetch), /temporarily unavailable/);
  assert.equal((await fetchProtocolConfiguration(configured.chainId, undefined,
    (async () => Response.json(configured)) as typeof fetch)).chainId, configured.chainId);
});

test("independent query caches isolate SSR requests and a shared browser cache deduplicates concurrent consumers", async () => {
  let calls = 0, release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const client = new QueryClient(), separate = new QueryClient();
  const queryKey = ["protocol-configuration", configured.chainId, "fork-one"];
  const queryFn = () => fetchProtocolConfiguration(configured.chainId, undefined, (async () => {
    calls++; await wait; return Response.json(configured);
  }) as typeof fetch);
  const a = client.fetchQuery({ queryKey, queryFn, staleTime: 60_000 });
  const b = client.fetchQuery({ queryKey, queryFn, staleTime: 60_000 });
  assert.equal(calls, 1); assert.equal(separate.getQueryData(queryKey), undefined);
  release(); assert.deepEqual(await a, await b); assert.equal(calls, 1);
  await client.fetchQuery({ queryKey, queryFn, staleTime: 60_000 }); assert.equal(calls, 1);
  assert.equal(client.getQueryData(["protocol-configuration", configured.chainId, "fork-two"]), undefined);
  client.clear(); separate.clear();
});

test("unavailable targets disable only their operations and an observed spender must match the captured target", () => {
  assert.throws(() => requireProtocolAddress(undefined, "Helpers"), /Helpers address is temporarily unavailable/);
  assert.equal(requireProtocolAddress(changedHelpers, "Helpers"), changedHelpers);
  assert.doesNotThrow(() => assertObservedAddress(changedHelpers.toUpperCase(), changedHelpers, "Permit spender"));
  assert.throws(() => assertObservedAddress(protocolAddresses.helpers, changedHelpers, "Permit spender"), /Permit spender changed/);
  assert.equal(protocolConfigurationValues({ ...configured, contracts: { ...configured.contracts, helpers: zeroAddress } }).addresses.helpers, undefined);
});
