import assert from 'node:assert/strict';
import test from 'node:test';
import { corePermitSigningFields, fetchCorePermit, type CorePermitContext } from './corePermit.ts';
const owner=`0x${'1'.repeat(40)}` as const;
const core=`0x${'4'.repeat(40)}` as const;
const helpers=`0x${'5'.repeat(40)}` as const;
const snapshot:CorePermitContext={context:{chainId:31338,blockNumber:'101',blockHash:`0x${'a'.repeat(64)}`,blockTimestamp:'1',observedAt:'2026-10-02T00:00:00.000Z'},
  owner,spender:helpers,nonce:(2n**255n).toString(),domain:{name:'CyberGold Ω',version:'1',chainId:31338,verifyingContract:core}};

test('fresh permit fetch keeps owner private to its fixed same-origin request and disables cache',async()=>{
  let calls=0;
  const fetchImpl=(async(url,init)=>{
    calls++;
    assert.equal(url,`/api/account/core-permit?owner=${owner}`);
    assert.equal(init?.cache,'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'),false);
    return Response.json(snapshot);
  }) as typeof fetch;
  assert.deepEqual(await fetchCorePermit(owner,fetchImpl),snapshot);
  await fetchCorePermit(owner,fetchImpl);
  assert.equal(calls,2);
});

test('permit signing fields keep the existing App domain and all nonce bits',()=>{
  assert.deepEqual(corePermitSigningFields(snapshot,31338,core,helpers),{
    domain:{name:'CyberGold Ω',version:'1',chainId:31338,verifyingContract:core},spender:helpers,nonce:2n**255n});
});

test('provider failure cannot prompt a wallet using a zero or previous nonce',async()=>{
  await assert.rejects(fetchCorePermit(owner,(async()=>Response.json({error:'unavailable'},{status:503})) as typeof fetch),/temporarily unavailable/);
});

test('transport failure is propagated once without RPC fallback',async()=>{
  let calls=0;
  await assert.rejects(fetchCorePermit(owner,(async()=>{calls++;throw new Error('fixture transport failure');}) as typeof fetch),/fixture transport failure/);
  assert.equal(calls,1);
});
