import assert from 'node:assert/strict';
import test from 'node:test';
import { activeMatrixTemplates, activeScenarios, buildMatrix, valuationSnapshot, matrixCounts, matrixCountsFor, matrixTemplates, semanticDigest, repetitionManifest, assertMatrixIntent, type ValuationSnapshot } from '../../tests/trading/matrix.ts';
import { captureSelection, executeAlternate, planDigest, executionCoverage, notAttemptedAlternate, transactionDisposition, observedProviderEvidence, providerSummaries, type Candidate, type ProviderQuote } from '../../tests/trading/providerEvidence.ts';
import { protocolConfigurationFixture as config, tokenAddresses } from '../../tests/fixtures/protocol-configuration.ts';
import { tokenRequest, resultFor } from '../../tests/trading/regression.ts';
import type { ProtocolFacts } from './protocolFacts.ts';
import type { PoolSnapshot } from './poolSnapshot.ts';
import type { Page } from '@playwright/test';
import type { Address } from 'viem';
const p = (wholeUsd: bigint, decimals: number) => ({ numerator: String(wholeUsd), denominator: String(10n ** BigInt(decimals)) });
const valuation: ValuationSnapshot = { id: 'a'.repeat(64), source: 'usdc-anchored-pool-observations', observedAt: '2026-10-17T00:00:00Z', assumption: 'one-usdc-is-one-usd', rounding: 'floor-raw-units',
 prices: { [tokenAddresses.USDC.toLowerCase()]: p(1n, 6), [tokenAddresses.PAXG.toLowerCase()]: p(4000n, 18), [tokenAddresses.XAUT.toLowerCase()]: p(4000n, 6), [tokenAddresses.WETH.toLowerCase()]: p(2000n, 18), [tokenAddresses.CYGLD.toLowerCase()]: p(100n, 18) },
 basketAssets: [tokenAddresses.PAXG, tokenAddresses.XAUT], basketWeights: ['500000', '500000'], observations: [] };
const matrix = buildMatrix(config, valuation, matrixTemplates());
const candidate = (strategy: 'core' | 'market'): Candidate => ({ strategy, side: 'sell', mode: 'exact-out', tokenIn: tokenAddresses.CYGLD, tokenOut: tokenAddresses.USDC,
 quotedInput: '100', quotedOutput: '1000000', inputMaximum: '100', outputMinimum: '1000000', context: { chainId: 31337, blockNumber: '100', blockHash: `0x${'b'.repeat(64)}` },
 providerRequest: { mode: 'redeem-exact-out', token: tokenAddresses.USDC, quoteToken: tokenAddresses.USDC, native: false, amount: '1000000', deadline: '2000000000', adapter: config.contracts.uniswapAdapter, orderedAssets: [], targets: [], slippageBps: 100 },
 providerQuote: { workId: '01a13184-39fb-7b81-8a3c-39e29218b069' }, evaluation: { core: 'complete', market: 'complete' }, metrics: { totalMs: 1, targetReads: 0 } } as unknown as Candidate);
const quote = (): ProviderQuote => ({ ...candidate('core'), providerAssessments: { core: { availability: 'qualified', searchOutcome: 'complete' }, market: { availability: 'qualified', searchOutcome: 'timeout' } }, providerCandidates: { core: candidate('core'), market: candidate('market') } } as unknown as ProviderQuote);

