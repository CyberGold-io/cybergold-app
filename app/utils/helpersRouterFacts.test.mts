import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, zeroAddress } from "viem";
import { QuotePreviewError, quoteErrorMessage } from "./quoteErrors.ts";
import { adapterApprovalFromFacts, adapterCodePresentFromFacts, fetchHelpersRouterFacts, helpersConfigFromFacts,
  permit2FromFacts, fetchBasketPermitIssuanceInstalled, type HelpersRouterFacts } from "./helpersRouterFacts.ts";

const success = <T,>(value: T) => ({ status: "success" as const, value });
const failure = { status: "failure" as const, error: "contract-read-failed" as const };
const adapter = getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
function facts(): HelpersRouterFacts { return {
  context: { chainId: 31338, blockNumber: "101", blockHash: `0x${"a".repeat(64)}`, blockTimestamp: "1800000000", observedAt: "2026-10-01T00:00:00Z" },
  helpers: `0x${"5".repeat(40)}`, configuration: { helperFeePpm: success("0"),
    permit2: success(`0x${"6".repeat(40)}`), wrappedNative: success(zeroAddress),
    owner: success(`0x${"8".repeat(40)}`), approvedAdapters: success([adapter.toLowerCase(), zeroAddress]), paused: success(false) },
}; }

test("Helpers configuration keeps zero/false, normalizes addresses and preserves partial unknowns", () => {
  const payload = facts();
  const configuration = helpersConfigFromFacts(payload);
  assert.equal(configuration?.helperFeePpm, 0n);
  assert.equal(configuration?.paused, false);
  assert.equal(configuration?.wrappedNative, undefined);
  assert.deepEqual(configuration?.approvedAdapters, [adapter]);
  payload.configuration.helperFeePpm = failure;
  payload.configuration.owner = failure;
  assert.equal(helpersConfigFromFacts(payload)?.helperFeePpm, undefined);
  assert.equal(helpersConfigFromFacts(payload)?.owner, undefined);
  assert.equal(helpersConfigFromFacts(payload)?.paused, false);
  assert.equal(helpersConfigFromFacts(), undefined);
});

test("adapter membership shares the canonical list; failed observation is never false approval", () => {
  const payload = facts();
  assert.equal(adapterApprovalFromFacts(payload, adapter), true);
  assert.equal(adapterApprovalFromFacts(payload, `0x${"b".repeat(40)}`), false);
  assert.equal(adapterApprovalFromFacts(payload), undefined);
  payload.configuration.approvedAdapters = failure;
  assert.throws(() => adapterApprovalFromFacts(payload, adapter), /temporarily unavailable/);
  payload.configuration.approvedAdapters = success([]);
  assert.equal(adapterApprovalFromFacts(payload, adapter), false);
});

test("Permit2 preserves the existing configured zero address but rejects an unavailable read", () => {
  const payload = facts();
  assert.equal(permit2FromFacts(payload), `0x${"6".repeat(40)}`);
  payload.configuration.permit2 = success(zeroAddress);
  assert.equal(permit2FromFacts(payload), zeroAddress);
  payload.configuration.permit2 = failure;
  assert.throws(() => permit2FromFacts(payload), /temporarily unavailable/);
});

test("fixed Helpers API fetch propagates cancellation and has no browser bearer or RPC fallback", async () => {
  const controller = new AbortController(); let calls = 0;
  await fetchHelpersRouterFacts(controller.signal, (async (url, init) => {
    calls++; assert.equal(url, "/api/governance/helpers-facts"); assert.equal(init?.signal, controller.signal);
    assert.equal(init?.cache, "no-store"); assert.equal(new Headers(init?.headers).has("authorization"), false);
    return Response.json(facts());
  }) as typeof fetch);
  await assert.rejects(fetchHelpersRouterFacts(undefined, (async () => {
    calls++; return new Response(null, { status: 503 });
  }) as typeof fetch), /temporarily unavailable/);
  assert.equal(calls, 2);
});

test("the exact App adapter gets fresh canonical approval and code observations in one fixed read", async () => {
  let calls = 0;
  const payload = { ...facts(), adapter: { address: adapter, codePresent: success(true) } };
  const signal = new AbortController().signal;
  const value = await fetchHelpersRouterFacts(signal, (async (url, init) => {
    calls++; assert.equal(url, `/api/governance/helpers-facts?adapter=${adapter}`);
    assert.equal(init?.signal, signal); assert.equal(init?.cache, 'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Response.json(payload);
  }) as typeof fetch, adapter);
  assert.equal(adapterApprovalFromFacts(value, adapter), true);
  assert.equal(adapterCodePresentFromFacts(value), true);
  assert.equal(calls, 1);
});

test("empty adapter code is invalid while failed or retained missing observations stay unavailable", () => {
  const payload = facts();
  assert.equal(adapterCodePresentFromFacts({ ...payload, adapter: { address: adapter, codePresent: success(false) } }), false);
  assert.throws(() => adapterCodePresentFromFacts({ ...payload, adapter: { address: adapter, codePresent: failure } }), /temporarily unavailable/);
  assert.throws(() => adapterCodePresentFromFacts(payload), /temporarily unavailable/);
});

test("adapter code presence cannot grant Helpers approval and unknown approval cannot become false", () => {
  const payload = { ...facts(), adapter: { address: adapter, codePresent: success(true) } };
  payload.configuration.approvedAdapters = success([]);
  assert.equal(adapterApprovalFromFacts(payload, adapter), false);
  assert.equal(adapterCodePresentFromFacts(payload), true);
  payload.configuration.approvedAdapters = failure;
  assert.throws(() => adapterApprovalFromFacts(payload, adapter), /temporarily unavailable/);
});

test("failed submission preparation uses no browser RPC fallback", async () => {
  let calls = 0;
  await assert.rejects(fetchHelpersRouterFacts(undefined, (async () => {
    calls++; return new Response(null, { status: 503 });
  }) as typeof fetch, adapter), /temporarily unavailable/);
  assert.equal(calls, 1);
});

test("Helpers RPC errors preserve their cause and use the existing locale messages", async () => {
  await assert.rejects(fetchHelpersRouterFacts(undefined, (async () => Response.json({
    code: "rpc-rate-limit", error: "private provider details",
  }, { status: 503 })) as typeof fetch, adapter), error => {
    assert.ok(error instanceof QuotePreviewError);
    assert.equal(quoteErrorMessage(error, key => key), "quoteRpcRateLimit");
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

for (const mode of ["exact-in", "exact-out"] as const) test(`${mode} basket discovers only its installed selector and preserves old-target fallback`, async () => {
  const payload = facts();
  payload.configuration.basketPermitIssuanceExactIn = success(mode === "exact-in");
  payload.configuration.basketPermitIssuanceExactOut = success(mode === "exact-out");
  const get = (async (url) => { assert.equal(url, "/api/governance/helpers-facts?basketPermitIssuance=true"); return Response.json(payload); }) as typeof fetch;
  assert.equal(await fetchBasketPermitIssuanceInstalled(mode, get), true);
  payload.configuration[mode === "exact-in" ? "basketPermitIssuanceExactIn" : "basketPermitIssuanceExactOut"] = success(false);
  assert.equal(await fetchBasketPermitIssuanceInstalled(mode, get), false);
  payload.configuration[mode === "exact-in" ? "basketPermitIssuanceExactIn" : "basketPermitIssuanceExactOut"] = failure;
  await assert.rejects(fetchBasketPermitIssuanceInstalled(mode, get), /temporarily unavailable/);
});
