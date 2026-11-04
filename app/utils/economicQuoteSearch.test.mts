import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getAddress, toHex } from "viem";
import { QueryClient, QueryObserver, onlineManager, type UseQueryOptions } from "@tanstack/react-query";
import { createEconomicQuoteSearch } from "./economicQuoteSearch.ts";
import { economicQuoteKey, economicQuoteOptions, type EconomicQuote, type EconomicRequest } from "./economicQuotes.ts";
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
function fixture() {
  const client=new QueryClient(),key=economicQuoteKey(request,scope),wire=transport();
  const search=createEconomicQuoteSearch(client,key);
  const run=(refresh=false)=>client.fetchQuery({...economicQuoteOptions(request,scope),staleTime:0,
    queryFn:({signal})=>search.run(request,signal,refresh,wire.fetcher)});
  return {client,key,wire,search,run,close:()=>client.clear()};
}

async function retainCurrent(search: ReturnType<typeof createEconomicQuoteSearch>, value: EconomicQuote) {
  const wire = transport(), pending = search.run(value.request, new AbortController().signal, false, wire.fetcher);
  await tick(); wire.frame({ type: "complete", value }); await pending;
}

for (const output of ["8", "10", "11"]) test(`every qualified whole output ${output} is immediately ready before settlement`, async () => {
  const f = fixture(), pending = f.run();
  try {
    await tick(); const ready = quote(output, "a", "90");
    f.wire.frame({ type: "qualified", value: ready }); await tick();
    assert.deepEqual(f.search.current(), ready);
    assert.equal(f.client.getQueryData(f.key), undefined, "ready tuples stay in this owner, not the reusable QueryClient history");
    assert.equal(f.search.snapshot().optimizing, true);
    f.wire.frame({ type: "complete", value: ready }); await pending;
  } finally { f.close(); }
});

for (const outcome of ["complete", "error", "eof"] as const) test(`${outcome} settles without republishing an identical owned tuple`, async () => {
  const f = fixture(); let manualPublications = 0, snapshots = 0;
  const unsubscribeCache = f.client.getQueryCache().subscribe(event => {
    if (event.type === "updated" && event.action.type === "success" && event.action.manual) manualPublications++;
  });
  const unsubscribeSearch = f.search.subscribe(() => { snapshots++; });
  const pending = f.run(), settled = pending.then(value => ({ value }), error => ({ error }));
  try {
    await tick(); f.wire.frame({ type: "qualified", value: quote() }); await tick();
    const updated = quote(); updated.reuseSample!.inputLimitObserved = true;
    f.wire.frame({ type: "qualified", value: updated, requestId: "44444444-4444-4444-8444-444444444444" }); await tick();
    assert.deepEqual(f.search.current(), updated, "a genuine same-amount input-limit update still publishes");
    assert.equal(diagnosticReferences(f.search.current()).requestId, "44444444-4444-4444-8444-444444444444");
    assert.equal(manualPublications, 0); assert.equal(snapshots, 3);
    if (outcome === "complete") f.wire.frame({ type: "complete", value: updated, requestId: "44444444-4444-4444-8444-444444444444" });
    else if (outcome === "error") f.wire.frame({ type: "error", code: "rpc-timeout" });
    else f.wire.end();
    const result = await settled;
    assert.equal("error" in result, outcome !== "complete");
    assert.deepEqual(f.search.current(), updated);
    assert.equal(f.search.snapshot().optimizing, false);
    assert.equal(Boolean(f.search.snapshot().error), outcome !== "complete");
    assert.equal(manualPublications, 0, "ready and terminal cleanup never manually cache a whole quote");
    assert.equal(snapshots, outcome === "complete" ? 4 : 5, "settlement and errors remain observable");
  } finally { unsubscribeSearch(); unsubscribeCache(); f.close(); }
});

