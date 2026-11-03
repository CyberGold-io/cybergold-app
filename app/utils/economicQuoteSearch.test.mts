import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getAddress, toHex } from "viem";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createEconomicQuoteSearch, type UpperEstimateDisplayPolicy } from "./economicQuoteSearch.ts";
import { economicRequest, economicQuoteKey, economicQuoteOptions, progressiveEconomicQuoteOptions, type EconomicQuote, type EconomicRequest } from "./economicQuotes.ts";
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

test("display provenance keeps the better historical floor through stored frames and publishes fresh lower quotes immediately", async () => {
  const previous = quote("10", "b", "80"), f = fixture(previous), pending = f.run();
  try {
    assert.equal(f.search.snapshot().historical, true);
    await tick();
    const weaker = { ...quote("8", "b", "70"), observation: { source: "stored" as const, refresh: false } };
    f.wire.frame({ type: "qualified", value: weaker }); await tick();
    assert.deepEqual(f.search.current(), previous, "a weaker remote stored tuple cannot erase the complete local floor");
    assert.equal(f.search.snapshot().historical, true);
    const fresh = { ...quote("9", "a", "85"), observation: { source: "search" as const, refresh: false } };
    f.wire.frame({ type: "qualified", value: fresh }); await tick();
    assert.deepEqual(f.search.current(), fresh, "a fresh qualified tuple is authoritative even below the historical output or estimate");
    assert.equal(f.search.snapshot().historical, false);
    assert.equal(f.search.snapshot().optimizing, true, "fresh display does not wait for refinement to complete");
    f.wire.frame({ type: "complete", value: fresh }); await pending;
  } finally { f.close(); }
});

test("stored economic ties retain the whole known limited tuple; strictly better stored and fresh tuples keep their own metadata", async () => {
  const previous = quote("10", "b", "80");
  previous.reuseSample!.inputLimitObserved = true;
  const refs = { requestId: "11111111-1111-4111-8111-111111111111" };
  retainDiagnosticReferences(previous, refs);
  const f = fixture(previous), pending = f.run();
  try {
    await tick();
    for (const funding of ["80", "90"]) {
      f.wire.frame({ type: "qualified", value: { ...quote("10", "a", funding), observation: { source: "stored", refresh: false } } });
      await tick();
      assert.deepEqual(f.search.current(), previous);
      assert.deepEqual(diagnosticReferences(f.search.current()), refs);
      assert.equal(f.search.current()?.reuseSample?.inputLimitObserved, true);
    }
    const better = { ...quote("10", "a", "70"), observation: { source: "stored" as const, refresh: false } };
    f.wire.frame({ type: "qualified", value: better }); await tick();
    assert.deepEqual(f.search.current(), better);
    assert.equal(f.search.current()?.reuseSample?.inputLimitObserved, undefined, "capacity evidence is not grafted across chosen tuples");
    const fresh = { ...quote("10", "a", "90"), observation: { source: "search" as const, refresh: false } };
    f.wire.frame({ type: "qualified", value: fresh }); await tick();
    assert.deepEqual(f.search.current(), fresh, "fresh qualified authority does not use historical tie ranking");
    f.wire.frame({ type: "complete", value: fresh }); await pending;
  } finally { f.close(); }
});

