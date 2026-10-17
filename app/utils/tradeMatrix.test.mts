import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatrix, valuationSnapshot, matrixCounts, matrixTemplates, semanticDigest, repetitionManifest, assertMatrixIntent, type ValuationSnapshot } from '../../tests/trading/matrix.ts';
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
const matrix = buildMatrix(config, valuation);
const candidate = (strategy: 'core' | 'market'): Candidate => ({ strategy, side: 'sell', mode: 'exact-out', tokenIn: tokenAddresses.CYGLD, tokenOut: tokenAddresses.USDC,
 quotedInput: '100', quotedOutput: '1000000', inputMaximum: '100', outputMinimum: '1000000', context: { chainId: 31337, blockNumber: '100', blockHash: `0x${'b'.repeat(64)}` },
 providerRequest: { mode: 'redeem-exact-out', token: tokenAddresses.USDC, quoteToken: tokenAddresses.USDC, native: false, amount: '1000000', deadline: '2000000000', adapter: config.contracts.uniswapAdapter, orderedAssets: [], targets: [], slippageBps: 100 },
 providerQuote: { workId: '01a13184-39fb-7b81-8a3c-39e29218b069' }, evaluation: { core: 'complete', market: 'complete' }, metrics: { totalMs: 1, targetReads: 0 } } as unknown as Candidate);
const quote = (): ProviderQuote => ({ ...candidate('core'), providerAssessments: { core: { availability: 'qualified', searchOutcome: 'complete' }, market: { availability: 'qualified', searchOutcome: 'timeout' } }, providerCandidates: { core: candidate('core'), market: candidate('market') } } as unknown as ProviderQuote);

test('one inventory has48 economic scenarios and96 provider slots, never96 independent primary rows', () => {
 assert.equal(matrix.length, 48); assert.equal(new Set(matrix.map(r => r.id)).size, 48);
 assert.deepEqual(matrixCounts, { scenarioCount: 48, providerAssessmentCount: 96, maximumTradeExecutions: 96 });
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
 assert.equal(buildMatrix(config,unusual).find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='small')!.amountRaw,'333333');
});
test('absent valuation remains an ordinary sizing error instead of inventing a price or shrinking a case',()=>{
 const absent = structuredClone(valuation); delete absent.prices[tokenAddresses.WETH.toLowerCase()];
 const rows=buildMatrix(config,absent);
 assert.ok(rows.filter(r=>r.asset==='ETH'&&((r.side==='buy')===(r.inputMode==='exact-in'))).every(r=>r.sizingError==='valuation-unavailable'));
 assert.ok(rows.filter(r=>r.asset==='USDC').every(r=>!r.sizingError));
 assert.equal(rows.length,48);
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
test('unsupported alternate records a coverage omission and submits nothing',async()=>{
 const q=quote();q.providerAssessments!.market={availability:'unsupported',searchOutcome:'not-run'};delete q.providerCandidates!.market;
 const s=matrix.find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='small')!;
 const result=await executeAlternate({attemptId:'attempt',quote:q},s,tokenRequest(s,config,config.contracts.helpers!),{} as Page,config.contracts.helpers as Address,config,async()=>{throw new Error('must-not-fetch');});
 assert.equal(result.attempted,false);assert.equal(result.reason,'unsupported');assert.equal(result.transactionDisposition,'not-submitted');
});
test('alternate replay uses exact captured retained plan and records revalidation separately',async()=>{
 const q=quote(), s=matrix.find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='small')!;
 let request:Record<string,unknown>|undefined;let executed=0;
 const result=await executeAlternate({attemptId:'attempt',quote:q},s,tokenRequest(s,config,config.contracts.helpers!),{} as Page,config.contracts.helpers as Address,config,
  (async(_url,init)=>{request=JSON.parse(String(init?.body));return new Response(JSON.stringify({type:'complete',value:{...candidate('market'),context:{...candidate('market').context,blockNumber:'101'}}})+'\n');}) as typeof fetch,
  async observation=>{executed++;observation.result.status='pass';observation.result.executionStage='complete';return observation.result;});
 assert.equal(executed,1);assert.deepEqual((request!.retainedPlan as {quote:unknown}).quote,q.providerCandidates!.market!.providerQuote);
 assert.equal(result.planDigest,planDigest(q.providerCandidates!.market!));assert.ok(result.revalidatedPlanDigest);assert.equal(result.attempted,true);assert.equal(result.status,'pass');assert.equal(result.reason,undefined);
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
 assert.equal(buildMatrix(config,source).find(r=>r.asset==='USDC'&&r.side==='buy'&&r.inputMode==='exact-out'&&r.size==='small')!.amountRaw,'10000000000000000');
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
 assert.equal(buildMatrix(config,source).find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='small')!.amountRaw,'0');
 source.prices[tokenAddresses.USDC.toLowerCase()]={numerator:'1',denominator:String(10n**40n)};
 assert.equal(buildMatrix(config,source).find(r=>r.asset==='USDC'&&r.side==='sell'&&r.inputMode==='exact-out'&&r.size==='large')!.amountRaw,String(10n**44n));
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
