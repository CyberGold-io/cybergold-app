import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getAddress, toHex } from "viem";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createEconomicQuoteSearch, type UpperEstimateDisplayPolicy } from "./economicQuoteSearch.ts";
import { economicQuoteKey, economicQuoteOptions, progressiveEconomicQuoteOptions, type EconomicQuote, type EconomicRequest } from "./economicQuotes.ts";
import { diagnosticReferences, retainDiagnosticReferences } from "./diagnosticReferences.ts";
import { QuotePreviewError } from "./quoteErrors.ts";
import { captureTradeQuote, economicTradeQuote, tradeAdapter, tradeQuoteResult } from "./tradeQuote.ts";
import { submitTradeQuote } from "./tradeExecution.ts";
import type { useTradeFlow } from "../hooks/flows/useTradeFlow.ts";

const token="0x0000000000000000000000000000000000000002",core="0x0000000000000000000000000000000000000003";
const request: EconomicRequest={intent:0,inputs:[{currency:token,amount:"100"}],outputCurrency:core};
const scope={chainId:31338,configuration:"deployment-a",generation:"fork-a"};
function quote(output="10",hash="a",funding="100"):EconomicQuote {
  return {strategy:"universal",routeFamily:"mixed",request:structuredClone(request),inputs:[{currency:token,amount:funding}],quotedOutput:output,
    fees:{coreProtocolFeeCygld:output,coreHelpersFeeCygld:"2",marketFeeCygld:"3"},
    context:{chainId:31338,blockNumber:"100",blockHash:`0x${hash.repeat(64)}`,observedAt:"2026-10-31T00:00:00Z"},
    plan:{allocations:[{kind:1,amountIn:funding}],body:{version:output},conversions:{}},
    reuseSample:{referenceInput:funding,netOutput:output,fees:{coreProtocolFeeCygld:output,coreHelpersFeeCygld:"2",marketFeeCygld:"3"},basis:"observed-nonretained"},
    deployment:{helpers:core,adapter:token,encoding:'uniswap-routing-v1'},estimatedRecipientOutputs:[],estimatedRetainedInputCharges:[],recoveryShares:[]} as unknown as EconomicQuote;
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function transport() {
  let controller!:ReadableStreamDefaultController<Uint8Array>,signal:AbortSignal|undefined,calls=0,cancelled=false;
  const bodies:Record<string,unknown>[]=[];
  const encoder=new TextEncoder();
  const fetcher=(async(path,options)=>{
    calls++;assert.equal(path,"/api/economic-quotes/stream");signal=options?.signal??undefined;bodies.push(JSON.parse(String(options?.body)));
    return new Response(new ReadableStream<Uint8Array>({start(value){controller=value;},cancel(){cancelled=true;}}),
      {headers:{"content-type":"application/x-ndjson"}});
  }) as typeof fetch;
  return {fetcher,frame:(value:unknown)=>controller.enqueue(encoder.encode(JSON.stringify(value)+"\n")),
    raw:(value:string)=>controller.enqueue(encoder.encode(value)),end:()=>controller.close(),
    calls:()=>calls,bodies,aborted:()=>signal?.aborted,cancelled:()=>cancelled};
}
function fixture(prior?:EconomicQuote) {
  const client=new QueryClient(),key=economicQuoteKey(request,scope),wire=transport();
  if(prior)client.setQueryData(key,prior);
  const search=createEconomicQuoteSearch(client,key);
  const run=(refresh=false,upperEstimate?:UpperEstimateDisplayPolicy)=>client.fetchQuery({...economicQuoteOptions(request,scope),staleTime:0,
    queryFn:({signal})=>search.run(request,signal,refresh,wire.fetcher,upperEstimate)});
  return {client,key,wire,search,run,close:()=>client.clear()};
}

const upper=(output="10",key:readonly unknown[]=economicQuoteKey(request,scope)):UpperEstimateDisplayPolicy=>
  ({requestKey:JSON.stringify(key),quotedOutput:BigInt(output)});

test("an early candidate below the displayed upper estimate is private until upper settlement",async()=>{
  const f=fixture(),pending=f.run(false,upper());
  try{
    await tick();f.wire.frame({type:"qualified",value:quote("8")});await tick();
    f.wire.frame({type:"qualified",value:quote("9","a","90")});await tick();
    assert.equal(f.search.current(),undefined);assert.equal(f.search.snapshot().value,undefined);
    assert.equal(f.client.getQueryData(f.key),undefined,"hidden work must not bootstrap another intent");
    assert.equal(f.client.getQueryState(f.key)?.fetchStatus,"fetching");
    f.wire.frame({type:"upper-replay-settled"});await tick();
    assert.equal(f.search.current()?.quotedOutput,"9");assert.equal(f.search.current()?.inputs[0].amount,"90");
    assert.equal((f.client.getQueryData(f.key)as EconomicQuote).quotedOutput,"9");
    f.wire.frame({type:"complete",value:quote("8")});assert.equal((await pending).quotedOutput,"9");
  }finally{f.close();}
});

for(const output of ["10","11"])test(`upper estimate comparison is strictly higher net output (${output})`,async()=>{
  const f=fixture(),pending=f.run(false,upper());
  try{
    await tick();f.wire.frame({type:"qualified",value:quote(output,"a","90")});await tick();
    assert.equal(f.search.current()?.quotedOutput,output==="11"?"11":undefined,"lower funding cannot break an estimate tie");
    f.wire.frame({type:"upper-replay-settled"});await tick();assert.equal(f.search.current()?.quotedOutput,output);
    f.wire.frame({type:"complete",value:quote(output)});await pending;
  }finally{f.close();}
});

test("the current upper display changes before readiness, disappears, and never retracts visible readiness",async()=>{
  const f=fixture(),pending=f.run(false,upper());
  try{
    await tick();f.search.setUpperEstimate(upper("12"));
    f.wire.frame({type:"qualified",value:quote("11")});await tick();assert.equal(f.search.current(),undefined);
    f.search.setUpperEstimate(upper("13"));assert.equal(f.search.current(),undefined);
    f.search.setUpperEstimate(upper("10"));assert.equal(f.search.current()?.quotedOutput,"11");
    f.search.setUpperEstimate(upper("99"));assert.equal(f.search.current()?.quotedOutput,"11");
    f.wire.frame({type:"qualified",value:quote("12")});await tick();assert.equal(f.search.current()?.quotedOutput,"12");
    f.wire.frame({type:"complete",value:quote("12")});await pending;
  }finally{f.close();}
  const removed=fixture(),replacement=removed.run(false,upper());
  try{
    await tick();removed.wire.frame({type:"qualified",value:quote("8")});await tick();
    removed.search.setUpperEstimate();assert.equal(removed.search.current()?.quotedOutput,"8");
    removed.wire.frame({type:"complete",value:quote("8")});await replacement;
  }finally{removed.close();}
});

test("upper display policy cannot cross request budget, configuration, generation or native/ERC20 family",async()=>{
  for(const wrongKey of [economicQuoteKey({...request,inputs:[{currency:token,amount:"101"}]},scope),
    economicQuoteKey(request,{...scope,configuration:"deployment-b"}),economicQuoteKey(request,{...scope,generation:"fork-b"}),
    economicQuoteKey({...request,inputs:[{currency:"0x0000000000000000000000000000000000000000",amount:"100"}]},scope)]){
    const f=fixture(),pending=f.run(false,upper("99",wrongKey));
    try{await tick();f.wire.frame({type:"qualified",value:quote("8")});await tick();assert.equal(f.search.current()?.quotedOutput,"8");
      f.wire.frame({type:"complete",value:quote("8")});await pending;}finally{f.close();}
  }
});

for(const release of ["stored","marker-first","complete","complete-only","ordinary-error","eof"]as const)
  test(`${release} releases available validated work without an upper replacement`,async()=>{
    const f=fixture(),pending=f.run(false,upper()),checked=release==="ordinary-error"||release==="eof"?assert.rejects(pending,QuotePreviewError):undefined;
    try{
      await tick();const best=quote("8");if(release==="stored")best.observation={source:"stored",refresh:false};
      if(release==="marker-first")f.wire.frame({type:"upper-replay-settled"});
      if(release!=="complete-only")f.wire.frame({type:"qualified",value:best});await tick();
      assert.equal(f.search.current()?.quotedOutput,release==="stored"||release==="marker-first"?"8":undefined);
      if(release==="ordinary-error")f.wire.frame({type:"error",code:"rpc-timeout"});
      else if(release==="eof")f.wire.end();else f.wire.frame({type:"complete",value:best});
      if(checked)await checked;else assert.equal((await pending).quotedOutput,"8");
      assert.equal(f.search.current()?.quotedOutput,"8");assert.equal((f.client.getQueryData(f.key)as EconomicQuote).quotedOutput,"8");
    }finally{f.close();}
  });

test("caller stop discards hidden work before queued upper settlement and cannot seed a revisit",async()=>{
  const f=fixture(),pending=f.run(false,upper());
  try{
    await tick();f.wire.frame({type:"qualified",value:quote("8")});await tick();
    f.wire.frame({type:"upper-replay-settled"});f.search.stop();await pending.catch(()=>{});await tick();
    assert.equal(f.search.current(),undefined);assert.equal(f.client.getQueryData(f.key),undefined);
    const revisit=createEconomicQuoteSearch(f.client,f.key);assert.equal(revisit.current(),undefined);
  }finally{f.close();}
});

test("canonical invalidation discards hidden work and later settlement/error cannot release it",async()=>{
  const f=fixture(),pending=f.run(false,upper()),checked=assert.rejects(pending,QuotePreviewError);
  try{
    await tick();const best=quote("8");f.wire.frame({type:"qualified",value:best});await tick();
    f.wire.frame({type:"invalidated",context:best.context});f.wire.frame({type:"upper-replay-settled"});
    f.wire.frame({type:"error",code:"quote-unavailable"});await checked;
    assert.equal(f.search.current(),undefined);assert.equal(f.client.getQueryData(f.key),null);
  }finally{f.close();}
});

test("a visible historical Refresh incumbent preserves existing readiness rather than applying an upper hold",async()=>{
  const f=fixture(quote("7","b")),pending=f.run(true,upper("99"));
  try{await tick();f.wire.frame({type:"qualified",value:quote("8")});await tick();
    assert.equal(f.search.current()?.quotedOutput,"8");f.wire.frame({type:"complete",value:quote("8")});await pending;
  }finally{f.close();}
});

test("qualified whole snapshots are ready and cached while the actual QueryClient promise is still fetching",async()=>{
  const f=fixture(),pending=f.run();
  try{
    await tick();const first=quote();f.wire.frame({type:"qualified",value:first,requestId:"33333333-3333-4333-8333-333333333333"});await tick();
    assert.equal(diagnosticReferences(f.search.current()).requestId,"33333333-3333-4333-8333-333333333333");
    assert.deepEqual(f.search.current(),first);assert.deepEqual(f.client.getQueryData(f.key),first);
    assert.equal(f.client.getQueryState(f.key)?.fetchStatus,"fetching");assert.equal(f.search.snapshot().optimizing,true);
    const better=quote("12","a","90");f.wire.frame({type:"qualified",value:better});await tick();
    assert.deepEqual(f.search.current(),better);assert.equal(f.search.current()?.fees.coreProtocolFeeCygld,"12");
    assert.equal(f.search.current()?.inputs[0].amount,"90");
    f.wire.frame({type:"complete",value:first});
    assert.deepEqual(await pending,better,"a terminal frame cannot roll back an already delivered best tuple");
    assert.equal(f.search.snapshot().optimizing,false);assert.equal(f.client.getQueryState(f.key)?.fetchStatus,"idle");
  }finally{f.close();}
});

test("stop advances ownership before abort, retains ready cache on cancellation and does not restart on remount",async()=>{
  const f=fixture(),pending=f.run();
  try{
    await tick();const first=quote();f.wire.frame({type:"qualified",value:first});await tick();
    const captured=structuredClone(f.search.current());
    f.wire.frame({type:"qualified",value:quote("99")});f.search.stop();
    await pending.catch(()=>{});await tick();
    assert.equal(f.wire.aborted(),true);assert.equal(f.wire.cancelled(),true);
    assert.deepEqual(f.search.current(),captured);assert.deepEqual(f.client.getQueryData(f.key),captured);
    const observer=new QueryObserver(f.client,{...economicQuoteOptions(request,scope),queryFn:()=>{throw new Error("Unexpected restart");}});
    const unsubscribe=observer.subscribe(()=>{});await tick();
    assert.deepEqual(observer.getCurrentResult().data,captured);assert.equal(f.wire.calls(),1);unsubscribe();
  }finally{f.close();}
});

for(const failure of ["identified","eof","malformed"] as const)for(const ready of [false,true]){
  test(`${failure} ${ready?"after":"before"} ready preserves only an already validated incumbent`,async()=>{
    const f=fixture(),pending=f.run();const checked=assert.rejects(pending,(error:unknown)=>error instanceof QuotePreviewError&&
      error.code===(failure==="identified"?"quote-no-route":"quote-stream-interrupted"));
    try{
      await tick();if(ready){f.wire.frame({type:"qualified",value:quote()});await tick();}
      if(failure==="identified")f.wire.frame({type:"error",code:"quote-no-route",error:"No route."});
      else if(failure==="malformed")f.wire.raw("{\n");else f.wire.end();
      await checked;
      assert.equal(f.search.current()?.quotedOutput,ready?"10":undefined);
      assert.equal(f.search.snapshot().optimizing,false);assert.ok(f.search.snapshot().error instanceof QuotePreviewError);
      assert.equal((f.client.getQueryData(f.key)as EconomicQuote|undefined)?.quotedOutput,ready?"10":undefined);
    }finally{f.close();}
  });
}

test("canonical disproof clears published cache and cannot be resurrected by cancel rollback",async()=>{
  const f=fixture(),pending=f.run();const checked=assert.rejects(pending,QuotePreviewError);
  try{
    await tick();const invalid=quote();f.wire.frame({type:"qualified",value:invalid});await tick();
    f.wire.frame({type:"invalidated",context:invalid.context});await tick();
    assert.equal(f.search.current(),undefined);assert.equal(f.client.getQueryData(f.key),null);
    f.wire.frame({type:"qualified",value:quote("99")});
    f.wire.frame({type:"error",code:"quote-unavailable",error:"Snapshot changed."});await checked;
    f.search.stop();await tick();assert.equal(f.search.current(),undefined);assert.equal(f.client.getQueryData(f.key),null);
  }finally{f.close();}
});

for(const distinct of [false,true])test(`Refresh disproof ${distinct?"retains a distinct historical":"removes the same historical"} context`,async()=>{
  const previous=quote("8",distinct?"b":"a"),f=fixture(previous),pending=f.run(true),checked=assert.rejects(pending,QuotePreviewError);
  try{
    await tick();const invalid=quote();f.wire.frame({type:"qualified",value:invalid});await tick();
    f.wire.frame({type:"invalidated",context:invalid.context});f.wire.frame({type:"error",code:"quote-unavailable"});await checked;
    assert.deepEqual(f.search.current(),distinct?previous:undefined);f.search.stop();await tick();
    assert.deepEqual(f.client.getQueryData(f.key),distinct?previous:null);
  }finally{f.close();}
});

test("a Refresh failure before any replacement retains the accepted historical quote",async()=>{
  const previous=quote("8","b"),f=fixture(previous),pending=f.run(true),checked=assert.rejects(pending,QuotePreviewError);
  try{await tick();f.wire.frame({type:"error",code:"rpc-timeout"});await checked;
    assert.deepEqual(f.search.current(),previous);assert.deepEqual(f.client.getQueryData(f.key),previous);
  }finally{f.close();}
});

test("a disproved empty cache slot starts an ordinary new search when the user revisits it",async()=>{
  const f=fixture();f.client.setQueryData(f.key,null);
  const search=createEconomicQuoteSearch(f.client,f.key);
  assert.equal(search.snapshot().invalidated,true);
  const observer=new QueryObserver<EconomicQuote|null>(f.client,{...progressiveEconomicQuoteOptions(request,scope),queryFn:({signal})=>search.run(request,signal,false,f.wire.fetcher)});
  const stop=observer.subscribe(()=>{});
  try{await tick();assert.equal(search.snapshot().invalidated,true,"known disproof remains visible while replacement is held");assert.equal(f.wire.calls(),1);assert.equal(f.wire.bodies[0].refresh,true,"known disproof cannot retrieve the same stored historical tuple");
    f.wire.frame({type:'qualified',value:quote('13','b')});f.wire.frame({type:'complete',value:quote('13','b')});await tick();
    assert.equal(observer.getCurrentResult().data?.quotedOutput,"13");assert.equal(search.snapshot().invalidated,false);}
  finally{stop();f.close();}
});

test("the real trade-flow capture binds the latest received ref even before its rendered selection updates",async()=>{
  const input={side:'buy' as const,mode:'exact-in' as const,counterToken:token,native:false,amount:'100',recipient:core,slippageBps:100};
  const old=quote('10'),next=quote('12','a','90');
  const oldRefs={requestId:'11111111-1111-4111-8111-111111111111'},newRefs={requestId:'22222222-2222-4222-8222-222222222222'};
  retainDiagnosticReferences(old,oldRefs);retainDiagnosticReferences(next,newRefs);
  const rendered=tradeQuoteResult(economicTradeQuote(old,input),100),latest=tradeQuoteResult(economicTradeQuote(next,input),100);
  let stopped=0;let submitted:unknown[]|undefined;
  const deps:Record<string,unknown>={react:{useCallback:(value:unknown)=>value},viem:{getAddress,toHex},'@/app/types':{CORE_TOKEN_KIND:{ERC1155:1}},
    '@/app/utils/tradeQuote':{captureTradeQuote,tradeAdapter},'@/app/utils/tradeExecution':{submitTradeQuote},'@/app/utils/quoteIntent':{quoteIntentResult:()=>{throw new Error('Unexpected legacy Core');}},
    './quotes/useTradeQuote':{useTradeQuote:()=>({data:rendered,captureReady:()=>latest,stopSearch:()=>{stopped++;},status:'success'})},
    './shared/useTokenPurchaseExecution':{useTokenPurchaseExecution:()=>({submitTokenPurchase:async()=>{throw new Error('Unexpected legacy execution');}})},
    './shared/useUniversalExactInputExecution':{useUniversalExactInputExecution:()=>({submit:async(...args:unknown[])=>{submitted=args;return'0xfixture';}})},
    './shared/useMarketSwapExecution':{useMarketSwapExecution:()=>({submit:async()=>{throw new Error('Unexpected legacy Market');}})}};
  const output=ts.transpileModule(readFileSync(new URL('../hooks/flows/useTradeFlow.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const exported:{useTradeFlow?:typeof useTradeFlow}={};runInNewContext(output,{exports:exported,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];},structuredClone});
  const flow=exported.useTradeFlow!({input,enabled:true});assert.equal(flow.selected?.quotedOutput,10n);
  const captured=flow.captureSubmission()!;flow.stopSearch();latest.value.quotedOutput='99';
  assert.deepEqual(rendered.diagnostics,oldRefs);assert.deepEqual(captured.selectedTrade.diagnostics,newRefs);
  assert.deepEqual(diagnosticReferences(captured.universalQuote),newRefs);
  assert.equal(captured.selectedTrade.quotedOutput,12n);assert.equal(captured.selectedTrade.value.quotedOutput,'12');
  await captured.submit({owner:token,recipient:core});assert.equal(stopped,1);
  assert.equal((submitted?.[0]as EconomicQuote).quotedOutput,'12');assert.equal((submitted?.[0]as EconomicQuote).inputs[0].amount,'90');
  assert.equal((submitted?.[2]as {minimumOutput:string}).minimumOutput,'11');
});

test("stopping one QueryClient subscription leaves another caller's producer alive",async()=>{
  const left=fixture(),right=fixture(),a=left.run(),b=right.run();
  try{await tick();left.wire.frame({type:"qualified",value:quote()});right.wire.frame({type:"qualified",value:quote("12")});await tick();
    left.search.stop();await a.catch(()=>{});assert.equal(right.wire.aborted(),false);
    right.wire.frame({type:"complete",value:quote("12")});assert.equal((await b).quotedOutput,"12");
  }finally{left.close();right.close();}
});