for (const ending of ["complete", "error", "stop"] as const) test(`historical pending-estimate display ends on ${ending} and retains only the actual tuple`, async () => {
  const previous = quote("10", "b", "80"), f = fixture(previous), pending = f.run();
  const checked = ending === "error" ? assert.rejects(pending) : pending.catch(() => undefined);
  try {
    await tick();
    assert.equal(f.search.snapshot().historical && f.search.snapshot().optimizing, true);
    if (ending === "complete") f.wire.frame({ type: "complete", value: { ...previous, observation: { source: "stored", refresh: false } } });
    else if (ending === "error") f.wire.frame({ type: "error", code: "rpc-timeout" });
    else f.search.stop();
    await checked;
    assert.equal(f.search.snapshot().optimizing, false);
    assert.equal(f.search.current()?.inputs[0].amount, "80");
    assert.equal(f.search.current()?.quotedOutput, "10");
  } finally { f.close(); }
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

test("a larger-budget revisit offers its complete cached floor while ordinary optimization and explicit Refresh reprice", async () => {
  const client = new QueryClient(), wire = transport();
  const budget = (amount: string): EconomicRequest => ({ ...request,
    inputs: [{ currency: token, amount }] });
  const amounts = { small: "300000000000000000", middle: "400000000000000000", large: "500000000000000000" };
  const observed = (amount: string, funding: string, output: string) => ({
    ...quote(output, "b", funding), request: budget(amount),
    routeOrigins: { discoveryProviders: ["cybergold-custom"], marker: output },
  }) as EconomicQuote;
  const small = observed(amounts.small, amounts.small, "5304000000000000000");
  const oldLarge = { ...structuredClone(small), request: budget(amounts.large) };
  const middle = observed(amounts.middle, amounts.middle, "7070000000000000000");
  const refs = { requestId: "77777777-7777-4777-8777-777777777777" };
  retainDiagnosticReferences(middle, refs);
  for (const value of [small, oldLarge, middle]) client.setQueryData(economicQuoteKey(value.request, scope), value);
  const largeRequest = budget(amounts.large), key = economicQuoteKey(largeRequest, scope);
  const search = createEconomicQuoteSearch(client, key);
  const expected = { ...structuredClone(middle), request: largeRequest };
  let refreshing = false;
  const observer = new QueryObserver<EconomicQuote | null>(client, {
    ...progressiveEconomicQuoteOptions(largeRequest, scope, search.current()),
    queryFn: ({ signal }) => search.run(largeRequest, signal, refreshing, wire.fetcher),
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await tick();
    assert.equal(wire.calls(), 1, "a partial cached budget starts one ordinary optimization");
    assert.deepEqual(wire.bodies[0], economicRequest(largeRequest));
    assert.deepEqual(search.current(), expected, "only the requested budget is rebound; the complete .4 tuple survives");
    assert.deepEqual(diagnosticReferences(search.current()), refs);
    assert.notEqual(search.current(), middle, "selection owns a deep clone of the historical observation");
    assert.notEqual(search.current()?.plan, middle.plan);
    assert.equal(search.current()?.inputs[0].amount, amounts.middle);
    assert.deepEqual(client.getQueryData(key), oldLarge, "search initialization has no render-time cache mutation");
    assert.deepEqual(middle.request, budget(amounts.middle));

    const partial = observed(amounts.large, "473000000000000000", "8355000000000000000");
    wire.frame({ type: "qualified", value: partial });
    wire.frame({ type: "complete", value: partial });
    await tick();
    assert.deepEqual(search.current(), partial);
    assert.equal(observer.getCurrentResult().fetchStatus, "idle");
    refreshing = true;
    const pending = observer.refetch({ cancelRefetch: false });
    await tick();
    assert.equal(wire.calls(), 2);
    assert.deepEqual(wire.bodies[1], { ...economicRequest(largeRequest), refresh: true });
    assert.deepEqual(search.current(), partial, "the last qualified observation stays visible until Refresh replaces it");
    const fullBudget = observed(amounts.large, amounts.large, "8830000000000000000");
    wire.frame({ type: "qualified", value: fullBudget });
    await tick();
    assert.deepEqual(search.current(), fullBudget, "fresh qualified economics replace the cached floor normally");
    wire.frame({ type: "complete", value: fullBudget });
    assert.equal((await pending).data?.quotedOutput, fullBudget.quotedOutput);
    assert.equal(search.current()?.inputs[0].amount, amounts.large);
    assert.deepEqual(client.getQueryData(key), fullBudget);
  } finally { unsubscribe(); client.clear(); }
});

test("a known exact-context disproof still starts fresh pricing instead of reviving a neighboring observation", async () => {
  const client = new QueryClient(), key = economicQuoteKey(request, scope);
  const lower = { ...quote("20", "b", "50"), request: { ...request, inputs: [{ currency: token, amount: "50" }] } };
  try {
    client.setQueryData(economicQuoteKey(lower.request, scope), lower);
    client.setQueryData(key, null);
    const search = createEconomicQuoteSearch(client, key);
    assert.equal(search.current(), undefined);
    assert.equal(search.snapshot().invalidated, true);
  } finally { client.clear(); }
});


for (const generation of [undefined, null]) test(`serialized hook keys retain the stored ${generation} generation for lower-quote scope`, () => {
  const client = new QueryClient(), capturedScope = { ...scope, generation };
  const lower = { ...quote("20", "b", "50"), request: { ...request, inputs: [{ currency: token, amount: "50" }] } };
  const refs = { requestId: "88888888-8888-4888-8888-888888888888" };
  retainDiagnosticReferences(lower, refs);
  try {
    const key = economicQuoteKey(request, capturedScope);
    client.setQueryData(key, quote("10"));
    client.setQueryData(economicQuoteKey(lower.request, capturedScope), lower);
    const foreign = { ...lower, quotedOutput: "999" };
    client.setQueryData(economicQuoteKey(foreign.request, { ...capturedScope, generation: "other-generation" }), foreign);
    client.setQueryData(economicQuoteKey(foreign.request, { ...capturedScope, configuration: "other-configuration" }), foreign);
    const search = createEconomicQuoteSearch(client, JSON.parse(JSON.stringify(key)));
    assert.equal(search.current()?.quotedOutput, "20");
    assert.equal(search.current()?.inputs[0].amount, "50");
    assert.deepEqual(search.current()?.request, economicRequest(request));
    assert.deepEqual(diagnosticReferences(search.current()), refs);
    assert.equal((client.getQueryData(key) as EconomicQuote).quotedOutput, "10");
  } finally { client.clear(); }
});

for (const generation of [undefined, null]) test(`cold limited-budget visits preserve actual ${generation} scope without writing exact observations`, () => {
  for (const amount of ["480", "600", "700"]) {
    const client = new QueryClient(), actualScope = { ...scope, generation };
    const limited = { ...quote("8355", "b", "473"), request: { ...request, inputs: [{ currency: token, amount: "500" }] } };
    limited.reuseSample!.inputLimitObserved = true;
    const refs = { requestId: "11111111-1111-4111-8111-111111111111" }; retainDiagnosticReferences(limited, refs);
    const target = { ...request, inputs: [{ currency: token, amount }] }, key = economicQuoteKey(target, actualScope);
    try {
      client.setQueryData(economicQuoteKey(limited.request, actualScope), limited);
      const search = createEconomicQuoteSearch(client, JSON.parse(JSON.stringify(key)), actualScope);
      assert.equal(search.current()?.quotedOutput, "8355"); assert.equal(search.current()?.inputs[0].amount, "473");
      assert.equal(search.current()?.request.inputs[0].amount, amount);
      assert.deepEqual(search.current()?.plan, limited.plan); assert.deepEqual(diagnosticReferences(search.current()), refs);
      assert.equal(client.getQueryData(key), undefined, "initialization only offers the whole historical tuple");
      client.setQueryData(key, null);
      assert.equal(createEconomicQuoteSearch(client, key, actualScope).current(), undefined, "known disproof still excludes the historical floor");
    } finally { client.clear(); }
  }
});

test("an unknown lower route remains display-only for a cold owner but can improve an existing exact hit", () => {
  const client = new QueryClient(), target = { ...request, inputs: [{ currency: token, amount: "100" }] };
  const lower = { ...quote("10", "b", "80"), request: { ...request, inputs: [{ currency: token, amount: "80" }] } };
  const key = economicQuoteKey(target, scope);
  try {
    client.setQueryData(economicQuoteKey(lower.request, scope), lower);
    assert.equal(createEconomicQuoteSearch(client, key).current(), undefined);
    client.setQueryData(key, quote("5", "b", "50"));
    assert.equal(createEconomicQuoteSearch(client, key).current()?.quotedOutput, "10");
  } finally { client.clear(); }
});


test("a reused QueryObserver optimizes the selected partial floor once per visit without looping on fresh partial results", async () => {
  const client = new QueryClient(), wire = transport();
  const budget = (amount: string): EconomicRequest => ({ ...request, inputs: [{ currency: token, amount }] });
  const observed = (amount: string, funding: string, output: string) => ({
    ...quote(output, "b", funding), request: budget(amount),
  });
  const smallRequest = budget("300"), largeRequest = budget("500");
  const small = observed("300", "300", "5304"), rawFull = observed("500", "500", "5304");
  const floor = observed("400", "400", "7070"), partial = observed("500", "473", "8355");
  for (const value of [small, rawFull, floor]) client.setQueryData(economicQuoteKey(value.request, scope), value);
  let search = createEconomicQuoteSearch(client, economicQuoteKey(smallRequest, scope));
  let currentRequest = smallRequest;
  const options = () => ({ ...progressiveEconomicQuoteOptions(currentRequest, scope, search.current()),
    queryFn: ({ signal }: { signal: AbortSignal }) => search.run(currentRequest, signal, false, wire.fetcher) });
  const observer = new QueryObserver<EconomicQuote | null>(client, options());
  const unsubscribe = observer.subscribe(() => {});
  try {
    await tick(); assert.equal(wire.calls(), 0, "a fully funded cache hit stays immediate");
    currentRequest = largeRequest;
    search = createEconomicQuoteSearch(client, economicQuoteKey(currentRequest, scope));
    assert.equal(search.current()?.quotedOutput, "7070");
    observer.setOptions(options());
    await tick();
    assert.equal(wire.calls(), 1, "same observer/new key notices the selected partial floor despite raw full funding");
    assert.deepEqual(wire.bodies[0], economicRequest(largeRequest));
    assert.equal(search.current()?.quotedOutput, "7070", "show the whole floor while ordinary work is pending");
    wire.frame({ type: "qualified", value: partial }); wire.frame({ type: "complete", value: partial });
    await tick(); assert.equal(observer.getCurrentResult().fetchStatus, "idle");
    for (let render = 0; render < 5; render++) { observer.setOptions(options()); await tick(); }
    assert.equal(wire.calls(), 1, "fresh partial data and same-key rerenders do not start more work");
    assert.equal(search.current()?.quotedOutput, "8355");
    currentRequest = smallRequest;
    search = createEconomicQuoteSearch(client, economicQuoteKey(currentRequest, scope));
    observer.setOptions(options()); await tick(); assert.equal(wire.calls(), 1);
    currentRequest = largeRequest;
    search = createEconomicQuoteSearch(client, economicQuoteKey(currentRequest, scope));
    observer.setOptions(options()); await tick(); assert.equal(wire.calls(), 2, "another budget visit owns one new ordinary attempt");
    const full = observed("500", "500", "8830");
    wire.frame({ type: "qualified", value: full }); wire.frame({ type: "complete", value: full });
    await tick();
    for (let render = 0; render < 3; render++) { observer.setOptions(options()); await tick(); }
    assert.equal(wire.calls(), 2);
    unsubscribe();
    const remount = new QueryObserver<EconomicQuote | null>(client, options());
    const stopRemount = remount.subscribe(() => {});
    await tick(); assert.equal(wire.calls(), 2, "a full-funded remount starts no optimization");
    stopRemount();
  } finally { unsubscribe(); client.clear(); }
});

test("a capture stop survives preparation unfreeze on the same owner while explicit Refresh can restart it", async () => {
  const previous = quote("10", "b", "80"), f = fixture(previous);
  let refresh = false;
  const options = (enabled = true) => ({
    ...progressiveEconomicQuoteOptions(request, scope, f.search.current(), f.search.snapshot().stopped), enabled,
    queryFn: ({ signal }: { signal: AbortSignal }) => f.search.run(request, signal, refresh, f.wire.fetcher),
  });
  const observer = new QueryObserver<EconomicQuote | null>(f.client, options()), unsubscribe = observer.subscribe(() => {});
  try {
    await tick(); assert.equal(f.wire.calls(), 1);
    f.search.stop(true); observer.setOptions(options(false)); await tick();
    observer.setOptions(options()); await tick();
    assert.equal(f.wire.calls(), 1, "refused preparation cannot restart the search that this submission stopped");
    assert.deepEqual(f.search.current(), previous);
    refresh = true; const refreshing = observer.refetch({ cancelRefetch: false }); await tick();
    assert.equal(f.wire.calls(), 2); assert.equal(f.search.snapshot().stopped, false);
    assert.equal(f.wire.bodies[1].refresh, true);
    f.wire.frame({ type: "qualified", value: quote("12") }); f.wire.frame({ type: "complete", value: quote("12") });
    await refreshing; observer.setOptions(options()); await tick();
    assert.equal(f.wire.calls(), 2);
    const nextRequest = { ...request, inputs: [{ currency: token, amount: "101" }] };
    const next = createEconomicQuoteSearch(f.client, economicQuoteKey(nextRequest, scope));
    const nextObserver = new QueryObserver(f.client, { ...progressiveEconomicQuoteOptions(nextRequest, scope, next.current(), next.snapshot().stopped),
      queryFn: ({ signal }) => next.run(nextRequest, signal, false, f.wire.fetcher) });
    const stopNext = nextObserver.subscribe(() => {}); await tick();
    assert.equal(f.wire.calls(), 3, "a new budget owns an independent ordinary attempt"); stopNext();
  } finally { unsubscribe(); f.close(); }
});
