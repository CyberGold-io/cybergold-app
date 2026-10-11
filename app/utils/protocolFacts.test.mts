import assert from 'node:assert/strict';
import test from 'node:test';
import { basketFromFacts, bigintFact, fetchProtocolFacts, type ProtocolFacts } from './protocolFacts.ts';
const success=<T,>(value:T)=>({status:'success' as const,value});
const failure={status:'failure' as const,error:'contract-read-failed' as const};
const address=`0x${'6'.repeat(40)}`;
export function facts():ProtocolFacts{return {context:{chainId:31338,blockNumber:'101',blockHash:`0x${'a'.repeat(64)}`,blockTimestamp:'1790800000',observedAt:'2026-10-01T00:00:00Z'},core:`0x${'4'.repeat(40)}`,helpers:null,basket:{assets:success([address]),targetsPpm:success(['1000000']),goldRefGramsFp18:success([(2n**200n).toString()]),cygldPerUnitFp18:success(['17']),metadata:[{address,decimals:success(18),name:success('Gold €'),symbol:success('XAU')}]},reference:success((2n**180n).toString()),fees:{issuancePpm:success('0'),helpersPpm:{status:'failure',error:'not-configured'}},pause:success(false)};}

test('protocol facts preserve wide raw basket/reference values and zero fees',()=>{
 const value=facts();const basket=basketFromFacts(value)!;
 assert.equal(basket[2][0],2n**200n);assert.equal(basket[4][0],'Gold €');
 assert.equal(bigintFact(value.reference),2n**180n);assert.equal(bigintFact(value.fees.issuancePpm),0n);
 assert.equal(bigintFact(value.fees.helpersPpm),undefined);
});
test('partial basket/metadata and mismatched arrays preserve an unavailable basket',()=>{
 for(const field of ['assets','targetsPpm','goldRefGramsFp18','cygldPerUnitFp18'] as const){const value=facts();value.basket[field]=failure;assert.equal(basketFromFacts(value),undefined);assert.equal(bigintFact(value.reference),2n**180n);}
 for(const field of ['decimals','name','symbol'] as const){const value=facts();value.basket.metadata[0][field]=failure;assert.equal(basketFromFacts(value),undefined);}
 const value=facts();value.basket.targetsPpm=success([]);assert.equal(basketFromFacts(value),undefined);
 assert.equal(basketFromFacts(),undefined);
});
test('focused fetch uses only its fixed same-origin operation and propagates cancellation',async()=>{
 const controller=new AbortController();let calls=0;
 const result=await fetchProtocolFacts(controller.signal,(async(url,init)=>{calls++;assert.equal(url,'/api/protocol/facts');assert.equal(init?.signal,controller.signal);assert.equal(init?.cache,'no-store');assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json(facts());}) as typeof fetch);
 assert.equal(calls,1);assert.equal(result.reference.status,'success');
});
test('supplier failure gets an ordinary query error with no RPC fallback or retry',async()=>{
 let calls=0;await assert.rejects(fetchProtocolFacts(undefined,(async(url)=>{calls++;assert.equal(url,'/api/protocol/facts');return Response.json({error:'private text'},{status:503});}) as typeof fetch),/temporarily unavailable/);assert.equal(calls,1);
});
