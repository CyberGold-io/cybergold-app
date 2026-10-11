import assert from "node:assert/strict";
import test from "node:test";
import { cygldBasketInputsForNet, cygldBasketPurchaseAmount, cygldBasketPurchaseMax, cygldGrossForNet, cygldPurchaseCapacity, formatCygldCapacity } from "./cygldSupply.ts";
import { BasketModel } from "./quoteModels.ts";
import type { ProtocolModel } from "./quoteModelStore.ts";
import { applySlippageCeil } from "./swapPolicy.ts";

const model: ProtocolModel = {
  context: { chainId: 1, blockNumber: "1", blockHash: "hash", observedAt: "now" },
  state: { assets: ["asset"], weights: ["1000000"], conversions: ["1000000000000000000"],
    available: ["100000000000000000000"], recoveryShares: [], recoveryValues: [], descriptors: [],
    supply: "61042133796931254039", maxSupply: "250000000000000000000", effectiveCap: "250000000000000000000",
    issueFee: "1000", helperFee: "0", redeemFee: "1000" },
};

test("purchase capacity includes both fees and matches the exact issuance boundary", () => {
  for (const helperFee of ["0", "1000", "300000"]) {
    const protocol = { ...model, state: { ...model.state, helperFee } };
    const capacity = cygldPurchaseCapacity(protocol)!;
    const basket = new BasketModel(protocol.state);
    assert.equal(capacity.grossRemaining, capacity.cap - capacity.supply);
    assert.ok(cygldGrossForNet(protocol, capacity.available)! <= capacity.grossRemaining);
    assert.ok(cygldGrossForNet(protocol, capacity.available + 1n)! > capacity.grossRemaining);
    assert.ok(basket.issue(capacity.available));
    assert.equal(basket.issue(capacity.available + 1n), undefined);
  }
  assert.equal(formatCygldCapacity(cygldPurchaseCapacity(model)!.available, 18, "fr"), "188,769");
});

test("uncapped input budgets retain oversized demand instead of silently clipping it", () => {
  const protocol = { ...model, state: { ...model.state, supply: "990", maxSupply: "1000", effectiveCap: "1000",
    issueFee: "100000", helperFee: "250000" } };
  const amount = cygldBasketPurchaseAmount(protocol, [100n])!;
  assert.deepEqual(amount, { gross: 99n, coreNet: 90n, net: 68n });
  assert.ok(amount.gross > cygldPurchaseCapacity(protocol)!.grossRemaining);
  assert.ok(amount.net > new BasketModel(protocol.state).issueIn([100n])!.net);
  assert.deepEqual(cygldBasketPurchaseAmount(protocol, [0n]), { gross: 0n, coreNet: 0n, net: 0n });
  assert.equal(cygldBasketPurchaseAmount(undefined, [100n]), undefined);
});

test("basket demand takes the tightest positive-weight asset after both Core floors", () => {
  const protocol = { ...model, state: { ...model.state, assets: ["a", "b", "unused"],
    weights: ["250000", "750000", "0"], conversions: ["2000000000000000000", "500000000000000000", "0"],
    available: ["100", "100", "0"], issueFee: "100000", helperFee: "250000" } };
  assert.deepEqual(cygldBasketPurchaseAmount(protocol, [101n, 607n, 0n]),
    { gross: 403n, coreNet: 364n, net: 273n });
  assert.deepEqual(cygldBasketPurchaseAmount(protocol, [1n, 607n, 10n ** 40n]),
    { gross: 7n, coreNet: 8n, net: 6n });
});

test("basket MAX leaves room for the protected input of the limiting wallet asset", () => {
  const protocol = { ...model, state: { ...model.state, assets: ["a", "b"],
    weights: ["500000", "500000"], conversions: ["1000000000000000000", "1000000000000000000"],
    available: ["1000", "1000"], issueFee: "0", helperFee: "0" } };
  const balances = [1000n, 500n], basket = new BasketModel(protocol.state);
  const unprotectedNet = cygldBasketPurchaseAmount(protocol, balances)!.net;
  assert.equal(unprotectedNet, 1000n);
  assert.ok(applySlippageCeil(basket.issue(unprotectedNet)!.amounts[1]) > balances[1]);
  for (const [bps, expectedNet] of [[0, 1000n], [50, 994n], [100, 990n]] as const) {
    const net = cygldBasketPurchaseMax(protocol, balances, bps)!;
    assert.equal(net, expectedNet);
    const amounts = basket.issue(net)!.amounts;
    assert.ok(amounts.every((amount, index) => applySlippageCeil(amount, bps) <= balances[index]));
    assert.ok(applySlippageCeil(basket.issue(net + 1n)!.amounts[1], bps) > balances[1]);
  }
  assert.equal(cygldBasketPurchaseMax(protocol, balances), 990n);
});

