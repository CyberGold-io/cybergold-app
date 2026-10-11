import assert from 'node:assert/strict';
import test from 'node:test';
import { attachedRecoveryAssets, fetchCoreRecoveryAssets, type CoreRecoveryAssets } from './coreRecoveryAssets.ts';
const asset='0x45804880De22913dAFE09f4980848ECE6EcbAf78';
const snapshot:CoreRecoveryAssets={context:{chainId:31338,blockNumber:'101',blockHash:`0x${'a'.repeat(64)}`,blockTimestamp:'1',observedAt:'2026-10-02T00:00:00Z'},core:`0x${'4'.repeat(40)}`,assets:[asset,`0x${'6'.repeat(40)}`]};

test('recovery asset observations retain contract order and authoritative empty state',()=>{
  assert.deepEqual(attachedRecoveryAssets(snapshot),snapshot.assets);
  assert.deepEqual(attachedRecoveryAssets({...snapshot,assets:[]}),[]);
});

test('redemption identifiers retain all address bits',()=>{
  assert.deepEqual(attachedRecoveryAssets(snapshot).map(BigInt),snapshot.assets.map(BigInt));
});

test('fixed asset read forwards cancellation and uses no browser bearer or shared cache',async()=>{
  const abort=new AbortController();let calls=0;
  const value=await fetchCoreRecoveryAssets(abort.signal,(async(url,init)=>{
    calls++;assert.equal(url,'/api/protocol/recovery-assets');assert.equal(init?.signal,abort.signal);
    assert.equal(init?.cache,'no-store');assert.equal(new Headers(init?.headers).has('authorization'),false);
    return Response.json(snapshot);
  }) as typeof fetch);
  assert.deepEqual(value,snapshot);assert.equal(calls,1);
});

test('unavailable recovery assets cannot become an empty successful list or RPC fallback',async()=>{
  let calls=0;
  await assert.rejects(fetchCoreRecoveryAssets(undefined,(async()=>{
    calls++;return Response.json({error:'unavailable'},{status:503});
  }) as typeof fetch),/temporarily unavailable/);
  assert.equal(calls,1);
});