test('operating defaults select24 spend journeys while retaining all48 capability definitions', () => {
 const active = buildMatrix(config, valuation);
 assert.equal(active.length, 24); assert.equal(new Set(active.map(r => r.id)).size, 24);
 assert.ok(active.every(row => row.inputMode === 'exact-in'));
 assert.deepEqual(active.map(row => row.id), activeMatrixTemplates().map(row => row.id));
 assert.deepEqual(active, activeScenarios(matrix));
 assert.deepEqual(matrixCounts, { scenarioCount: 24, providerAssessmentCount: 48, maximumTradeExecutions: 48 });
 assert.deepEqual(matrixCountsFor(active), matrixCounts);
 for (const asset of ['PAXG','USDC','ETH','BASKET']) for (const side of ['buy','sell']) assert.equal(active.filter(r => r.asset === asset && r.side === side).length, 3);
 assert.equal(matrix.length, 48); assert.equal(new Set(matrix.map(r => r.id)).size, 48);
 assert.deepEqual(matrixCountsFor(matrix), { scenarioCount: 48, providerAssessmentCount: 96, maximumTradeExecutions: 96 });
 for (const asset of ['PAXG','USDC','ETH','BASKET']) for (const side of ['buy','sell']) for (const inputMode of ['exact-in','exact-out']) assert.equal(matrix.filter(r => r.asset === asset && r.side === side && r.inputMode === inputMode).length, 3);
 assert.equal(matrixTemplates().length,48);
});
test('dollar tiers size the user edited asset in exact integers excluding gas', () => {
 const find = (asset: string, side: string, mode: string) => matrix.find(r => r.asset === asset && r.side === side && r.inputMode === mode && r.size === 'small')!;
 assert.equal(find('USDC','sell','exact-out').amountRaw, '1000000');
 assert.equal(find('ETH','sell','exact-out').amountRaw, '500000000000000');
 assert.equal(find('PAXG','buy','exact-in').displayAmount, '0.00025');
 assert.equal(find('USDC','buy','exact-out').displayAmount, '0.01');
 assert.equal(find('ETH','sell','exact-in').displayAmount, '0.01');
 assert.equal(tokenRequest(find('ETH','sell','exact-out'),config,config.contracts.helpers!).amount, '500000000000000');
});
test('basket vectors share one captured composition with mixed decimals and correct integer rounding', () => {
 const input = matrix.find(r => r.asset === 'BASKET' && r.side === 'buy' && r.inputMode === 'exact-in' && r.size === 'small')!;
 assert.deepEqual(input.basketAmounts, ['125000000000000','125']);
 const output = matrix.find(r => r.asset === 'BASKET' && r.side === 'sell' && r.inputMode === 'exact-out' && r.size === 'small')!;
 assert.deepEqual(output.basketAmounts,input.basketAmounts);
 assertMatrixIntent(input,{basketRequest:{mode:'issue-exact-in',maximumAmountsIn:input.basketAmounts!}},config);
 assert.throws(() => assertMatrixIntent(input,{basketRequest:{mode:'issue-exact-in',maximumAmountsIn:['1','2']}},config),/matrix-intent/);
 const unusual = structuredClone(valuation); unusual.prices[tokenAddresses.USDC.toLowerCase()] = {numerator:'3',denominator:'1000000'};
 assert.equal(buildMatrix(config,unusual,matrixTemplates()).find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='small')!.amountRaw,'333333');
});
test('absent valuation remains an ordinary sizing error instead of inventing a price or shrinking a case',()=>{
 const absent = structuredClone(valuation); delete absent.prices[tokenAddresses.WETH.toLowerCase()];
 const rows=buildMatrix(config,absent);
 assert.ok(rows.filter(r=>r.asset==='ETH'&&((r.side==='buy')===(r.inputMode==='exact-in'))).every(r=>r.sizingError==='valuation-unavailable'));
 assert.ok(rows.filter(r=>r.asset==='USDC').every(r=>!r.sizingError));
 assert.equal(rows.length,24);
 const source = semanticDigest(valuation); buildMatrix(config,valuation); assert.equal(semanticDigest(valuation),source);
});
test('cutoff copies complete plans and keeps provider availability independent from timeout',()=>{
 const original=quote(), captured=captureSelection({attemptId:'attempt',quote:original});
 original.providerCandidates!.market!.quotedInput='999';
 assert.equal(captured.alternate!.quotedInput,'100');
 assert.equal(captured.primary.providers.market.availability,'qualified'); assert.equal(captured.primary.providers.market.searchOutcome,'timeout');
 assert.equal(captured.primary.selectedProvider,'core');
 const serialized=JSON.stringify(captured.primary); assert.doesNotMatch(serialized,/providerQuote|providerRequest|adapter|calldata/);
});
test('invalidated provider evidence loses stale candidate; terminal failure outcomes stay visible',()=>{
 const evidence=observedProviderEvidence({frames:[{type:'provider-qualified',strategy:'market',value:candidate('market')},{type:'provider-assessment',strategy:'market',value:{availability:'unavailable',searchOutcome:'error'}}]});
 assert.equal(evidence.providerCandidates?.market,undefined);
 const summaries=providerSummaries(evidence);assert.equal(summaries.market.searchOutcome,'error');assert.equal(summaries.market.planDigest,undefined);
});
for (const winner of ['core', 'market'] as const) test(`${winner} winner preserves the other provider's failed qualification evidence`, () => {
 const loser = winner === 'core' ? 'market' : 'core';
 const diagnostics = { phase: 'initial-search', qualified: false,
  providerQualifications: { provider: loser, attempts: 1, rejected: 1, pending: 0,
   rows: [{ attempt: 1, stage: 'qualification', outcome: 'rejected', code: 'quote-no-route', maximumAmountIn: '100', observedAmountIn: '101' }] },
  routeWave: { legs: { count: 1, rows: [{ index: 0, started: 2, succeeded: 1, failed: 1, bestAvailable: true,
   failureCounts: [{ code: 'rpc-timeout', count: 1 }], bestPools: [{ protocol: 'v3', poolId: '0x' + 'a'.repeat(40) }] }] } } };
 const selected = { ...candidate(winner), providerCandidates: { [winner]: candidate(winner) },
  providerAssessments: { [winner]: { availability: 'qualified', searchOutcome: 'complete' },
   [loser]: { availability: 'unavailable', searchOutcome: 'error', code: 'quote-no-route',
    quoteDiagnostics: { ...diagnostics, signature: 'private-signature', providerQualifications: {
     ...diagnostics.providerQualifications, providerMessage: 'private-provider-message' } } } } } as unknown as ProviderQuote;
 const digest = planDigest(selected.providerCandidates![winner]!);
 const captured = captureSelection({ attemptId: 'attempt', quote: selected });
 assert.equal(captured.primary.selectedProvider, winner);
 assert.equal(captured.primary.planDigest, digest);
 assert.equal(captured.primary.providers[winner].availability, 'qualified');
 assert.deepEqual(captured.primary.providers[loser].quoteDiagnostics, diagnostics);
 assert.equal(captured.alternate, undefined);
 const scenario = { ...resultFor(matrix[0], 'execution'), status: 'pass' as const, providers: captured.primary.providers };
 assert.equal(executionCoverage([scenario]).ui.pass, 1);
 assert.doesNotMatch(JSON.stringify(captured.primary), /private-signature|private-provider-message/);
 (selected.providerAssessments![loser] as unknown as { quoteDiagnostics: typeof diagnostics }).quoteDiagnostics.providerQualifications.rows[0].maximumAmountIn = '999';
 assert.equal(captured.primary.providers[loser].quoteDiagnostics?.providerQualifications?.rows[0].maximumAmountIn, '100');
 assert.equal(planDigest(selected.providerCandidates![winner]!), digest);
});
test('unsupported alternate records a coverage omission and submits nothing',async()=>{
 const q=quote();q.providerAssessments!.market={availability:'unsupported',searchOutcome:'not-run'};delete q.providerCandidates!.market;
 const s=matrix.find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='small')!;
 const result=await executeAlternate({attemptId:'attempt',quote:q},s,tokenRequest(s,config,config.contracts.helpers!),{} as Page,config.contracts.helpers as Address,config,async()=>{throw new Error('must-not-fetch');});
 assert.equal(result.attempted,false);assert.equal(result.reason,'unsupported');assert.equal(result.transactionDisposition,'not-submitted');
});
test('alternate replay uses exact captured retained plan and records revalidation separately',async()=>{
 const q=quote(), s=matrix.find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='small')!;
 const trace={providerQualifications:{provider:'market',attempts:1,selectedAttempt:1,selectionReason:'complete',selectionMs:1.5,rows:[{attempt:1,stage:'selection',outcome:'qualified',quotedInput:'100',quotedOutput:'1000000'}]}};
 let request:Record<string,unknown>|undefined;let executed=0;
 const result=await executeAlternate({attemptId:'attempt',quote:q},s,tokenRequest(s,config,config.contracts.helpers!),{} as Page,config.contracts.helpers as Address,config,
  (async(_url,init)=>{request=JSON.parse(String(init?.body));return new Response(JSON.stringify({type:'complete',value:{...candidate('market'),providerQuote:{mode:'exact-out',totalInput:'100',netOutput:'1000000',quoteDiagnostics:trace},context:{...candidate('market').context,blockNumber:'101'}}})+'\n');}) as typeof fetch,
  async observation=>{executed++;observation.result.status='pass';observation.result.executionStage='complete';return observation.result;});
 assert.equal(executed,1);assert.deepEqual((request!.retainedPlan as {quote:unknown}).quote,q.providerCandidates!.market!.providerQuote);
 assert.equal(result.planDigest,planDigest(q.providerCandidates!.market!));assert.ok(result.revalidatedPlanDigest);assert.equal(result.attempted,true);assert.equal(result.status,'pass');assert.equal(result.reason,undefined);
 assert.deepEqual(result.quoteDiagnostics,trace);assert.equal(result.selectedPlan?.totalInput,'100');assert.equal(result.selectedPlan?.netOutput,'1000000');
});
test('failed replay preserves winner result and failure counts with no hidden retry',async()=>{
 const q=quote(),s=matrix[0];let calls=0;
 const alt=await executeAlternate({attemptId:'a',quote:q},s,tokenRequest(s,config,config.contracts.helpers!),{} as Page,config.contracts.helpers as Address,config,(async()=>{calls++;return new Response(JSON.stringify({type:'error',code:'quote-timeout'})+'\n');}) as typeof fetch);
 assert.equal(calls,1);assert.equal(alt.status,'fail');
 const primary={...resultFor(s,'execution'),status:'pass' as const,executionAttempted:true,alternateExecution:alt,providers:providerSummaries(q)};
 const coverage=executionCoverage([primary]);assert.equal(primary.status,'pass');assert.equal(coverage.alternate.fail,1);assert.equal(coverage.ui.pass,1);assert.equal(coverage.alternateAttempted,1);
});
test('declared repetition manifest copies conditions without retries or rewriting historical outcomes',()=>{
 const input={repetitions:3,concurrency:2,condition:'cold' as const,preserved:['chain-state'],reset:['worker-process']};
 const manifest=repetitionManifest(input);input.reset.push('other');assert.deepEqual(manifest.reset,['worker-process']);
 assert.throws(()=>repetitionManifest({...input,repetitions:0}),/invalid-repetition/);
 const alt=notAttemptedAlternate(matrix[0]);assert.equal(alt.attempted,false);assert.equal(alt.reason,'quote-observation-unavailable');
});

