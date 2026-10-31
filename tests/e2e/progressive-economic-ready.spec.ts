import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "./fixtures/app-test";
import { install, context } from "./fixtures/token-quotes";
import { economicFixture } from "./fixtures/economic-api";
import { universalFixture } from "./fixtures/universal-exact-input";
import { selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";
import { protocolConfigurationFixture as config } from "../fixtures/protocol-configuration";
import { installQuoteObservation, quoteObservations } from "../trading/quoteObservation";
import { uiQuoteReady } from "../trading/uiQuotePreparation";
import { tradeScenarios } from "../trading/scenarios";
import { selectBasket } from "./fixtures/swap-selection";
import { tokenAddresses } from "../fixtures/protocol-configuration";
import type { EconomicQuote, EconomicRequest } from "../../app/utils/economicQuotes";

const unit=10n**18n,owner="0x0000000000000000000000000000000000000011";
async function wallet(page:Page){
  await page.addInitScript(({owner,chain})=>{
    const provider={isMetaMask:false,selectedAddress:owner,on:()=>{},removeListener:()=>{},request:async({method}:{method:string})=>{
      if(["eth_accounts","eth_requestAccounts"].includes(method))return[owner];
      if(method==="wallet_requestPermissions")return[{parentCapability:"eth_accounts",caveats:[{type:"restrictReturnedAccounts",value:[owner]}]}];
      if(method==="eth_chainId")return`0x${chain.toString(16)}`;if(method==="net_version")return String(chain);
      throw new Error("Read-only progressive fixture");
    }};
    Object.defineProperty(window,"ethereum",{value:provider,configurable:true});
    const announce=()=>window.dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail:{provider,info:{
      uuid:"f5640300-0353-45e0-b3c8-1850146e0788",name:"Synthetic ordinary wallet",rdns:"io.synthetic.ordinary",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"}}}));
    window.addEventListener("eip6963:requestProvider",announce);announce();
  },{owner,chain:config.chainId});
  await page.route("**/api/account/wallet-balances*",route=>route.fulfill({json:{holder:owner,context,native:{status:"success",value:String(1000n*unit)},
    tokens:config.tokens.filter(row=>row.type==="erc20").map(row=>({id:row.id,address:row.address,balance:{status:"success",value:String(1000n*unit)}}))}}));
  await page.route("**/api/account/native-balance*",route=>route.fulfill({json:{holder:owner,context,balance:String(1000n*unit)}}));
  await page.route("**/api/transaction/fees",route=>route.fulfill({json:{context,maxFeePerGas:"2000000000",maxPriorityFeePerGas:"1000000000"}}));
}
type Connection={input:EconomicRequest;response:ServerResponse;closed:boolean;frame:(frame:unknown)=>void;end:()=>void};
async function streams(page:Page){
  const connections:Connection[]=[];
  const server=createServer(async(request,response)=>{
    response.setHeader("Access-Control-Allow-Origin","*");response.setHeader("Access-Control-Allow-Headers","content-type,x-cybergold-attempt-id");
    response.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
    if(request.method==="OPTIONS"){response.writeHead(204);response.end();return;}
    let body="";for await(const chunk of request)body+=chunk;
    response.writeHead(200,{"content-type":"application/x-ndjson","cache-control":"no-store"});response.flushHeaders();
    const connection:Connection={input:JSON.parse(body),response,closed:false,frame:frame=>{if(!response.destroyed)response.write(JSON.stringify(frame)+"\n");},end:()=>response.end()};
    response.on("close",()=>{connection.closed=true;});connections.push(connection);
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url=`http://127.0.0.1:${(server.address()as AddressInfo).port}/economic`;
  await page.route("**/api/economic-quotes/stream",route=>route.fulfill({status:307,headers:{location:url}}));
  return{connections,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
function value(input:EconomicRequest,output="10",funding=input.inputs[0].amount):EconomicQuote{
  const amount=String(BigInt(output.replace('.',''))*unit/(output.includes('.')?10n:1n));
  const quote=economicFixture(universalFixture({...input,inputs:input.inputs.map((row,index)=>({...row,amount:index===0?funding:row.amount})),recipient:owner,deadline:"2000000000"},{routeFamily:input.intent>=2?'core':"mixed",quotedOutput:input.intent===3?'0':amount,
    recipientOutputs:input.intent===3?[{kind:0,token:tokenAddresses.PAXG,id:'0',amount}]:undefined,
    coreProtocolFeeCygld:String(output==="10"?unit/100n:unit/50n),coreHelpersFeeCygld:"0",marketFeeCygld:String(unit/1000n)}),input);
  quote.inputs[0].amount=funding;quote.quotedInput=quote.inputMaximum=funding;
  if(input.intent<2)quote.reuseSample={referenceInput:funding,netOutput:quote.quotedOutput,fees:quote.fees,basis:"observed-nonretained"};return quote;
}

for(const symbol of ["USDT","ETH"])test(`${symbol}: first canonical frame enables Swap before complete, later tuple improves and edited hint stays immediate`,async({page})=>{
  await install(page);await wallet(page);await page.addInitScript(installQuoteObservation as()=>void);const wire=await streams(page);
  try{
    await page.goto('/en');await expect(page.getByRole('button',{name:'Open wallet menu',exact:true})).toBeVisible();
    await showAllSellTokens(page);await selectToken(page,'sell',symbol);
    await page.locator('#sell-amount').fill(symbol==='USDT'?'200':'1');await expect.poll(()=>wire.connections.length).toBe(1);
    const connection=wire.connections[0],first=value(connection.input);connection.frame({type:'qualified',value:first});
    await expect(page.locator('#buy-amount')).toHaveText('10');await expect(page.locator('[data-trade-action]')).toBeEnabled();
    expect(connection.closed).toBe(false);expect((await quoteObservations(page)).at(-1)?.terminal).toBeUndefined();
    await page.getByRole('button',{name:/Total fee/}).click();
    const funding=symbol==='USDT'?'170000000':'900000000000000000',better=value(connection.input,'12',funding);
    connection.frame({type:'qualified',value:better});await expect(page.locator('#buy-amount')).toHaveText('12');
    await expect(page.locator('[data-trade-display="feeProtocolValue"]')).toContainText('0.02 CYGLD');
    if(symbol==='ETH'){
      const scenario={...tradeScenarios.find(row=>row.asset==='ETH'&&row.side==='buy'&&row.inputMode==='exact-in')!,amountRaw:connection.input.inputs[0].amount};
      expect(uiQuoteReady(await quoteObservations(page),scenario,config,true)).toBe(true);
    }
    await page.clock.install();const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+1000));
    await page.locator('#sell-amount').fill(symbol==='USDT'?'170':'0.9');
    await expect.poll(async()=>{await page.clock.runFor(0);return page.locator('#buy-amount').textContent();}).toBe('12');
    expect(wire.connections).toHaveLength(1);await expect(page.locator('[data-trade-action]')).toBeDisabled();
    await page.clock.runFor(150);await expect.poll(()=>wire.connections.length).toBe(2);await expect.poll(()=>connection.closed).toBe(true);
    const second=wire.connections[1];second.frame({type:'qualified',value:value(second.input,'11.5')});
    await expect.poll(async()=>{await page.clock.runFor(0);return page.locator('#buy-amount').textContent();}).toBe('11.5');
    await expect(page.locator('[data-trade-action]')).toBeEnabled();second.frame({type:'complete',value:value(second.input,'10')});second.end();
    await expect(page.locator('#buy-amount')).toHaveText('11.5');
  }finally{await wire.close();}
});

for(const intent of [2,3]as const)test(`basket intent${intent}: early-ready snapshot is captured and its stream stops before unsigned preparation`,async({page})=>{
  await install(page);await wallet(page);const wire=await streams(page);const posted:{quote:EconomicQuote;acceptedBounds:{minimumOutput:string;expectedCoreOutputs?:{minimumAmount:string}[]}}[]=[];
  await page.route('**/api/tx-preparations',async route=>{posted.push(route.request().postDataJSON());await route.fulfill({status:503,json:{code:'quote-unavailable'}});});
  try{
    await page.goto('/en');await expect(page.getByRole('button',{name:'Open wallet menu',exact:true})).toBeVisible();await showAllSellTokens(page);
    if(intent===3)await page.getByRole('button',{name:'Reverse swap direction'}).click();
    await selectBasket(page,intent===2?'sell':'buy');
    const input=intent===2?page.getByRole('textbox',{name:'Sell amount (PAXG)',exact:true}):page.locator('#sell-amount');await input.fill('1');
    await expect.poll(()=>wire.connections.length).toBe(1);const connection=wire.connections[0];expect(connection.input.intent).toBe(intent);
    connection.frame({type:'qualified',value:value(connection.input)});await expect(page.locator('[data-trade-action]')).toBeEnabled();
    expect(connection.closed).toBe(false);
    if(intent===2)await expect(page.locator('#buy-amount')).toHaveText('10');
    else await expect(page.locator('#buy-basket-composition').getByRole('status',{name:'Buy amount (PAXG)',exact:true})).toHaveText('10');
    await page.locator('[data-trade-action]').click();await expect.poll(()=>posted.length).toBe(1);await expect.poll(()=>connection.closed).toBe(true);
    expect(posted[0].quote.request.intent).toBe(intent);
    if(intent===2)expect(posted[0].acceptedBounds.minimumOutput).toBe(String(99n*unit/10n));
    else expect(posted[0].acceptedBounds.expectedCoreOutputs?.[0].minimumAmount).toBe(String(99n*unit/10n));
    expect(wire.connections).toHaveLength(1);
  }finally{await wire.close();}
});

test('click stops only refinement and binds latest quote/funding/bounds to independent unsigned preparation; refusal does not restart it',async({page})=>{
  await install(page);await wallet(page);const wire=await streams(page);const preparations:{quote:EconomicQuote;acceptedBounds:{minimumOutput:string;inputs:{amount:string}[]}}[]=[];
  await page.route('**/api/tx-preparations',async route=>{preparations.push(route.request().postDataJSON());await route.fulfill({status:503,json:{code:'quote-unavailable',error:'Read-only preparation refusal.'}});});
  try{
    await page.goto('/en');await expect(page.getByRole('button',{name:'Open wallet menu',exact:true})).toBeVisible();await showAllSellTokens(page);await selectToken(page,'sell','USDT');
    await page.locator('#sell-amount').fill('200');await expect.poll(()=>wire.connections.length).toBe(1);
    const connection=wire.connections[0];connection.frame({type:'qualified',value:value(connection.input)});await expect(page.locator('[data-trade-action]')).toBeEnabled();
    const best=value(connection.input,'12','170000000');connection.frame({type:'qualified',value:best});await expect(page.locator('#buy-amount')).toHaveText('12');
    await page.locator('[data-trade-action]').click();await expect.poll(()=>connection.closed).toBe(true);
    connection.frame({type:'qualified',value:value(connection.input,'99')});
    await expect.poll(()=>preparations.length).toBe(1);expect(preparations[0].quote).toMatchObject({quotedOutput:best.quotedOutput,inputs:best.inputs,plan:best.plan});
    expect(preparations[0].acceptedBounds).toMatchObject({minimumOutput:String(12n*unit*99n/100n),inputs:[{amount:'170000000'}]});
    await expect(page.locator('#buy-amount')).toHaveText('12');await expect(page.locator('[data-trade-action]')).toBeEnabled();expect(wire.connections).toHaveLength(1);
    await page.locator('[data-trade-refresh]').click();await expect.poll(()=>wire.connections.length).toBe(2);
    wire.connections[1].frame({type:'error',code:'rpc-timeout'});wire.connections[1].end();
    await expect(page.getByRole('alert').filter({hasText:'Refresh failed. Showing the previous quote.'})).toBeVisible();
    await expect(page.locator('#buy-amount')).toHaveText('12');await expect(page.locator('[data-trade-action]')).toBeEnabled();
  }finally{await wire.close();}
});

for(const mode of ['error','eof','invalidated']as const)test(`a post-ready ${mode} ${mode==='invalidated'?'clears':'retains'} the incumbent`,async({page})=>{
  await install(page);await wallet(page);const wire=await streams(page);
  try{
    await page.goto('/en');await expect(page.getByRole('button',{name:'Open wallet menu',exact:true})).toBeVisible();await page.locator('#sell-amount').fill('1');await expect.poll(()=>wire.connections.length).toBe(1);
    const connection=wire.connections[0],ready=value(connection.input);connection.frame({type:'qualified',value:ready});
    await expect(page.locator('#buy-amount')).toHaveText('10');await expect(page.locator('[data-trade-action]')).toBeEnabled();
    if(mode==='invalidated')connection.frame({type:'invalidated',context:ready.context});
    if(mode!=='eof')connection.frame({type:'error',code:mode==='error'?'rpc-timeout':'quote-unavailable'});connection.end();
    if(mode==='invalidated'){await expect(page.locator('[data-trade-action]')).toBeDisabled();await expect(page.locator('#buy-amount')).not.toHaveText('10');}
    else{await expect(page.locator('#buy-amount')).toHaveText('10');await expect(page.locator('[data-trade-action]')).toBeEnabled();}
  }finally{await wire.close();}
});


test('a held revisit never resurrects a disproved restored display before its replacement qualifies',async({page})=>{
  await install(page);await wallet(page);
  await page.addInitScript(()=>{
    sessionStorage.setItem('cg:swap-form-state:v1',JSON.stringify({sellTokenId:'eth',buyTokenId:'cygld',sellAmount:'1'}));
    sessionStorage.setItem('cybergold:trade-display:v1:31337:en',JSON.stringify({
      intentKey:JSON.stringify(['eth','cygld','1','','']),scopeKey:JSON.stringify([31337,'en','USD','metric','fiat']),
      values:{sellTokenId:'eth',buyTokenId:'cygld',sellAmount:'1',buyAmount:'10',quoteComplete:'true',evaluationStatus:'confirmed',
        feeProtocolValue:'RESTORED CONFIRMED FEE',feeTotal:'RESTORED TOTAL FEE'}}));
  });
  const wire=await streams(page);
  try{
    await page.goto('/en');await expect(page.getByRole('button',{name:'Open wallet menu',exact:true})).toBeVisible();
    await expect.poll(()=>wire.connections.length).toBe(1);
    const original=wire.connections[0],ready=value(original.input);original.frame({type:'qualified',value:ready});
    await expect(page.locator('#buy-amount')).toHaveText('10');await expect(page.locator('[data-trade-action]')).toBeEnabled();
    original.frame({type:'invalidated',context:ready.context});original.frame({type:'error',code:'quote-unavailable'});original.end();
    await expect(page.locator('#buy-amount')).not.toHaveText('10');
    await page.locator('#sell-amount').fill('2');await expect.poll(()=>wire.connections.length).toBe(2);
    await page.locator('#sell-amount').fill('1');await expect.poll(()=>wire.connections.length).toBe(3);
    const revisit=wire.connections[2];expect((revisit.input as EconomicRequest&{refresh?:boolean}).refresh).toBe(true);
    await expect(page.locator('#swapsection')).not.toHaveAttribute('data-trade-evaluation','confirmed');
    await expect(page.locator('#buy-amount')).not.toHaveText('10');await expect(page.locator('[data-trade-action]')).toBeDisabled();
    await page.getByRole('button',{name:/Total fee/}).click();
    await expect(page.locator('[data-trade-display="feeProtocolValue"]')).not.toContainText('RESTORED CONFIRMED FEE');
    const replacement=value(revisit.input,'13');replacement.context={...replacement.context,blockHash:'0x'+'b'.repeat(64)};
    revisit.frame({type:'qualified',value:replacement});await expect(page.locator('#buy-amount')).toHaveText('13');
    await expect(page.locator('[data-trade-action]')).toBeEnabled();await expect(page.locator('#swapsection')).toHaveAttribute('data-trade-evaluation','confirmed');
  }finally{await wire.close();}
});
