import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BasketModel, modelFamily, predictIntent, predictLeg, type QuoteModelPacket } from "./quoteModels.ts";
import { clearQuoteModels, getQuoteModel, receiveQuoteModel, subscribeQuoteModels } from "./quoteModelStore.ts";

test("browser integer arithmetic matches captured live Helpers basket cases", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/basket-model.json", import.meta.url), "utf8"));
  const model = new BasketModel(fixture.state);
  for (const { request, actual } of fixture.cases) {
    if (request.mode === "issue-exact-in") {
      const result = model.issueIn(request.maximumAmountsIn.map(BigInt));
      assert.deepEqual(result?.amounts.map(String), actual.amountsInExact);
      assert.equal(String(result?.net), actual.netCygldOut);
    } else if (request.mode === "issue-exact-out") {
      assert.deepEqual(model.issue(BigInt(request.netCygldOut))?.amounts.map(String), actual.amountsInExact);
    } else if (request.mode === "redeem-exact-in") {
      assert.deepEqual(model.redeemIn(BigInt(request.grossCygldIn))?.map(String), actual.projectedCoreOutputs.map((r: { amount: string }) => r.amount));
    } else {
      const result = model.redeemOut(request.minimumOutputs.map((r: { minimumAmount: string }) => BigInt(r.minimumAmount)));
      assert.equal(String(result?.gross), actual.grossCygldIn);
      assert.deepEqual(result?.amounts?.map(String), actual.projectedCoreOutputs.map((r: { amount: string }) => r.amount));
    }
  }
});

const context = { chainId: 1, blockNumber: "10", blockHash: "hash", observedAt: "now" };
const packet: QuoteModelPacket = { revision: 100, protocol: null, routes: [],
  intent: { mode: "issue-exact-in", token: "token", quoteToken: "token", native: false,
    amount: "100", adapter: "adapter", orderedAssets: ["asset"], targets: [], slippageBps: 100 },
  whole: [{ input: "100", display: "200", context, recordedAt: 0 }] };

test("historical previews handle tiny/invalid inputs and independent producer revisions", () => {
  clearQuoteModels();
  receiveQuoteModel(packet);
  const restarted = { ...packet, revision: 1, whole: [{ ...packet.whole[0], display: "150" }] };
  receiveQuoteModel(restarted);
  assert.equal(getQuoteModel(modelFamily(packet.intent)), restarted);
  assert.equal(predictIntent(restarted, 50n), 75n);
  assert.equal(predictIntent(restarted, 0n), undefined);
  assert.equal(predictIntent(restarted, -1n), undefined);
  assert.equal(predictIntent({ ...packet, whole: [] }, 1n), undefined);
  assert.notEqual(modelFamily(packet.intent), modelFamily({ ...packet.intent, native: true }));
  clearQuoteModels();
  assert.equal(getQuoteModel(modelFamily(packet.intent)), undefined);
});

test("identical packets avoid duplicate rendering but a restarted producer still updates the model", () => {
  clearQuoteModels();
  let changes = 0;
  const unsubscribe = subscribeQuoteModels(() => changes++);
  receiveQuoteModel(packet); receiveQuoteModel(structuredClone(packet));
  assert.equal(changes, 1);
  receiveQuoteModel({ ...packet, revision: 0, whole: [{ ...packet.whole[0], display: "151" }] });
  assert.equal(changes, 2);
  assert.equal(predictIntent(getQuoteModel(modelFamily(packet.intent))!, 100n), 151n);
  unsubscribe(); clearQuoteModels();
});

test("pool exchange, known fees and impact stay separate; inverse rounds upwards", () => {
  const route: QuoteModelPacket["routes"][number] = { tokens: ["a", "b"], fees: [10000], context,
    exchangeRate: { numerator: "2", denominator: "1" }, feeRetention: { numerator: "99", denominator: "100" },
    points: [{ input: "1000", output: "1801" }] };
  assert.equal(predictLeg(route, 1000n), 1801n);
  assert.equal(predictLeg(route, 1801n, true), 1000n);
  assert.equal(predictLeg(route, 0n), 0n);
  assert.equal(predictLeg({ ...route, points: [], exchangeRate: undefined }, 1n), undefined);
  assert.equal(predictLeg({ ...route, exchangeRate: undefined }, 500n), 900n);
});

test("minimum-output display composes route and basket state without whole-intent history", () => {
  const data: QuoteModelPacket = { ...packet, whole: [], intent: { ...packet.intent, mode: "redeem-exact-out",
    targets: [{ inputAsset: "asset", outputAsset: "token", amount: "100" }] },
    protocol: { context, state: { assets: ["asset"], weights: ["1000000"], conversions: ["1000000000000000000"],
      issueFee: "0", helperFee: "0", redeemFee: "0", supply: "1000", maxSupply: "10000", effectiveCap: "10000",
      available: ["1000"], recoveryShares: [], recoveryValues: [], descriptors: [{ kind: 0, token: "asset", id: "0" }] } },
    routes: [{ tokens: ["asset", "token"], fees: [0], context, points: [{ input: "100", output: "200" }],
      feeRetention: { numerator: "1", denominator: "1" } }] };
  assert.equal(predictIntent(data, 100n), 50n);
  assert.equal(predictIntent({ ...data, intent: { ...data.intent, mode: "redeem-exact-in" } }, 100n), 200n);
  assert.equal(predictIntent({ ...data, routes: [] }, 100n), undefined);
});

test("purchase model subtracts known fees without subtracting slippage from CYGLD", () => {
  const data: QuoteModelPacket = { ...packet, whole: [], intent: { ...packet.intent,
    orderedAssets: ["asset"], targets: [{ inputAsset: "token", outputAsset: "asset", amount: "100000" }] },
    protocol: { context, state: { assets: ["asset"], weights: ["1000000"], conversions: ["1000000000000000000"],
      issueFee: "1000", helperFee: "0", redeemFee: "0", supply: "0", maxSupply: "1000000", effectiveCap: "1000000",
      available: ["0"], recoveryShares: [], recoveryValues: [], descriptors: [{ kind: 0, token: "asset", id: "0" }] } },
    routes: [{ tokens: ["token", "asset"], fees: [0], context, points: [{ input: "100000", output: "100000" }],
      feeRetention: { numerator: "1", denominator: "1" } }] };
  assert.equal(predictIntent(data, 100000n), 99900n);
  const capped = { ...data, protocol: { ...data.protocol!, state: { ...data.protocol!.state, maxSupply: "50000" } } };
  assert.equal(predictIntent(capped, 100000n), 99900n);
  assert.equal(new BasketModel(capped.protocol.state).issueIn([100000n])?.net, 49950n);
  const exactOut = { ...data, intent: { ...data.intent, mode: "issue-exact-out" as const } };
  assert.equal(predictIntent(exactOut, 99900n), 99999n);
  assert.equal(predictIntent({ ...exactOut, protocol: capped.protocol }, 99900n), 99999n);
});