test('the actual marginal observation source derives integer token and Core basket valuations once',()=>{
 const facts={context:{observedAt:'2026-10-17T00:00:00Z'},basket:{assets:{status:'success',value:[tokenAddresses.PAXG,tokenAddresses.XAUT]},targetsPpm:{status:'success',value:['500000','500000']},cygldPerUnitFp18:{status:'success',value:['40000000000000000000','40000000000000000000000000000000']}}} as unknown as ProtocolFacts;
 const pool=(token0:string,token1:string,n:string)=>({exists:true,token0,token1,marginalPrice:{numerator:n,denominator:'1'}} as PoolSnapshot);
 const observations=[pool(tokenAddresses.USDC,tokenAddresses.WETH,'500000000'),pool(tokenAddresses.PAXG,tokenAddresses.WETH,'2'),pool(tokenAddresses.XAUT,tokenAddresses.WETH,'2000000000000')];
 const source=valuationSnapshot(config,facts,observations); const price=source.prices[tokenAddresses.CYGLD.toLowerCase()];
 assert.equal(BigInt(price.numerator)*10n**18n/BigInt(price.denominator),100n);
 assert.equal(buildMatrix(config,source,matrixTemplates()).find(r=>r.asset==='USDC'&&r.side==='buy'&&r.inputMode==='exact-out'&&r.size==='small')!.amountRaw,'10000000000000000');
 assert.equal(source.assumption,'one-usdc-is-one-usd');assert.equal(source.observations.length,3);assert.equal(source.id.length,64);
});

