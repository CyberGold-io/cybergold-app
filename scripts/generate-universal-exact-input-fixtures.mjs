#!/usr/bin/env node
import fs from "node:fs";
import { encodeAbiParameters, encodeFunctionData, parseAbiParameters, zeroAddress, zeroHash } from "viem";
const { abi } = JSON.parse(fs.readFileSync(new URL("../app/contracts/abi-inputs/helpersTradeExactInput.json", import.meta.url), "utf8"));
const address = n => `0x${n.toString(16).padStart(40, "0")}`;
const [cygld, weth, paxg, xaut, usdc, payer, helpers] = [1,2,3,4,5,6,7].map(address);
const tokenMinimum = "(uint8 kind,address token,uint256 id,uint256 minimumAmount)";
const template = "(address inputCurrency,address outputCurrency,uint256 minimumOutput,(uint32 sharePpm,(uint8 kind,address currencyOut,uint24 fee,int24 tickSpacing)[] steps)[] routes)";
const continuation = `(${template} route,uint256 feeCygld)`;
const encode = (type, value) => encodeAbiParameters(parseAbiParameters(type), [value]);
const hop = (kind, currencyOut, fee = 0, tickSpacing = 0) => ({ kind, currencyOut, fee, tickSpacing });
const route = (inputCurrency, outputCurrency, steps) => ({ inputCurrency, outputCurrency, minimumOutput: 0n,
  routes: [{ sharePpm: 1000000, steps }] });
const mixed = route(weth, paxg, [hop(0, usdc), hop(1, xaut, 3000), hop(2, paxg, 500, 10)]);
const finish = currency => ({ route: route(currency, cygld, [hop(2, cygld, 500, 10)]), feeCygld: 1n });
const continuations = [finish(paxg), finish(xaut)];
const expectedOutputs = [{ kind: 0, token: paxg, id: 0n, minimumAmount: 10n }, { kind: 0, token: xaut, id: 0n, minimumAmount: 11n },
  { kind: 1, token: cygld, id: BigInt(paxg), minimumAmount: 2n }];
const coreBuy = encode(`(address[] basketAssets,(uint256 amountIn,${template} route)[] acquisitions,${continuation}[] continuations)`, {
  basketAssets: [paxg,xaut], acquisitions: [{ amountIn: 70n, route: mixed }, { amountIn: 50n, route: route(weth,xaut,[hop(1,xaut,3000)]) }], continuations });
const marketBuy = encode(`(${template} route,uint256 feeCygld)`, { route: route(weth,cygld,[hop(2,cygld,500,10)]), feeCygld: 1n });
const coreSell = encode(`(${tokenMinimum}[] expectedOutputs,${template}[] conversions)`, { expectedOutputs,
  conversions: [route(paxg,weth,[hop(1,weth,3000)]),route(xaut,weth,[hop(0,weth)]),route(cygld,weth,[])] });
const marketSell = encode(`(${template} route,uint256 feeCygld)`, { route: route(cygld,weth,[hop(2,weth,500,10)]), feeCygld: 1n });
const scalar = branches => encode("((uint8 kind,uint256 amountIn,bytes data)[] branches)", { branches });
const rows = [
  { name:"native-buy-mixed-core-market-v2-v3-v4", intent:0, inputs:[{currency:zeroAddress,amount:200n}], outputCurrency:cygld,
    body:scalar([{kind:0,amountIn:120n,data:coreBuy},{kind:1,amountIn:80n,data:marketBuy}]) },
  { name:"native-output-sale-mixed-core-market-recovery",intent:1,inputs:[{currency:cygld,amount:100n}],outputCurrency:zeroAddress,
    body:scalar([{kind:0,amountIn:40n,data:coreSell},{kind:1,amountIn:60n,data:marketSell}]) },
  { name:"exact-basket-issuance-continuations",intent:2,inputs:[{currency:paxg,amount:300n},{currency:xaut,amount:500n}],outputCurrency:cygld,
    body:encode(`(${continuation}[] continuations)`, {continuations}) },
  { name:"exact-basket-redemption-full-vector",intent:3,inputs:[{currency:cygld,amount:100n}],outputCurrency:zeroAddress,
    body:encode(`(${tokenMinimum}[] expectedOutputs)`, {expectedOutputs}) },
];
const fixtures = rows.map(({name,...fields}) => {
  const plan = {...fields,recipient:payer,deadline:2000000000n,minimumOutput:fields.intent === 3 ? 0n : 1n};
  const funding = {authorizations:plan.inputs.map(() => ({kind:0,permit:{value:0n,deadline:0n,v:0,r:zeroHash,s:zeroHash}})),
    permit2:{permit:{permitted:[],nonce:0n,deadline:0n},signature:"0x"}};
  return {name,helpers,payer,plan,funding,nativeValue:plan.inputs.reduce((sum,input)=>input.currency===zeroAddress?sum+input.amount:sum,0n),
    calldata:encodeFunctionData({abi,functionName:"executeExactInput",args:[plan,funding]})};
});
const output = JSON.stringify({schema:"cybergold.universal-exact-input.v1",selector:"0xabf176fd",fixtures},(_key,value)=>typeof value==="bigint"?String(value):value,2)+"\n";
const target = new URL("../tests/fixtures/universal-exact-input.json",import.meta.url);
if(process.argv.includes("--check")) { if(fs.readFileSync(target,"utf8")!==output) throw new Error("Universal exact-input fixture drift"); }
else fs.writeFileSync(target,output);
