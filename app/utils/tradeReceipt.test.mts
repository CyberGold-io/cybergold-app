import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, zeroAddress, type Address, type Hex } from "viem";
import { HELPERS_DIAMOND_ABI } from "../contracts/generated/helpersDiamond.ts";
import { HELPERS_MARKET_ABI } from "../contracts/generated/helpersMarket.ts";
import { tradeReceipt } from "./tradeReceipt.ts";
import { tradeCore, tradeCounter, tradeHelpers, tradeOwner } from "../../tests/fixtures/trade-quote.mts";

function log(name: "Issued" | "Redeemed" | "DustRefunded" | "MarketSwapExecuted", args: Record<string, unknown>, address: Address = tradeHelpers) {
  const abi = name === "MarketSwapExecuted" ? HELPERS_MARKET_ABI : HELPERS_DIAMOND_ABI;
  const event = abi.find(entry => entry.type === "event" && entry.name === name)!;
  if (event.type !== "event") throw new Error("Fixture event missing");
  const values = event.inputs.filter(input => !input.indexed);
  return { address, topics: encodeEventTopics({ abi, eventName: name, args: args as never }) as readonly Hex[],
    data: encodeAbiParameters(values, values.map(input => args[input.name]) as never) };
}

for (const side of [0, 1] as const) test(`market ${side === 0 ? "purchase" : "sale"} receipt reports actual inclusive input and separate fee`, () => {
  const event = log("MarketSwapExecuted", { payer: tradeOwner, recipient: tradeOwner, counterToken: tradeCounter,
    side, exactInput: true, swapInput: 1000n, amountOut: 900n, inputRefund: 5n, outputRefund: 7n,
    feeCygld: 2n, feeRecipient: tradeHelpers });
  const measured = tradeReceipt([event], tradeHelpers, tradeOwner, "market", side === 0 ? tradeCounter : tradeCore)!;
  assert.equal(measured.inputUsed, side === 0 ? 1000n : 1002n); assert.equal(measured.amountOut, 900n);
  assert.equal(measured.helperFeeCygld, 2n); assert.equal(measured.inputRefund, 5n); assert.equal(measured.outputRefund, 7n);
});

test("Core issuance uses measured mint/input and only refunds the captured input currency", () => {
  const events = [log("Issued", { payer: tradeOwner, recipient: tradeOwner, inputToken: zeroAddress,
    inputUsed: 20n, netCygldOut: 25n, protocolFeeCygld: 2n, helperFeeCygld: 1n }),
  log("DustRefunded", { payer: tradeOwner, asset: zeroAddress, amount: 3n }),
  log("DustRefunded", { payer: tradeOwner, asset: tradeCounter, amount: 999n }),
  log("DustRefunded", { payer: tradeHelpers, asset: zeroAddress, amount: 999n })];
  const measured = tradeReceipt(events, tradeHelpers, tradeOwner, "core", zeroAddress)!;
  assert.equal(measured.operation, "issue"); assert.equal(measured.inputUsed, 20n); assert.equal(measured.amountOut, 25n);
  assert.equal(measured.inputRefund, 3n); assert.equal(measured.protocolFeeCygld, 2n); assert.equal(measured.helperFeeCygld, 1n);
});

test("Core redemption retains actual burned lot and distinct recovery-share amounts", () => {
  const event = log("Redeemed", { payer: tradeOwner, recipient: tradeOwner, outputToken: tradeCounter,
    grossCygldIn: 20n, amountOut: 25n, recoveryAssets: [tradeCounter], recoveryShareAmounts: [2n ** 100n],
    protocolFeeCygld: 2n, helperFeeCygld: 1n });
  const measured = tradeReceipt([event], tradeHelpers, tradeOwner, "core", tradeCore)!;
  assert.equal(measured.operation, "redeem"); assert.equal(measured.inputUsed, 20n); assert.equal(measured.amountOut, 25n);
  assert.deepEqual(measured.recoveryShareAmounts, [2n ** 100n]); assert.deepEqual(measured.recoveryAssets.map(value => value.toLowerCase()), [tradeCounter]);
  assert.equal(tradeReceipt([{ ...event, address: tradeOwner }], tradeHelpers, tradeOwner, "core", tradeCore), undefined);
});