for (const release of ["stored", "marker-first", "complete", "complete-only", "ordinary-error", "eof"] as const)
  test(`${release} preserves available qualified work without an estimate threshold`, async () => {
    const f = fixture(), pending = f.run();
    const checked = release === "ordinary-error" || release === "eof" ? assert.rejects(pending, QuotePreviewError) : undefined;
    try {
      await tick(); const best = quote("8");
      if (release === "stored") best.observation = { source: "stored", refresh: false };
      if (release === "marker-first") f.wire.frame({ type: "upper-replay-settled" });
      if (release !== "complete-only") f.wire.frame({ type: "qualified", value: best });
      await tick(); assert.equal(f.search.current()?.quotedOutput, release === "complete-only" ? undefined : "8");
      if (release === "ordinary-error") f.wire.frame({ type: "error", code: "rpc-timeout" });
      else if (release === "eof") f.wire.end(); else f.wire.frame({ type: "complete", value: best });
      if (checked) await checked; else assert.equal((await pending).quotedOutput, "8");
      assert.equal(f.search.current()?.quotedOutput, "8");
    } finally { f.close(); }
  });

test("caller stop keeps its ready tuple and a queued legacy replay marker cannot publish later work", async () => {
  const f = fixture(), pending = f.run();
  try {
    await tick(); f.wire.frame({ type: "qualified", value: quote("8") }); await tick();
    f.wire.frame({ type: "upper-replay-settled" }); f.wire.frame({ type: "qualified", value: quote("99") });
    f.search.stop(); await pending.catch(() => {}); await tick();
    assert.equal(f.search.current()?.quotedOutput, "8");
    assert.equal(createEconomicQuoteSearch(f.client, f.key).current(), undefined, "a new owner cannot reuse the stopped owner's tuple");
  } finally { f.close(); }
});

test("disproof of a ready candidate cannot be undone by a legacy replay marker or refinement error", async () => {
  const f = fixture(), pending = f.run(), checked = assert.rejects(pending, QuotePreviewError);
  try {
    await tick(); const best = quote("8"); f.wire.frame({ type: "qualified", value: best }); await tick();
    f.wire.frame({ type: "invalidated", context: best.context }); f.wire.frame({ type: "upper-replay-settled" });
    f.wire.frame({ type: "error", code: "quote-unavailable" }); await checked;
    assert.equal(f.search.current(), undefined); assert.equal(f.client.getQueryData(f.key), undefined);
  } finally { f.close(); }
});

for (const distinct of [false, true]) test(`latest-simulation disproof clears selected observation (${distinct ? "different" : "same"} prior context)`, async () => {
  const previous = quote("8"); previous.context = { ...previous.context, blockNumber: null, blockHash: null };
  const fresh = quote("9"); fresh.context = { ...previous.context,
    observedAt: distinct ? "2026-10-31T00:00:01Z" : previous.context.observedAt };
  const f = fixture(); await retainCurrent(f.search, previous);
  const pending = f.run(true), checked = assert.rejects(pending, QuotePreviewError);
  try {
    await tick(); f.wire.frame({ type: "qualified", value: fresh }); await tick();
    assert.deepEqual(f.search.current(), fresh);
    f.wire.frame({ type: "invalidated", context: fresh.context }); f.wire.frame({ type: "error", code: "quote-unavailable" });
    await checked; assert.equal(f.search.current(), undefined, "the Backend owns recovery selection; prior tuples are not restored locally");
  } finally { f.close(); }
});

test("qualified whole snapshots are ready while QueryClient tracks only the fetching promise",async()=>{
  const f=fixture(),pending=f.run();
  try{
    await tick();const first=quote();f.wire.frame({type:"qualified",value:first,requestId:"33333333-3333-4333-8333-333333333333"});await tick();
    assert.equal(diagnosticReferences(f.search.current()).requestId,"33333333-3333-4333-8333-333333333333");
    assert.deepEqual(f.search.current(),first);assert.equal(f.client.getQueryData(f.key),undefined);
    assert.equal(f.client.getQueryState(f.key)?.fetchStatus,"fetching");assert.equal(f.search.snapshot().optimizing,true);
    const better=quote("12","a","90");f.wire.frame({type:"qualified",value:better});await tick();
    assert.deepEqual(f.search.current(),better);assert.equal(f.search.current()?.fees.coreProtocolFeeCygld,"12");
    assert.equal(f.search.current()?.inputs[0].amount,"90");
    const final = { ...better, routeOrigins: { economicEvaluator: "cybergold-quoter", pricing: "helpers-execution-with-policy-fees",
      discoveryProviders: ["uniroute-local"], conversions: {} } } as EconomicQuote;
    f.wire.frame({type:"complete",value:final});
    assert.deepEqual(await pending,final,"the terminal producer selection includes final metadata");
    assert.deepEqual(f.search.current(),final);
    assert.equal(f.search.snapshot().optimizing,false);assert.equal(f.client.getQueryState(f.key)?.fetchStatus,"idle");
  }finally{f.close();}
});