test('wallet submission uncertainty survives missing transaction hash for both entry paths',()=>{
 const base={status:'fail' as const,executionAttempted:true};
 assert.equal(transactionDisposition({...base,executionStage:'execution-submission'}),'unknown');
 assert.equal(transactionDisposition({...base,executionStage:'ui-confirmation'}),'unknown');
 assert.equal(transactionDisposition({...base,executionStage:'execution-quote'}),'not-submitted');
 assert.equal(transactionDisposition({...base,executionStage:'execution-submission',walletRequestErrorCode:4001}),'not-submitted');
 assert.equal(transactionDisposition({...base,executionStage:'execution-receipt-assertions',transactionHash:'0xabc'}),'confirmed');
});

test('sizing does not silently raise a sub-unit target or lose integers beyond Number precision',()=>{
 const source=structuredClone(valuation);
 source.prices[tokenAddresses.USDC.toLowerCase()]={numerator:'2000000',denominator:'1000000'};
 assert.equal(buildMatrix(config,source,matrixTemplates()).find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='small')!.amountRaw,'0');
 source.prices[tokenAddresses.USDC.toLowerCase()]={numerator:'1',denominator:String(10n**40n)};
 assert.equal(buildMatrix(config,source,matrixTemplates()).find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='large')!.amountRaw,String(10n**44n));
});

