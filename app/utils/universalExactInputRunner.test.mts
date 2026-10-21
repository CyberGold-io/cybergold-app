import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, zeroAddress, zeroHash } from "viem";
import { appEnvironment, withEnvironment } from "../../tests/fixtures/environment.mts";
import { protocolConfigurationFixture } from "../../tests/fixtures/protocol-configuration.ts";
import { exactInputPlan, preserveExactInputMinimum, preserveExactInputBasketMinimums, exactInputBasketMinimums, type UniversalExactInputQuote } from "./universalExactInput.ts";
import { HELPERS_TRADE_EXACT_INPUT_ABI } from "../contracts/generated/helpersTradeExactInput.ts";
import { observeUiReceipt } from "../../tests/trading/uiReceipt.ts";
import { resultFor, type QuoteObservation } from "../../tests/trading/regression.ts";
import { tradeScenarios } from "../../tests/trading/scenarios.ts";
import type { Page } from "@playwright/test";
const { executionPlan } = await withEnvironment(appEnvironment,()=>import("../../tests/trading/walletExecution.ts"));
const corpus = JSON.parse(readFileSync(new URL("../../tests/fixtures/universal-exact-input.json",import.meta.url),"utf8"));
const native = corpus.fixtures[0], basket = corpus.fixtures[2];
function quote(fixture = native): UniversalExactInputQuote {
  return { strategy:"universal",routeFamily:"mixed",operation:"executeExactInput",settlementPolicy:"protocol-retained-input",
    plan:fixture.plan,inputs:fixture.plan.inputs,quotedInput:"200",inputMaximum:"200",quotedOutput:"40",outputMinimum:"1",
    estimatedRetainedInputCharges:[],estimatedRecipientOutputs:[{kind:0,token:fixture.plan.outputCurrency,id:"0",amount:"40"}],recoveryShares:[],
    fees:{coreProtocolFeeCygld:"1",coreHelpersFeeCygld:"2",marketFeeCygld:"3"},deployment:{helpers:fixture.helpers,adapter:fixture.helpers,encoding:"uniswap-routing-v1"},
    context:{chainId:31337,blockNumber:"1",blockHash:zeroHash,observedAt:"2026-10-20"},planDescription:{},
    retentionDisclosure:{custodian:fixture.helpers,beneficiary:"helpers-owner-at-settlement"},
    searchCoverage:{coreSharesPercent:[0,25,50,75,100],orders:["core-first","market-first"],maxCoreInvocations:1,maxAmmHops:3,scope:"selected-inventory"} };
}
function observation(value:UniversalExactInputQuote):QuoteObservation {
  const scenario=tradeScenarios.find(row=>row.id==="core-issue-basket-exact-in")!;
  return {scenario,request:{mode:"issue-exact-in",maximumAmountsIn:value.inputs.map(row=>row.amount)},value,result:resultFor(scenario,"execution")};
}

test("operational native funding submits the canonical complete plan with exact ETH and no token authorization",async()=>{
  const selected=quote(), value=observation(selected);
  const plan=await executionPlan(value,{} as Page,native.payer,protocolConfigurationFixture,async()=>{throw new Error("unexpected token request");});
  assert.equal(plan.operation,"executeExactInput");assert.equal(plan.nativeValue,200n);
  assert.deepEqual(plan.args[0],exactInputPlan(selected.plan));assert.deepEqual(value.result.authorization,["native"]);
});

test("operational basket funding acquires its full explicit vector and reuses sufficient ordinary allowances",async()=>{
  const selected=quote(basket), value=observation(selected),observed:string[]=[];
  const plan=await executionPlan(value,{} as Page,basket.payer,protocolConfigurationFixture,async url=>{
    observed.push(String(url));return Response.json({allowance:{status:"success",value:"1000"}});
  });
  assert.equal(plan.operation,"executeExactInput");assert.equal(plan.nativeValue,0n);
  assert.deepEqual((plan.args[0] as ReturnType<typeof exactInputPlan>).inputs.map(row=>row.amount),[300n,500n]);
  assert.equal(observed.length,2);assert.deepEqual(value.result.authorization,["allowance"]);
});