test("stop preserves the current capture, while a new owner starts empty", async () => {
  const f = fixture(), pending = f.run();
  try {
    await tick(); const first = quote(); f.wire.frame({ type: "qualified", value: first }); await tick();
    const captured = structuredClone(f.search.current());
    f.wire.frame({ type: "qualified", value: quote("99") }); f.search.stop();
    await pending.catch(() => {}); await tick();
    assert.equal(f.wire.aborted(), true); assert.equal(f.wire.cancelled(), true);
    assert.deepEqual(f.search.current(), captured);
    assert.equal(createEconomicQuoteSearch(f.client, f.key).current(), undefined);
  } finally { f.close(); }
});

for (const ready of [false, true]) test(`explicit Refresh restarts a held ${ready ? "ready tail" : "initial search"} without publishing queued obsolete work`, async () => {
  const client = new QueryClient(), key = economicQuoteKey(request, scope), wires = [transport(), transport()];
  const search = createEconomicQuoteSearch(client, key);
  let refresh = false, calls = 0;
  const observer = new QueryObserver<EconomicQuote | null>(client, { ...economicQuoteOptions(request, scope),
    queryFn: ({ signal }) => search.run(request, signal, refresh, wires[calls++].fetcher) });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await tick(); const incumbent = quote("10", "a", "90");
    if (ready) { wires[0].frame({ type: "qualified", value: incumbent }); await tick(); }
    assert.equal(observer.getCurrentResult().fetchStatus, "fetching");
    wires[0].frame({ type: "qualified", value: quote("99") });
    refresh = true; search.stop();
    const pending = observer.refetch({ cancelRefetch: true }); await tick();
    assert.equal(calls, 2); assert.equal(wires[0].aborted(), true); assert.equal(wires[0].cancelled(), true);
    assert.equal(wires[1].bodies[0].refresh, true);
    assert.deepEqual(search.current(), ready ? incumbent : undefined);
    assert.equal(client.getQueryData(key), undefined);
    assert.equal(observer.getCurrentResult().fetchStatus, "fetching");
    const fresh = quote("12", "b", "95"); wires[1].frame({ type: "qualified", value: fresh }); await tick();
    assert.deepEqual(search.current(), fresh);
    wires[1].frame({ type: "complete", value: fresh }); await pending;
    assert.deepEqual(client.getQueryData(key), fresh); assert.equal(calls, 2);
  } finally { unsubscribe(); client.clear(); }
});

