import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { economicQuoteKey, type EconomicQuote, type EconomicRequest } from "./economicQuotes.ts";
import { arithmeticEconomicEstimate, upperEconomicQuote, type EconomicReuseSample } from "./nearbyEconomicEstimate.ts";

const token = "0x0000000000000000000000000000000000000002";
const core = "0x0000000000000000000000000000000000000003";
const request = (amount: string): EconomicRequest => ({ intent: 0, inputs: [{ currency: token, amount }], outputCurrency: core });
const scope = { chainId: 31338, configuration: "configuration-a", generation: "generation-a" };
const sample = (referenceInput = "600"): EconomicReuseSample => ({ referenceInput, netOutput: "1001",
  fees: { coreProtocolFeeCygld: "7", coreHelpersFeeCygld: "3", marketFeeCygld: "1" }, basis: "observed-nonretained" });
const quote = (amount: string, reuseSample: EconomicReuseSample | undefined = sample()) => ({
  request: request(amount), quotedOutput: "1001", reuseSample,
  context: { chainId: 31338, blockNumber: "1", blockHash: "historical" },
}) as EconomicQuote;

const vectors = JSON.parse(readFileSync(new URL("./fixtures/nearby-amount-estimates.json", import.meta.url), "utf8")) as {
  name: string; sample: EconomicReuseSample; budget: string;
  expected: { amount: string; fees: EconomicReuseSample["fees"] } | null;
}[];
for (const vector of vectors) test(`shared Python/TypeScript arithmetic: ${vector.name}`, () => {
  const result = arithmeticEconomicEstimate(vector.sample, BigInt(vector.budget));
  if (vector.expected === null) { assert.equal(result, undefined); return; }
  assert.equal(result?.quotedOutput.toString(), vector.expected.amount);
  assert.deepEqual(result?.fees, { protocolFeeCygld: BigInt(vector.expected.fees.coreProtocolFeeCygld),
    helperFeeCygld: BigInt(vector.expected.fees.coreHelpersFeeCygld), marketFeeCygld: BigInt(vector.expected.fees.marketFeeCygld) });
});

test("approximate arithmetic compares the budget to consumed reference and counts net-output fees once", () => {
  assert.deepEqual(arithmeticEconomicEstimate(sample(), 900n), { quotedOutput: 1001n, basis: "observed-nonretained",
    fees: { protocolFeeCygld: 7n, helperFeeCygld: 3n, marketFeeCygld: 1n } });
  assert.deepEqual(arithmeticEconomicEstimate(sample(), 300n), { quotedOutput: 500n, basis: "observed-nonretained",
    fees: { protocolFeeCygld: 3n, helperFeeCygld: 1n, marketFeeCygld: 0n } });
  assert.equal(arithmeticEconomicEstimate(sample("1000"), 900n)?.quotedOutput, 900n);
  assert.equal(arithmeticEconomicEstimate(sample(), 1n)?.quotedOutput, 1n);
  assert.equal(arithmeticEconomicEstimate(sample(), 0n)?.quotedOutput, 0n);
  assert.equal(arithmeticEconomicEstimate(sample("0"), 1n), undefined);
  assert.equal(arithmeticEconomicEstimate(sample(), -1n), undefined);
});

test("lower consumed input never changes upper ordering by the original requested budget", () => {
  const client = new QueryClient();
  try {
    const saved = quote("1000"), farther = quote("1200"), lower = quote("800"), exact = quote("900");
    for (const value of [farther, saved, lower, exact]) client.setQueryData(economicQuoteKey(value.request, scope), value);
    assert.equal(upperEconomicQuote(client, request("900"), scope), saved);
    assert.equal(upperEconomicQuote(client, request("1000"), scope), farther);
    assert.equal(upperEconomicQuote(client, request("1200"), scope), undefined);
    assert.equal(client.getQueryCache().getAll().length, 4);
  } finally { client.clear(); }
});

test("a missing sample on the nearest upper does not silently select a farther quote", () => {
  const client = new QueryClient();
  try {
    const nearest = quote("1000"); delete nearest.reuseSample;
    client.setQueryData(economicQuoteKey(nearest.request, scope), nearest);
    client.setQueryData(economicQuoteKey(request("2000"), scope), quote("2000"));
    assert.equal(upperEconomicQuote(client, request("900"), scope), nearest);
    assert.equal(upperEconomicQuote(client, request("900"), scope)?.reuseSample, undefined);
  } finally { client.clear(); }
});

test("an unreadable optional cache observation cannot break a different usable neighbor", () => {
  const client = new QueryClient();
  try {
    const saved = quote("1000");
    client.setQueryData(economicQuoteKey(request("1100"), scope), quote("invalid integer"));
    client.setQueryData(economicQuoteKey(saved.request, scope), saved);
    assert.equal(upperEconomicQuote(client, request("900"), scope), saved);
  } finally { client.clear(); }
});

test("cache reuse follows existing generation/configuration, intent and token identities without a head or age gate", () => {
  const client = new QueryClient();
  try {
    const saved = quote("1000");
    client.setQueryData(economicQuoteKey(saved.request, scope), saved, { updatedAt: 1 });
    assert.equal(upperEconomicQuote(client, request("900"), scope), saved);
    assert.equal(upperEconomicQuote(client, request("900"), { ...scope, generation: "other" }), undefined);
    assert.equal(upperEconomicQuote(client, request("900"), { ...scope, configuration: "other" }), undefined);
    assert.equal(upperEconomicQuote(client, { ...request("900"), intent: 1 }, scope), undefined);
    assert.equal(upperEconomicQuote(client, { ...request("900"), outputCurrency: token }, scope), undefined);
    const native = { ...request("900"), inputs: [{ currency: `0x${"0".repeat(40)}`, amount: "900" }] };
    assert.equal(upperEconomicQuote(client, native, scope), undefined);
    const basket = { ...request("900"), intent: 2 as const, inputs: [...request("900").inputs, { currency: core, amount: "1" }] };
    assert.equal(upperEconomicQuote(client, basket, scope), undefined);
  } finally { client.clear(); }
});

test("a failed Refresh keeps the previous exact observation usable without anchoring any arithmetic hint", async () => {
  const client = new QueryClient(), saved = quote("1000"), key = economicQuoteKey(saved.request, scope);
  try {
    client.setQueryData(key, saved);
    await assert.rejects(client.fetchQuery({ queryKey: key, queryFn: async () => { throw new Error("Refresh failed"); }, retry: false }));
    const source = upperEconomicQuote(client, request("900"), scope)!;
    assert.equal(source, saved);
    assert.equal(arithmeticEconomicEstimate(source.reuseSample!, 300n)?.quotedOutput, 500n);
    assert.equal(client.getQueryData(economicQuoteKey(request("900"), scope)), undefined);
    assert.equal(client.getQueryCache().getAll().length, 1);
  } finally { client.clear(); }
});