test("fresh solved-Q scalar and full-vector plans preserve accepted bounds without reviving old executable bytes",()=>{
  const scalar=preserveExactInputMinimum(quote(),50n);assert.equal(scalar.plan.minimumOutput,"50");assert.equal(scalar.plan.body,native.plan.body);
  const vector=quote(corpus.fixtures[3]), minima=exactInputBasketMinimums(vector.plan);
  const preserved=preserveExactInputBasketMinimums(vector,minima.map((row,index)=>({...row,minimumAmount:index===0?100n:row.minimumAmount})));
  assert.equal(exactInputBasketMinimums(preserved.plan)[0].minimumAmount,100n);
  assert.deepEqual(exactInputBasketMinimums(preserved.plan).map(row=>[row.kind,row.token,row.id]),minima.map(row=>[row.kind,row.token,row.id]));
});

test("browser receipt economics charge full declared input once and keep returned-input gains separate",()=>{
  const event=HELPERS_TRADE_EXACT_INPUT_ABI.find(row=>row.type==="event"&&row.name==="ExactInputExecuted")!;
  const result={acquiredInputs:[{currency:zeroAddress,amount:200n}],stages:[{branch:0n,stage:0n,inputCurrency:zeroAddress,outputCurrency:native.plan.outputCurrency,
    fundedInput:200n,returnedInput:210n,consumedInput:0n,inputGain:10n,amountOut:40n}],recipientOutputs:[{kind:0,token:native.plan.outputCurrency,id:0n,amount:40n}],
    recoveryShares:[],retainedInputs:[{branch:0n,stage:0n,currency:zeroAddress,amount:210n}],coreProtocolFeeCygld:1n,coreHelpersFeeCygld:2n,marketFeeCygld:3n,
    retainedCustodian:native.helpers,feeBeneficiaryAtSettlement:native.payer};
  const log={address:native.helpers,topics:encodeEventTopics({abi:HELPERS_TRADE_EXACT_INPUT_ABI,eventName:"ExactInputExecuted",args:{payer:native.payer,recipient:native.payer}}),data:encodeAbiParameters(event.inputs.filter(row=>!row.indexed),[0,result])};
  const scenario=tradeScenarios.find(row=>row.asset==="ETH"&&row.side==="buy"&&row.inputMode==="exact-in")!;
  const amount=(token:string,value:string)=>({type:token===zeroAddress?"native" as const:"erc20" as const,token,decimals:18,amount:value,roundingUnit:"1",rounding:"exact" as const});
  const snapshot={inputMode:"exact-in" as const,toleranceBps:100,input:[amount(zeroAddress,"200")],output:[amount(native.plan.outputCurrency,"40")],executionBound:{side:"output" as const,amounts:[amount(native.plan.outputCurrency,"39")]}};
  const config={...protocolConfigurationFixture,contracts:{...protocolConfigurationFixture.contracts,helpers:native.helpers}};
  const calldata=encodeFunctionData({abi:HELPERS_TRADE_EXACT_INPUT_ABI,functionName:"executeExactInput",args:[{...exactInputPlan(native.plan),minimumOutput:39n},native.funding] as never});
  const measured=observeUiReceipt(scenario,config,native.payer,calldata,{transactionHash:zeroHash,status:"success",blockNumber:1n,blockHash:zeroHash,logs:[log]} as never,200n,[],snapshot).validate();
  assert.equal(measured.actualOperation,"executeExactInput");assert.equal(measured.actualStrategy,"universal");
  assert.equal(measured.executionTerms!.inputSpent![0].amount,"200");assert.deepEqual(measured.receipt!.retainedInputs,[{asset:zeroAddress,amount:"210"}]);
  assert.equal(measured.receipt!.marketFeeCygld,"3");assert.equal((measured.receipt!.refunds as unknown[]).length,0);
});