test("an earlier canceled Refresh cannot clear a newer paused Refresh's intent in the real hook", async () => {
  const client = new QueryClient(), key = economicQuoteKey(request, scope), wires = [transport(), transport(), transport(), transport()];
  client.setQueryData(key, quote()); client.mount();
  let calls = 0, observer!: QueryObserver<EconomicQuote | null>, unsubscribe = () => {};
  const dependencies: Record<string, unknown> = {
    react: { useCallback: (fn: unknown) => fn, useEffect: () => {}, useLayoutEffect: () => {},
      useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }),
      useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() },
    "@tanstack/react-query": { useQueryClient: () => client, useQuery: (options: UseQueryOptions<EconomicQuote | null>) => {
      observer = new QueryObserver(client, options); unsubscribe = observer.subscribe(() => {});
      return observer.getCurrentResult();
    } },
    "@/app/config/chain": { targetChainId: scope.chainId },
    "@/app/context/protocolConfigurationContext": { useProtocolConfiguration: () => ({ identity: scope.configuration }) },
    "@/app/context/sandboxForkContext": { useSandboxForkGeneration: () => scope.generation },
    "@/app/utils/economicQuotes": { economicQuoteKey, economicQuoteOptions },
    "@/app/utils/economicQuoteSearch": { createEconomicQuoteSearch: (...args: Parameters<typeof createEconomicQuoteSearch>) => {
      const search = createEconomicQuoteSearch(...args);
      return { ...search, run: (input: EconomicRequest, signal: AbortSignal, refresh: boolean) =>
        search.run(input, signal, refresh, wires[calls++].fetcher) };
    } },
    "@/app/utils/diagnosticReferences": { diagnosticReferences, retainDiagnosticReferences },
    "@/app/hooks/usePageVisible": { usePageVisible: () => true },
  };
  const source = ts.transpileModule(readFileSync(new URL('../hooks/flows/quotes/useEconomicQuote.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exported: { useEconomicQuote?: (input: EconomicRequest, enabled: boolean) => { refresh: () => Promise<unknown> } } = {};
  runInNewContext(source, { exports: exported, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, JSON, structuredClone });
  const wasOnline = onlineManager.isOnline();
  try {
    onlineManager.setOnline(true);
    const hook = exported.useEconomicQuote!(request, true); await tick();
    wires[0].frame({ type: "complete", value: quote("10") }); await tick();
    const earlier = hook.refresh(); await tick();
    assert.equal(wires[1].bodies[0].refresh, true);
    onlineManager.setOnline(false); const latest = hook.refresh(); await earlier; await tick();
    assert.equal(wires[1].aborted(), true); assert.equal(observer.getCurrentResult().fetchStatus, "paused");
    assert.equal(calls, 2, "offline retryer has not read the newer refresh intent yet");
    onlineManager.setOnline(true); await tick();
    assert.equal(calls, 3); assert.equal(wires[2].bodies[0].refresh, true);
    wires[2].frame({ type: "complete", value: quote("12") }); await latest;
    const ordinary = observer.refetch(); await tick();
    assert.equal(wires[3].bodies[0].refresh, undefined, "the latest completed owner clears its own intent");
    wires[3].frame({ type: "complete", value: quote("13") }); await ordinary;
  } finally { unsubscribe(); client.clear(); client.unmount(); onlineManager.setOnline(wasOnline); }
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
      assert.equal(f.client.getQueryData(f.key),undefined);
    }finally{f.close();}
  });
}

test("canonical disproof clears the displayed tuple and cannot be resurrected by cancel rollback",async()=>{
  const f=fixture(),pending=f.run();const checked=assert.rejects(pending,QuotePreviewError);
  try{
    await tick();const invalid=quote();f.wire.frame({type:"qualified",value:invalid});await tick();
    f.wire.frame({type:"invalidated",context:invalid.context});await tick();
    assert.equal(f.search.current(),undefined);assert.equal(f.client.getQueryData(f.key),undefined);
    f.wire.frame({type:"error",code:"quote-unavailable",error:"Snapshot changed."});await checked;
    f.search.stop();await tick();assert.equal(f.search.current(),undefined);assert.equal(f.client.getQueryData(f.key),undefined);
  }finally{f.close();}
});

for(const distinct of [false,true])test(`Refresh disproof clears the selected context with ${distinct?"a distinct":"the same"} prior observation`,async()=>{
  const previous=quote("8",distinct?"b":"a"),f=fixture(); await retainCurrent(f.search,previous);
  const pending=f.run(true),checked=assert.rejects(pending,QuotePreviewError);
  try{
    await tick();const invalid=quote();f.wire.frame({type:"qualified",value:invalid});await tick();
    f.wire.frame({type:"invalidated",context:invalid.context});f.wire.frame({type:"error",code:"quote-unavailable"});await checked;
    assert.equal(f.search.current(),undefined);f.search.stop();await tick();
    assert.equal(f.client.getQueryData(f.key),undefined);
  }finally{f.close();}
});

