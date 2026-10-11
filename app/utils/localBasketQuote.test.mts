import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { localBasketQuote } from "./localBasketQuote.ts";
import { clearQuoteModels, getProtocolModel, receiveProtocolModel, receiveQuoteModel, subscribeQuoteModels } from "./quoteModelStore.ts";
import type { QuoteModelPacket } from "./quoteModels.ts";

const state = JSON.parse(readFileSync(new URL("../../tests/e2e/fixtures/basket-evaluation-state.json", import.meta.url), "utf8"));
const protocol = { context: { chainId: 1, blockNumber: "10", blockHash: "hash", observedAt: "now" }, state };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/basket-model.json", import.meta.url), "utf8"));

test("indicative Basket arithmetic matches independent Helpers captures in all four modes", () => {
  for (const { request, actual } of fixture.cases) {
    const amount = BigInt(request.netCygldOut ?? request.grossCygldIn ?? "0");
    const components = request.maximumAmountsIn?.map(BigInt) ?? request.minimumOutputs?.slice(0, state.assets.length).map((r: { minimumAmount: string }) => BigInt(r.minimumAmount)) ?? [];
    const result = localBasketQuote(protocol, request.mode, state.assets, amount, components);
    assert.ok(result, request.mode);
    if (request.mode === "issue-exact-in") assert.equal(String(result.amount), actual.netCygldOut);
    else if (request.mode === "redeem-exact-out") assert.equal(String(result.amount), actual.grossCygldIn);
    else assert.deepEqual(result.componentAmounts?.map(String), actual.amountsInExact ?? actual.projectedCoreOutputs.map((r: { amount: string }) => r.amount));
  }
});

test("missing, mismatched, tiny and unsupported Basket state leave the exact preview authoritative", () => {
  assert.equal(localBasketQuote(undefined, "issue-exact-out", state.assets, 1n, []), undefined);
  assert.equal(localBasketQuote(protocol, "issue-exact-out", [...state.assets].reverse(), 1n, []), undefined);
  assert.equal(localBasketQuote(protocol, "issue-exact-out", state.assets, 0n, []), undefined);
  assert.equal(localBasketQuote(protocol, "redeem-exact-in", state.assets, BigInt(state.supply)*2n, []), undefined);
  assert.equal(localBasketQuote(protocol, "issue-exact-in", state.assets, 0n, []), undefined);
});

test("an oversized output retains indicative basket costs while exact issuance is rejected", () => {
  const captured = fixture.cases.find((row: { request: { mode: string } }) => row.request.mode === "issue-exact-out");
  const capped = { ...protocol, state: { ...state, maxSupply: state.supply } };
  const amount = BigInt(captured.request.netCygldOut);
  const estimate = localBasketQuote(capped, "issue-exact-out", state.assets, amount, []);
  assert.deepEqual(estimate?.componentAmounts?.map(String), captured.actual.amountsInExact);
  assert.equal(localBasketQuote(capped, "issue-exact-out", state.assets, 0n, []), undefined);
});

test("cold issuance facts retain captured basket costs without redemption or recovery state", () => {
  const captured = fixture.cases.find((row: { request: { mode: string } }) => row.request.mode === "issue-exact-out");
  const { assets, weights, conversions, supply, maxSupply, effectiveCap, issueFee, helperFee } = state;
  const issuance = { context: protocol.context, state: { assets, weights, conversions,
    supply, maxSupply, effectiveCap, issueFee, helperFee } };
  const amount = BigInt(captured.request.netCygldOut);
  assert.deepEqual(localBasketQuote(undefined, "issue-exact-out", assets, amount, [], issuance)
    ?.componentAmounts?.map(String), captured.actual.amountsInExact);
  assert.equal(localBasketQuote(undefined, "issue-exact-out", [...assets].reverse(), amount, [], issuance), undefined);
});

test("shared protocol delivery notifies once, tolerates older APIs, and clears at the existing reset", () => {
  clearQuoteModels(); let changes = 0;
  const stop = subscribeQuoteModels(() => changes++);
  receiveProtocolModel(protocol); receiveProtocolModel(structuredClone(protocol)); receiveProtocolModel(undefined);
  assert.equal(changes, 1); assert.deepEqual(getProtocolModel(), protocol);
  const packet: QuoteModelPacket = { revision: 1, protocol, routes: [], whole: [], intent: { mode: "issue-exact-in", amount: "100", token: "token", quoteToken: "token", native: false, adapter: "adapter", orderedAssets: state.assets, targets: [], slippageBps: 100 } };
  receiveQuoteModel(packet); assert.equal(changes, 2);
  receiveProtocolModel(null); assert.equal(getProtocolModel(), undefined); assert.equal(changes, 3);
  receiveQuoteModel(packet); clearQuoteModels(); assert.equal(getProtocolModel(), undefined);
  stop();
});