test('the actual submit helper settles its opened wallet flow before propagating capture failures',async()=>{
 const { readFileSync }=await import('node:fs');const ts=await import('typescript');
 const source=readFileSync(new URL('../../tests/metamask/fixed-api-roundtrips.spec.ts',import.meta.url),'utf8');
 const snippet=source.slice(source.indexOf('  async function submit('),source.indexOf('  async function walletPostcheck('));
 const javascript=ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText;
 for(const failure of ['observation','intent'] as const){
  const actions:string[]=[],original=new Error(failure);
  const build=new Function('getSwapButton','armUiQuoteCapture','gasObservation','checkpoint','selectionCaptures','requireInvariant','assertMatrixIntent','captureSelection','capturedUiQuote','approveUntilMined','activeResult','results','scenarios','config',
    `const page={};let observationPhase,clickedSelection;const activeScenarioIndex=0,helpersHash=undefined;${javascript};return submit;`);
  const submit=build(async()=>({click:async()=>actions.push('click')}),async()=>{}, {begin(){}},async()=>{},
    async()=>{if(failure==='observation')throw original;return[{attemptId:'a',quote:quote()}];},assert.ok,()=>{throw original;},()=>({primary:{}}),async()=>{actions.push('dom');return{};},async()=>actions.push('wallet-settled'),()=>({}),[{}],[matrix[0]],config);
  await assert.rejects(submit({},'exact-in'),error=>error===original);
  assert.deepEqual(actions,['click','wallet-settled']);
 }
});

test('plan binding ignores timing/ref wrappers but changes for executable terms and chain context',()=>{
 const a=candidate('core'),b=structuredClone(a);b.metrics.totalMs=9999;
 Object.assign(b.providerQuote,{requestId:'different',workId:'different'});
 assert.equal(planDigest(a),planDigest(b));
 for(const mutate of [(x:Candidate)=>{x.outputMinimum='1000001';},(x:Candidate)=>{x.context.blockNumber='101';},(x:Candidate)=>{Object.assign(x.providerRequest,{recipient:'0x00000000000000000000000000000000000000ff'});},(x:Candidate)=>{Object.assign(x.providerQuote,{quotes:[{data:'0x1234'}]});}]){const changed=structuredClone(a);mutate(changed);assert.notEqual(planDigest(a),planDigest(changed));}
 const deployment={core:tokenAddresses.CYGLD,helpers:config.contracts.helpers as Address};
 assert.notEqual(planDigest(a),planDigest(a,deployment));
 const captured=captureSelection({quote:quote(),deployment,diagnostics:{requestId:'01a13184-39fb-7b81-8a3c-39e29218b069'}});
 assert.equal(captured.primary.bounds.outputMinimum,'1000000');assert.equal(captured.primary.context.blockNumber,'100');assert.deepEqual(captured.primary.deployment,deployment);
 assert.equal(captured.primary.refs.requestId,'01a13184-39fb-7b81-8a3c-39e29218b069');
});

test('an unresolved winning submission never starts the alternate retained-plan request',async()=>{
 const s=matrix[0];let fetched=0,executed=0;
 const result=await executeAlternate({quote:quote()},s,tokenRequest(s,config,config.contracts.helpers!),{} as Page,config.contracts.helpers as Address,config,(async()=>{fetched++;throw new Error('unexpected-fetch');}) as typeof fetch,async observation=>{executed++;return observation.result;},'unknown');
 assert.equal(fetched,0);assert.equal(executed,0);assert.equal(result.attempted,false);assert.equal(result.reason,'predecessor-submission-unknown');assert.equal(result.transactionDisposition,'not-submitted');
});

