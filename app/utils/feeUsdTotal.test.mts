import assert from "node:assert/strict";
import test from "node:test";
import { zeroAddress } from "viem";
import { computeTotalFeeUsd } from "./feeUsdTotal.ts";
import { tokens } from "../../tests/fixtures/protocol-configuration.ts";
const erc20 = tokens.filter(row => row.type === "erc20");
const tokenAddressMap = new Map(erc20.map(row => [row.address.toLowerCase(),row]));
const base = { activeFees:{protocolFeeCygld:1n*10n**18n,helperFeeCygld:2n*10n**18n,marketFeeCygld:3n*10n**18n},
  cygldDecimals:18,cygldPriceUsd:1,cygldTokenId:"cygld",tokenAddressMap, prices:{weth:2000} };

test("fee total includes each applicable Core, Market and physical retained charge once", () => {
  assert.equal(computeTotalFeeUsd({...base,retainedInputCharges:[{currency:zeroAddress,amount:String(10n**15n)}]}),8);
  assert.equal(computeTotalFeeUsd(base),6);
});

test("unpriced retained physical assets make the fiat total unavailable without discarding their disclosed amounts", () => {
  assert.equal(computeTotalFeeUsd({...base,retainedInputCharges:[{currency:"0x00000000000000000000000000000000000000ff",amount:"1"}]}),undefined);
});