test("basket MAX handles unequal weights, raw decimal scales and both issuance fees", () => {
  const protocol = { ...model, state: { ...model.state, assets: ["eighteen-decimal", "six-decimal", "unused"],
    weights: ["250000", "750000", "0"],
    conversions: ["2000000000000000000", "500000000000000000000000000000", "1000000000000000000"],
    available: ["10000000000000000000", "10000000", "0"], issueFee: "100000", helperFee: "250000" } };
  const balances = [10n ** 18n, 3_000_000n, 0n], basket = new BasketModel(protocol.state);
  const net = cygldBasketPurchaseMax(protocol, balances)!;
  assert.equal(net, 1_336_633_650_000_000_000n);
  const amounts = basket.issue(net)!.amounts;
  assert.ok(amounts.every((amount, index) => applySlippageCeil(amount) <= balances[index]));
  assert.equal(applySlippageCeil(amounts[1]), balances[1]);
  assert.ok(applySlippageCeil(basket.issue(net + 1n)!.amounts[1]) > balances[1]);
});

test("basket MAX respects the smaller gross supply cap after both fees", () => {
  for (const [maxSupply, effectiveCap] of [[18n, 20n], [20n, 18n]]) {
    const protocol = { ...model, state: { ...model.state, supply: String(10n * 10n ** 18n),
      maxSupply: String(maxSupply * 10n ** 18n), effectiveCap: String(effectiveCap * 10n ** 18n),
      issueFee: "10000", helperFee: "20000" } };
    const net = cygldBasketPurchaseMax(protocol, [100n * 10n ** 18n])!;
    assert.equal(net, 7_761_600_000_000_000_000n);
    assert.ok(cygldGrossForNet(protocol, net)! <= 8n * 10n ** 18n);
    assert.ok(cygldGrossForNet(protocol, net + 1n)! > 8n * 10n ** 18n);
    assert.equal(cygldBasketPurchaseMax({ ...protocol,
      state: { ...protocol.state, supply: String(20n * 10n ** 18n) } }, [100n * 10n ** 18n]), 0n);
  }
});

test("a fee plateau above remaining capacity still admits the same canonical recipient receipt", () => {
  const protocol = { ...model, state: { ...model.state, supply: "9", maxSupply: "10", effectiveCap: "10",
    issueFee: "500000", helperFee: "0" } };
  const remaining = cygldPurchaseCapacity(protocol)!.grossRemaining;
  const fitting = cygldBasketPurchaseAmount(protocol, [2n])!;
  assert.deepEqual(fitting, { gross: 1n, coreNet: 1n, net: 1n });
  assert.equal(fitting.gross, remaining);
  assert.ok(cygldBasketPurchaseAmount(protocol, [3n])!.gross > remaining);
});

test("exact-output fee inversion is minimal and retains integers wider than Number", () => {
  const protocol = { ...model, state: { ...model.state, issueFee: "300000", helperFee: "250000" } };
  const netFromGross = (gross: bigint) => {
    const coreNet = gross - gross * 300_000n / 1_000_000n;
    return coreNet - coreNet * 250_000n / 1_000_000n;
  };
  for (const target of [0n, 1n, 2n, 17n, 999_999n, 10n ** 40n]) {
    const gross = cygldGrossForNet(protocol, target)!;
    assert.equal(netFromGross(gross), target);
    if (gross > 0n) assert.ok(netFromGross(gross - 1n) < target);
  }
  assert.equal(cygldGrossForNet(undefined, 1n), undefined);
});

test("cold exact-output basket costs include both fees and both upward roundings above the cap", () => {
  const protocol = { ...model, state: { ...model.state, supply: "1000", maxSupply: "1000", effectiveCap: "1000",
    assets: ["a", "b", "unused"], weights: ["250000", "750000", "0"],
    conversions: ["2000000000000000000", "500000000000000000", "0"],
    issueFee: "100000", helperFee: "250000" } };
  assert.equal(cygldPurchaseCapacity(protocol)?.available, 0n);
  assert.deepEqual(cygldBasketInputsForNet(protocol, 273n), [51n, 606n, 0n]);
  assert.equal(cygldBasketPurchaseAmount(protocol, [51n, 606n, 0n])?.net, 273n);
  assert.ok(cygldBasketPurchaseAmount(protocol, [50n, 606n, 0n])!.net < 273n);
  assert.ok(cygldBasketPurchaseAmount(protocol, [51n, 605n, 0n])!.net < 273n);
  assert.equal(new BasketModel(protocol.state).issue(273n), undefined);
  assert.deepEqual(cygldBasketInputsForNet(protocol, 0n), [0n, 0n, 0n]);
  assert.equal(cygldBasketInputsForNet(undefined, 273n), undefined);
});

test("the lower effective cap applies, and full or lowered caps have zero headroom", () => {
  const lower = { ...model, state: { ...model.state, effectiveCap: "80000000000000000000" } };
  assert.equal(cygldPurchaseCapacity(lower)?.cap, 80n * 10n ** 18n);
  for (const supply of ["250000000000000000000", "251000000000000000000"]) {
    assert.equal(cygldPurchaseCapacity({ ...model, state: { ...model.state, supply } })?.available, 0n);
  }
  assert.equal(cygldPurchaseCapacity(), undefined);
});

test("capacity display rounds like the quote without losing small positive amounts", () => {
  assert.equal(formatCygldCapacity(1999999999999999999n, 18, "en"), "2");
  assert.equal(formatCygldCapacity(188768908336865677216n, 18, "en"), "188.769");
  assert.equal(formatCygldCapacity(123499999999999n, 18, "fr"), "0,000123");
  assert.equal(formatCygldCapacity(1n, 18, "en"), "0.0₁₇1");
  assert.equal(formatCygldCapacity(0n, 18, "en"), "0");
});