test("a Refresh failure before any replacement retains the accepted current-owner quote",async()=>{
  const previous=quote("8","b"),f=fixture(); await retainCurrent(f.search,previous);
  const pending=f.run(true),checked=assert.rejects(pending,QuotePreviewError);
  try{await tick();f.wire.frame({type:"error",code:"rpc-timeout"});await checked;
    assert.deepEqual(f.search.current(),previous);assert.equal(f.client.getQueryData(f.key),undefined);
  }finally{f.close();}
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

test("a capture stop survives preparation unfreeze on the same owner while explicit Refresh can restart it", async () => {
  const previous = quote("10", "b", "80"), f = fixture(); await retainCurrent(f.search, previous);
  let refresh = false;
  const options = (enabled = true) => ({
    ...economicQuoteOptions(request, scope), enabled: enabled && !f.search.snapshot().stopped,
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
    observer.setOptions(options()); // The hook observes the new active owner while its promise is still fetching.
    assert.equal(f.wire.bodies[1].refresh, true);
    f.wire.frame({ type: "qualified", value: quote("12") }); f.wire.frame({ type: "complete", value: quote("12") });
    await refreshing; observer.setOptions(options()); await tick();
    assert.equal(f.wire.calls(), 2);
    const nextRequest = { ...request, inputs: [{ currency: token, amount: "101" }] };
    const next = createEconomicQuoteSearch(f.client, economicQuoteKey(nextRequest, scope));
    const nextObserver = new QueryObserver(f.client, { ...economicQuoteOptions(nextRequest, scope),
      queryFn: ({ signal }) => next.run(nextRequest, signal, false, f.wire.fetcher) });
    const stopNext = nextObserver.subscribe(() => {}); await tick();
    assert.equal(f.wire.calls(), 3, "a new budget owns an independent ordinary attempt"); stopNext();
  } finally { unsubscribe(); f.close(); }
});

for (const old of [quote("999"), null]) test(`new request owners ignore ${old ? "exact and neighbor whole quotes" : "old disproof sentinels"}`, async () => {
  const f = fixture();
  try {
    f.client.setQueryData(f.key, old);
    const lower = { ...quote("9999", "b", "50"), request: { ...request, inputs: [{ currency: token, amount: "50" }] } };
    f.client.setQueryData(economicQuoteKey(lower.request, scope), lower);
    const search = createEconomicQuoteSearch(f.client, f.key);
    assert.equal(search.current(), undefined); assert.equal(search.snapshot().invalidated, false);
    const pending = search.run(request, new AbortController().signal, false, f.wire.fetcher);
    await tick(); assert.equal(f.wire.bodies[0].refresh, undefined);
    const selected = { ...quote("8", "a", "90"), observation: { source: "stored" as const, refresh: false } };
    f.wire.frame({ type: "qualified", value: selected }); await tick();
    assert.deepEqual(search.current(), selected, "the Backend-selected stored tuple arrives through the stream");
    assert.equal(search.snapshot().historical, true);
    const lowerReprice = { ...quote("7", "b", "85"), observation: { source: "search" as const, refresh: false } };
    f.wire.frame({ type: "qualified", value: lowerReprice }); await tick();
    assert.deepEqual(search.current(), lowerReprice, "the client follows producer selection without numeric ranking");
    assert.equal(search.snapshot().historical, false);
    f.wire.frame({ type: "complete", value: lowerReprice }); await pending;
  } finally { f.close(); }
});

for (const context of ["a", "b"]) test(`canonical disproof permits a later Backend-selected replacement at context ${context}`, async () => {
  const f = fixture(), pending = f.run();
  try {
    await tick(); const previous = quote("10"); f.wire.frame({ type: "qualified", value: previous }); await tick();
    f.wire.frame({ type: "invalidated", context: previous.context }); await tick();
    assert.equal(f.search.current(), undefined); assert.equal(f.search.snapshot().invalidated, true);
    const selected = quote("9", context, "90"); selected.plan.body = { replacement: true };
    f.wire.frame({ type: "qualified", value: selected }); await tick();
    assert.deepEqual(f.search.current(), selected); assert.equal(f.search.snapshot().invalidated, false);
    const captured = structuredClone(f.search.current());
    f.wire.frame({ type: "complete", value: selected }); assert.deepEqual(await pending, selected);
    assert.deepEqual(captured, selected); assert.deepEqual(f.search.current(), selected);
  } finally { f.close(); }
});

test("settlement belongs to the current owner; interruption can resume and new owners start fresh", async () => {
  const f = fixture(), pending = f.run();
  try {
    await tick(); assert.equal(f.search.snapshot().settled, false);
    f.wire.frame({ type: "qualified", value: quote() }); await tick();
    f.search.stop(); await pending.catch(() => {});
    assert.equal(f.search.snapshot().settled, false, "an interrupted tail still has unfinished work");
    const resumed = f.run(); await tick();
    f.wire.frame({ type: "complete", value: quote("12") }); await resumed;
    assert.equal(f.search.snapshot().settled, true);
    f.search.stop(); assert.equal(f.search.snapshot().settled, true, "hiding a settled owner does not create new work");
    const next = createEconomicQuoteSearch(f.client, f.key);
    assert.equal(next.snapshot().settled, false); assert.equal(next.current(), undefined);
  } finally { f.close(); }
});
