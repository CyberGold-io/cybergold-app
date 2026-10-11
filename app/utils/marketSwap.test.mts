import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, decodeFunctionData, parseAbiParameters, type Address, type Hex } from "viem";
import { HELPERS_MARKET_ABI, HELPERS_MARKET_FUNCTIONS } from "../contracts/generated/helpersMarket.ts";
import { HELPERS_DIAMOND_FUNCTIONS } from "../contracts/generated/helpersDiamond.ts";
import { marketSwapReceipt } from "./marketSwap.ts";

const payer = `0x${"a".repeat(40)}` as Address, recipient = `0x${"b".repeat(40)}` as Address;
const token = `0x${"c".repeat(40)}` as Address, helpers = `0x${"d".repeat(40)}` as Address;
const beneficiary = `0x${"e".repeat(40)}` as Address;
const cygld = `0x${"f".repeat(40)}` as Address;
const topics = encodeEventTopics({ abi: HELPERS_MARKET_ABI, eventName: "MarketSwapExecuted", args: { payer, recipient, counterToken: token } }) as [Hex, ...Hex[]];
const data = encodeAbiParameters(parseAbiParameters("uint8,bool,uint256,uint256,uint256,uint256,uint256,address"),
  [1, true, 1000n, 2000n, 1n, 0n, 1n, beneficiary]);

test("scoped market ABI keeps the historical Diamond interface separate", () => {
  assert.equal(HELPERS_MARKET_FUNCTIONS.length, 2);
  assert.equal(HELPERS_DIAMOND_FUNCTIONS.some(entry => entry.signature.startsWith("swapExact")), false);
  const wide = 2n ** 200n;
  const params = { side: 1, counterToken: token, amount: wide + 2n, bound: 9n, routedInput: wide,
    feeCygld: 1n, recipient, deadline: 1900000000n, adapter: helpers, data: "0xab" as const };
  const empty = `0x${"0".repeat(64)}` as const;
  const authorization = { mode: 1, nativePermit: { value: wide + 2n, deadline: 1900000000n, v: 27, r: empty, s: empty },
    permit2: { permit: { permitted: { token, amount: 0n }, nonce: 0n, deadline: 0n }, signature: "0x" as const } };
  const call = encodeFunctionData({ abi: HELPERS_MARKET_ABI, functionName: "swapExactInput", args: [params, authorization] });
  const decoded = decodeFunctionData({ abi: HELPERS_MARKET_ABI, data: call });
  assert.equal(decoded.functionName, "swapExactInput");
  assert.equal(decoded.args[0].amount, wide + 2n); assert.equal(decoded.args[0].routedInput, wide);
  assert.equal(decoded.args[1].nativePermit.value, wide + 2n);
});

test("market receipts report actual beneficiary and refunds, ignoring other contracts and payers", () => {
  const own = { address: helpers, topics, data };
  const receipt = marketSwapReceipt([{ ...own, address: token }, own], helpers, payer);
  assert.equal(receipt?.feeRecipient.toLowerCase(), beneficiary);
  assert.equal(receipt?.swapInput, 1000n); assert.equal(receipt?.amountOut, 2000n);
  assert.equal(receipt?.inputRefund, 1n); assert.equal(receipt?.feeCygld, 1n);
  assert.equal(marketSwapReceipt([own], helpers, recipient), undefined);
});

for (const row of [
  { name: "buy exact-output input refund", refundAsset: token, side: 0, exactInput: false, swapInput: 3539145706982n,
    amountOut: 110000000000000n, inputRefund: 35391457070n, feeCygld: 110110110111n },
  { name: "sell exact-input rounding dust", refundAsset: cygld, side: 1, exactInput: true, swapInput: 1000n,
    amountOut: 2000n, inputRefund: 1n, feeCygld: 1n },
] as const) {
  test(`market receipt ignores preceding DustRefunded for ${row.name}`, () => {
    const refundTopics = encodeEventTopics({ abi: HELPERS_MARKET_ABI, eventName: "DustRefunded",
      args: { payer, asset: row.refundAsset } }) as [Hex, ...Hex[]];
    const refund = { address: helpers, topics: refundTopics,
      data: encodeAbiParameters(parseAbiParameters("uint256"), [row.inputRefund]) };
    const swap = { address: helpers, topics,
      data: encodeAbiParameters(parseAbiParameters("uint8,bool,uint256,uint256,uint256,uint256,uint256,address"),
        [row.side, row.exactInput, row.swapInput, row.amountOut, row.inputRefund, 0n, row.feeCygld, beneficiary]) };
    const receipt = marketSwapReceipt([refund, swap], helpers, payer);
    assert.equal(receipt?.swapInput, row.swapInput);
    assert.equal(receipt?.amountOut, row.amountOut);
    assert.equal(receipt?.inputRefund, row.inputRefund);
    assert.equal(receipt?.outputRefund, 0n);
    assert.equal(receipt?.feeCygld, row.feeCygld);
    assert.equal(receipt?.side, row.side);
    assert.equal(receipt?.exactInput, row.exactInput);
    assert.equal(receipt?.feeRecipient.toLowerCase(), beneficiary);
    assert.equal(marketSwapReceipt([refund], helpers, payer), undefined);
  });
}