test('frozen valuation discloses raw-unit pricing and configured decimals in its identity without new reads', () => {
 const facts={context:{observedAt:'2026-10-18T08:00:00Z'},basket:{assets:{status:'success',value:[tokenAddresses.PAXG]},targetsPpm:{status:'success',value:['1000000']},cygldPerUnitFp18:{status:'success',value:['40000000000000000000']}}} as unknown as ProtocolFacts;
 const wide=(2n**256n+77n).toString();
 const observations=[{exists:true,token0:tokenAddresses.USDC,token1:tokenAddresses.PAXG,marginalPrice:{numerator:wide,denominator:'3'}} as PoolSnapshot];
 const frozen=valuationSnapshot(config,facts,observations), {id,...body}=frozen;
 assert.equal(frozen.priceUnit,'usd-per-raw-unit'); assert.equal(frozen.assetDecimals?.[tokenAddresses.PAXG.toLowerCase()],18);
 assert.equal(frozen.assetDecimals?.[tokenAddresses.USDC.toLowerCase()],6); assert.equal(id,semanticDigest(body));
 assert.equal(frozen.prices[tokenAddresses.PAXG.toLowerCase()].denominator,String(BigInt(wide)*10n**6n));
 assert.equal(frozen.prices[tokenAddresses.WETH.toLowerCase()],undefined);
 const rows=buildMatrix(config,frozen); assert.equal(rows.length,24); assert.ok(rows.some(row=>row.sizingError==='valuation-unavailable'));
 const different=structuredClone(config); different.tokens.find(t=>t.type==='erc20'&&t.symbol==='PAXG')!.decimals=17;
 assert.notEqual(valuationSnapshot(different,facts,observations).id,id); assert.equal(semanticDigest(body),id);
});

