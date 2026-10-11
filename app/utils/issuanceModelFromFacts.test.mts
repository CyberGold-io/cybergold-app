import assert from "node:assert/strict";
import test from "node:test";
import { issuanceModelFromFacts, type ProtocolFacts } from "./protocolFacts.ts";
import { cygldBasketPurchaseAmount, cygldPurchaseCapacity } from "./cygldSupply.ts";
import type { ProtocolModel } from "./quoteModelStore.ts";

const success = <T,>(value: T) => ({ status: "success" as const, value });
const failure = { status: "failure" as const, error: "contract-read-failed" as const };
const wide = 2n ** 200n;
const asset = `0x${"6".repeat(40)}`;
const coldFacts = (): ProtocolFacts => ({
  context: { chainId: 1, blockNumber: "101", blockHash: `0x${"a".repeat(64)}`,
    blockTimestamp: "1790800000", observedAt: "2026-10-09T12:00:00Z" },
  core: asset, helpers: asset,
  basket: { assets: success([asset]), targetsPpm: success(["1000000"]),
    goldRefGramsFp18: failure, cygldPerUnitFp18: success(["1000000000000000000"]), metadata: [] },
  reference: failure, pause: failure,
  fees: { issuancePpm: success("10000"), helpersPpm: success("20000") },
  issuanceCapacity: { totalSupply: success(String(wide)), maxTotalSupply: success(String(wide + 1000n)),
    effectiveCygldSupplyCap: success(String(wide + 2000n)) },
});
const fullModel = (): ProtocolModel => ({
  context: { chainId: 1, blockNumber: "100", blockHash: `0x${"b".repeat(64)}`, observedAt: "2026-10-09T11:59:00Z" },
  state: { assets: [asset], weights: ["1000000"], conversions: ["1000000000000000000"],
    issueFee: "10000", helperFee: "20000", redeemFee: "0", supply: String(wide),
    maxSupply: String(wide + 2000n), effectiveCap: String(wide + 2000n),
    available: [], recoveryShares: [], recoveryValues: [], descriptors: [] },
});

test("cold issuance facts provide capacity and basket amounts without a redemption model", () => {
  const model = issuanceModelFromFacts(coldFacts());
  assert.equal(model?.state.supply, String(wide));
  assert.equal(cygldPurchaseCapacity(model)?.grossRemaining, 1000n);
  assert.equal(cygldPurchaseCapacity(model)?.available, 971n);
  assert.equal(cygldBasketPurchaseAmount(model, [1000n])?.net, 971n);
});

test("missing unrelated basket data leaves capacity usable", () => {
  const facts = coldFacts();
  facts.basket.assets = failure;
  facts.basket.targetsPpm = failure;
  facts.basket.cygldPerUnitFp18 = failure;
  const model = issuanceModelFromFacts(facts);
  assert.equal(cygldPurchaseCapacity(model)?.available, 971n);
  assert.equal(cygldBasketPurchaseAmount(model, [1000n]), undefined);
});

test("newer complete observations win without mixing block state", () => {
  const facts = coldFacts(), model = fullModel();
  assert.equal(issuanceModelFromFacts(facts, model)?.context.blockNumber, "101");
  model.context.blockNumber = "102";
  assert.equal(issuanceModelFromFacts(facts, model), model);
  model.context.blockNumber = "101";
  assert.equal(issuanceModelFromFacts(facts, model)?.state.maxSupply, String(wide + 1000n));
  model.context.observedAt = "2026-10-09T12:01:00Z";
  assert.equal(issuanceModelFromFacts(facts, model), model);
});

test("unavailable required capacity facts retain the existing whole model or stay unknown", () => {
  const model = fullModel();
  assert.equal(issuanceModelFromFacts(undefined, model), model);
  for (const field of ["totalSupply", "maxTotalSupply", "effectiveCygldSupplyCap"] as const) {
    const facts = coldFacts(); facts.issuanceCapacity![field] = failure;
    assert.equal(issuanceModelFromFacts(facts), undefined);
    assert.equal(issuanceModelFromFacts(facts, model), model);
  }
  const facts = coldFacts(); facts.fees.helpersPpm = failure;
  assert.equal(issuanceModelFromFacts(facts), undefined);
});
