import { encodeAbiParameters, parseAbiParameters, zeroAddress, type Hex } from "viem";
import { protocolAddresses, tokenAddresses } from "../../fixtures/protocol-configuration";
import type { UniversalExactInputQuote, UniversalExactInputRequest, WireRetainedInputCharge } from "../../../app/utils/universalExactInput";
import type { TradeQuoteRequest } from "../../../app/utils/tradeQuote";

export type TokenAmountWire = { kind: number; token: string; id: string; amount: string };
type Context = UniversalExactInputQuote["context"];
export type UniversalFixtureOptions = { routeFamily?: "core" | "market" | "mixed"; quotedOutput?: string; outputMinimum?: string;
  coreProtocolFeeCygld?: string; coreHelpersFeeCygld?: string; marketFeeCygld?: string;
  basketAssets?: readonly string[]; recipientOutputs?: readonly TokenAmountWire[]; recoveryShares?: readonly TokenAmountWire[];
  context?: Context; retainedInputs?: readonly WireRetainedInputCharge[]; adapter?: string };
const template = "(address inputCurrency,address outputCurrency,uint256 minimumOutput,(uint32 sharePpm,(uint8 kind,address currencyOut,uint24 fee,int24 tickSpacing)[] steps)[] routes)";
const continuation = `(${template} route,uint256 feeCygld)`;
const tokenMinimum = "(uint8 kind,address token,uint256 id,uint256 minimumAmount)";
const encode = (type: string, value: unknown) => encodeAbiParameters(parseAbiParameters(type), [value] as never);
const normalized = (currency: string) => currency.toLowerCase() === zeroAddress ? tokenAddresses.WETH : currency;
const route = (inputCurrency: string, outputCurrency: string) => ({ inputCurrency, outputCurrency, minimumOutput: 0n,
  routes: inputCurrency.toLowerCase() === outputCurrency.toLowerCase() ? [] : [{ sharePpm:1000000,steps:[{kind:2,currencyOut:outputCurrency,fee:500,tickSpacing:10}] }] });
const decimals = (token: string) => [tokenAddresses.USDC.toLowerCase(),tokenAddresses.USDT.toLowerCase()].includes(token.toLowerCase()) ? 6n : 18n;
export function tradeRequestFromUniversal(request: UniversalExactInputRequest): TradeQuoteRequest {
  const buy=request.intent===0,counter=buy?request.inputs[0].currency:request.outputCurrency;
  return {side:buy?"buy":"sell",mode:"exact-in",counterToken:normalized(counter),native:counter.toLowerCase()===zeroAddress,
    amount:request.inputs[0].amount,recipient:request.recipient??zeroAddress,deadline:request.deadline??"2000000000",slippageBps:request.slippageBps??100};
}

/** Synthetic canonical producer: new bodies, exact acquired inputs and complete scalar/vector bounds. */
export function universalFixture(request: UniversalExactInputRequest, options: UniversalFixtureOptions = {}): UniversalExactInputQuote {
  const core=protocolAddresses.core!,assets=options.basketAssets??[tokenAddresses.PAXG],family=options.routeFamily??"core";
  const input=BigInt(request.inputs[0]?.amount??"0"),buy=request.intent===0||request.intent===2;
  const coreAmount=family==="mixed"?input*3n/5n:input;
  const inputCurrency=normalized(request.inputs[0]?.currency??core),outputCurrency=normalized(request.outputCurrency);
  const bps=BigInt(request.slippageBps??100),minimum=(amount:bigint)=>amount*(10000n-bps)/10000n;
  const quoted=options.quotedOutput??(request.intent===3?"0":request.intent===2?String(input):buy?String(input*10n**18n/10n**decimals(inputCurrency)):String(input*10n**decimals(outputCurrency)/10n**18n));
  const scalarMinimum=options.outputMinimum??(request.intent===3?"0":String(minimum(BigInt(quoted))));
  const outputs=[...(options.recipientOutputs??(request.intent===3?assets.map(token=>({kind:0,token,id:"0",amount:String(input)})):[{kind:0,token:request.outputCurrency,id:"0",amount:quoted}]))];
  const recovery=[...(options.recoveryShares??outputs.filter(row=>row.kind===1))];
  const fees={coreProtocolFeeCygld:options.coreProtocolFeeCygld??"0",coreHelpersFeeCygld:options.coreHelpersFeeCygld??"0",marketFeeCygld:options.marketFeeCygld??"0"};
  const continuations=assets.map(currency=>({route:route(currency,core),feeCygld:0n}));
  let body:Hex;
  if(request.intent===2) body=encode(`(${continuation}[] continuations)`,{continuations});
  else if(request.intent===3) body=encode(`(${tokenMinimum}[] expectedOutputs)`,{expectedOutputs:outputs.map(row=>({...row,id:BigInt(row.id),minimumAmount:minimum(BigInt(row.amount))}))});
  else {
    const market={route:route(inputCurrency,outputCurrency),feeCygld:BigInt(fees.marketFeeCygld)};
    let data:Hex;
    if(family==="market") data=encode(`(${template} route,uint256 feeCygld)`,market);
    else if(buy) {
      const unit=coreAmount/BigInt(assets.length);
      data=encode(`(address[] basketAssets,(uint256 amountIn,${template} route)[] acquisitions,${continuation}[] continuations)`,{
        basketAssets:assets,acquisitions:assets.map((asset,index)=>({amountIn:index===assets.length-1?coreAmount-unit*BigInt(index):unit,route:route(inputCurrency,asset)})),continuations});
    } else {
      const coreOutputs=[...assets.map(token=>({kind:0,token,id:0n,minimumAmount:0n})),...recovery.map(row=>({...row,id:BigInt(row.id),minimumAmount:minimum(BigInt(row.amount))}))];
      data=encode(`(${tokenMinimum}[] expectedOutputs,${template}[] conversions)`,{expectedOutputs:coreOutputs,conversions:coreOutputs.map(row=>route(row.token,outputCurrency))});
    }
    body=encode("((uint8 kind,uint256 amountIn,bytes data)[] branches)",{branches:family==="mixed"?
      [{kind:0,amountIn:coreAmount,data},{kind:1,amountIn:input-coreAmount,data:encode(`(${template} route,uint256 feeCygld)`,market)}]
      :[{kind:family==="market"?1:0,amountIn:input,data}]});
  }
  return {strategy:"universal",routeFamily:family,operation:"executeExactInput",settlementPolicy:"protocol-retained-input",
    plan:{intent:request.intent,inputs:request.inputs.map(row=>({...row})),outputCurrency:request.outputCurrency,recipient:request.recipient,deadline:request.deadline,minimumOutput:scalarMinimum,body},
    inputs:request.inputs.map(row=>({...row})),...(request.intent===2?{}:{quotedInput:String(input),inputMaximum:String(input)}),quotedOutput:quoted,outputMinimum:scalarMinimum,
    estimatedRetainedInputCharges:(options.retainedInputs??[]).map(row=>({...row,branch:Number(row.branch),stage:Number(row.stage)})),estimatedRecipientOutputs:outputs,recoveryShares:recovery,fees,
    deployment:{helpers:protocolAddresses.helpers!,adapter:options.adapter??protocolAddresses.adapter!,encoding:"uniswap-routing-v1"},
    context:options.context??{chainId:31337,blockNumber:"100",blockHash:`0x${"a".repeat(64)}`,observedAt:"2026-10-01T00:00:00Z"},
    planDescription:{},retentionDisclosure:{custodian:protocolAddresses.helpers!,beneficiary:"helpers-owner-at-settlement"},
    searchCoverage:{coreSharesPercent:[0,25,50,75,100],orders:["core-first","market-first"],maxCoreInvocations:1,maxAmmHops:3,scope:"selected-inventory"}};
}