test('actual Core and Market successful provider selection retains timings and non-replayable native plan terms', async () => {
 const {safeSelectedPlan}=await import('../../tests/trading/selectedPlan.ts');
 const {safeQuoteDiagnostics}=await import('./diagnosticReferences.ts');
 const address=tokenAddresses.PAXG.toLowerCase(), output=tokenAddresses.WETH.toLowerCase();
 const route={mode:'exactOut',tokenIn:address,tokenOut:output,inputAmount:'11',outputAmount:'8',limit:'12',deadline:'SECRET_DEADLINE',branches:[{amountIn:'11',hops:[{zeroForOne:true,pool:{protocol:'v3',id:`v3:${address}:${output}:0000500`,token0:{address},token1:{address:output},feePips:500,address:'0x'+'c'.repeat(40),rpcUrl:'SECRET_URL'}}]}]};
 const core={mode:'redeem-exact-out',executionAmount:'20',maximumInputAmount:'21',preview:{minimumAmountOut:'8',projectedCoreOutputs:[{kind:0,token:address,id:'0',amount:'15'}],fees:{protocolFeeCygld:'1',helperFeeCygld:'2'}},initialPreview:{projectedCoreOutputs:[{kind:0,token:address,id:'0',amount:'14'}]},expectedCoreOutputs:[{kind:0,token:address,id:'0',minimumAmount:'13'}],quotes:[{inputAsset:address,inputAmount:'15',amountIn:'16',minimumAmountOut:'8',routePlan:route,data:'SECRET_CALLDATA',adapter:config.contracts.uniswapAdapter}]};
 const market={operation:'market',mode:'exact-out',amountIn:'10',totalInput:'11',netOutput:'8',inputMaximum:'12',plan:{route,params:{recipient:'SECRET_RECIPIENT'}},adapterData:'SECRET_ADAPTER'};
 for(const provider of ['core','market'] as const){
  const original=quote();const selected=original.providerCandidates![provider]!;
  const trace={qualified:true,providerQualifications:{provider,attempts:2,selectedAttempt:2,selectionReason:'first-extension',firstQualifiedMs:1.25,selectionMs:2.5,canonicalCompletedMs:3.75,cleanupCompletedMs:4.5,rows:[{attempt:2,stage:'selection',outcome:'qualified',startedMs:1.1,completedMs:2.2,elapsedMs:1.1,executionAmount:'20',quotedInput:'21',quotedOutput:'8',inputMaximum:'22',outputMinimum:'8',pools:[{protocol:'v3',poolId:'0x'+'c'.repeat(40)}],omittedPools:0,secret:'SECRET_TRACE'}]}};
  selected.providerQuote={...(provider==='core'?core:market),quoteDiagnostics:trace} as unknown as Candidate['providerQuote'];
  Object.assign(original,selected,{strategy:provider});
  const digest=planDigest(selected), captured=captureSelection({attemptId:'attempt',quote:original});
  assert.deepEqual(captured.primary.providers[provider].quoteDiagnostics,safeQuoteDiagnostics(trace));
  assert.equal(captured.primary.providers[provider].quoteDiagnostics?.providerQualifications?.selectionReason,'first-extension');
  assert.equal(captured.primary.providers[provider].quoteDiagnostics?.providerQualifications?.rows[0].startedMs,1.1);
  assert.deepEqual(captured.primary.selectedPlan,captured.primary.providers[provider].selectedPlan);
  assert.equal(captured.primary.selectedPlan?.provider,provider);
  const plan=captured.primary.selectedPlan!;
  if(provider==='core'){assert.equal(plan.executionAmount,'20');assert.equal((plan.legs as Record<string,unknown>[])[0].inputAmount,'15');assert.equal(((plan.legs as Record<string,unknown>[])[0].route as Record<string,unknown>).inputAmount,'11');}
  else assert.equal((plan.route as Record<string,unknown>).outputAmount,'8');
  assert.doesNotMatch(JSON.stringify(captured.primary),/SECRET|adapterData|recipient|deadline|rpcUrl|data"/);
  assert.equal(planDigest(selected),digest);
  const projected=safeSelectedPlan(selected.providerQuote,provider,selected)!;
  assert.deepEqual(projected,plan);
  (selected.providerQuote as unknown as Record<string,unknown>).executionAmount='999';assert.equal(plan.executionAmount,provider==='core'?'20':undefined);
 }
});

test('selected plan summaries disclose truncation and never compact aligned Core asset amounts', async()=>{
 const {safeSelectedPlan}=await import('../../tests/trading/selectedPlan.ts');
 const pool={protocol:'v3',id:'0x'+'c'.repeat(40)},hop={pool,zeroForOne:true};
 const route={mode:'exactOut',branches:Array.from({length:9},()=>({amountIn:'5',hops:Array.from({length:9},()=>hop)}))};
 const selected=safeSelectedPlan({mode:'redeem-exact-out',quotes:[{inputAmount:'5',routePlan:route},...Array.from({length:64},()=>({inputAmount:'1'}))],preview:{orderedCoreAssets:Array.from({length:65},()=>tokenAddresses.PAXG),amountsInExact:Array.from({length:65},()=> '1')}},'core')!;
 assert.equal(selected.legsOmitted,1);assert.equal((selected.legs as unknown[]).length,64);
 const planned=(selected.legs as {route:Record<string,unknown>}[])[0].route;
 assert.equal(planned.branchesOmitted,1);assert.equal((planned.branches as unknown[]).length,8);
 assert.equal((planned.branches as Record<string,unknown>[])[0].hopsOmitted,1);
 assert.equal((selected.preview as Record<string,unknown>).orderedCoreAssetsOmitted,1);
 assert.equal((selected.preview as Record<string,unknown>).amountsInExactOmitted,1);
 const malformed=safeSelectedPlan({mode:'issue-exact-in',preview:{orderedCoreAssets:[tokenAddresses.PAXG,tokenAddresses.XAUT],amountsInExact:['10','private','30']},quotes:[{inputAmount:'1',routePlan:{branches:[{hops:[{pool:{protocol:['v4'],id:pool.id}}]}]}}]},'core')!;
 assert.equal((malformed.preview as Record<string,unknown>).amountsInExact,undefined);
 assert.deepEqual((malformed.preview as Record<string,unknown>).orderedCoreAssets,[tokenAddresses.PAXG.toLowerCase(),tokenAddresses.XAUT.toLowerCase()]);
 assert.deepEqual((((malformed.legs as Record<string,unknown>[])[0].route as Record<string,unknown>).branches as Record<string,unknown>[])[0].hops,[]);
});


test('winner digest and safe selected plan bind the submitted tuple while provider observations can advance',()=>{
 const selected=quote(), winningCandidate=selected.providerCandidates!.core!;
 const submittedDigest=planDigest(selected);
 winningCandidate.quotedOutput='9999999';winningCandidate.providerQuote={...winningCandidate.providerQuote,executionAmount:'9999999'};
 const newerDigest=planDigest(winningCandidate);assert.notEqual(newerDigest,submittedDigest);
 const capture=captureSelection({attemptId:'attempt',quote:selected}).primary;
 assert.equal(capture.planDigest,submittedDigest);assert.equal(capture.selectedPlan?.quotedOutput,'1000000');
 assert.equal(capture.providers.core.planDigest,newerDigest);assert.equal(capture.providers.core.selectedPlan?.quotedOutput,'9999999');
 assert.equal(selected.quotedOutput,'1000000');assert.equal(selected.providerCandidates!.core!.quotedOutput,'9999999');
});