/** Reuse retained synthetic Core economics while generating only the new ABI body. */
export function universalFromCoreQuote(request: UniversalExactInputRequest, value: {
  executionAmount: string; displayAmount: string; expectedOutputAmount?: string;
  preview?: {fees?:{protocolFeeCygld:string;helperFeeCygld:string};projectedCoreOutputs?:readonly TokenAmountWire[]};
  context?:Context },basketAssets?:readonly string[]):UniversalExactInputQuote {
  const shares=value.preview?.projectedCoreOutputs?.filter(row=>row.kind===1)??[];
  return universalFixture(request,{basketAssets,quotedOutput:request.intent===0?value.executionAmount:value.expectedOutputAmount??value.displayAmount,
    coreProtocolFeeCygld:value.preview?.fees?.protocolFeeCygld,coreHelpersFeeCygld:value.preview?.fees?.helperFeeCygld,recoveryShares:shares,context:value.context});
}

/** Retained numerical Basket cases supply economics; the browser receives fresh universal bodies. */
export async function routeBasketQuote(page: import("@playwright/test").Page, handler:(route:import("@playwright/test").Route)=>Promise<void>){
  await page.route("**/api/economic-quotes",async target=>{
    const incoming=target.request(),request:UniversalExactInputRequest=incoming.postDataJSON();
    if(request.intent<2){await target.fallback();return;}
    const legacy=request.intent===2?{mode:"issue-exact-in",maximumAmountsIn:request.inputs.map(row=>row.amount)}:{mode:"redeem-exact-in",grossCygldIn:request.inputs[0].amount};
    const view=new Proxy(incoming,{get(source,key){if(key==="postDataJSON")return()=>legacy;if(key==="postData")return()=>JSON.stringify(legacy);const value=Reflect.get(source,key);return typeof value==="function"?value.bind(source):value;}});
    await handler(new Proxy(target,{get(source,key){
      if(key==="request")return()=>view;
      if(key==="fulfill")return async(options:Parameters<typeof target.fulfill>[0])=>{
        if(options?.status&&options.status>=400){await target.fulfill(options);return;}
        const envelope=options?.json??(typeof options?.body==="string"?JSON.parse(options.body):undefined),result=envelope?.result;
        if(!result){await target.fulfill(options);return;}
        const assets=result.orderedCoreAssets??result.projectedCoreOutputs?.filter((row:TokenAmountWire)=>row.kind===0).map((row:TokenAmountWire)=>row.token)??request.inputs.map(row=>row.currency);
        const quote=universalFixture(request,{basketAssets:assets,quotedOutput:request.intent===2?result.netCygldOut:"0",
          recipientOutputs:request.intent===3?result.projectedCoreOutputs:undefined,context:envelope.context,
          coreProtocolFeeCygld:result.fees?.protocolFeeCygld,coreHelpersFeeCygld:result.fees?.helperFeeCygld});
        await target.fulfill({...options,json:quote,body:undefined});
      };
      const value=Reflect.get(source,key);return typeof value==="function"?value.bind(source):value;
    }}));
  });
}
