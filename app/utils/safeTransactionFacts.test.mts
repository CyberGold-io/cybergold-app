import assert from 'node:assert/strict';
import test from 'node:test';
import type { SafeTxPayload } from './governanceSafeContracts.ts';
import { fetchSafeNonce, fetchSafeTransactionHash, safeTransactionHashRequest } from './safeTransactionFacts.ts';

const address=`0x${'1'.repeat(40)}` as const;
const hash=`0x${'a'.repeat(64)}` as const;
const payload:SafeTxPayload={to:`0x${'2'.repeat(40)}`,value:2n**200n+1n,data:'0xabcdef00',operation:1,
  safeTxGas:120000n,baseGas:0n,gasPrice:7n,gasToken:`0x${'0'.repeat(40)}`,refundReceiver:address,nonce:2n**255n+1n};

test('Safe nonce stays lossless and uses a fresh same-origin read',async()=>{
  const signal=new AbortController().signal;
  const nonce=await fetchSafeNonce(address,signal,(async(url,init)=>{
    assert.equal(url,`/api/governance/safe-nonce?address=${address}`);
    assert.equal(init?.signal,signal);assert.equal(init?.cache,'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'),false);
    return Response.json({nonce:payload.nonce.toString()});
  }) as typeof fetch);
  assert.equal(nonce,payload.nonce);
});

test('unsigned Safe hash request preserves every exact field without signatures or overrides',()=>{
  assert.deepEqual(safeTransactionHashRequest(address,payload),{address,to:payload.to,value:payload.value.toString(),data:payload.data,
    operation:1,safeTxGas:'120000',baseGas:'0',gasPrice:'7',gasToken:payload.gasToken,refundReceiver:address,nonce:payload.nonce.toString()});
});

test('hash read forwards the exact payload and cancellation without a browser bearer',async()=>{
  const signal=new AbortController().signal;
  const value=await fetchSafeTransactionHash(address,payload,signal,(async(url,init)=>{
    assert.equal(url,'/api/governance/safe-transaction-hash');assert.equal(init?.method,'POST');
    assert.equal(init?.cache,'no-store');assert.equal(init?.signal,signal);
    assert.deepEqual(JSON.parse(String(init?.body)),safeTransactionHashRequest(address,payload));
    assert.equal(new Headers(init?.headers).get('content-type'),'application/json');
    assert.equal(new Headers(init?.headers).has('authorization'),false);
    return Response.json({safeTxHash:hash});
  }) as typeof fetch);
  assert.equal(value,hash);
});

test('successive nonce observations are not cached or reserved in the frontend utility',async()=>{
  let nonce=2;
  const fetchImpl=(async()=>Response.json({nonce:String(nonce++)})) as typeof fetch;
  assert.equal(await fetchSafeNonce(address,undefined,fetchImpl),2n);
  assert.equal(await fetchSafeNonce(address,undefined,fetchImpl),3n);
});

test('Safe provider failure never supplies zero nonce or an invented hash and has no browser RPC fallback',async()=>{
  let calls=0;
  const fetchImpl=(async()=>{calls++;return Response.json({error:'unavailable'},{status:503});}) as typeof fetch;
  await assert.rejects(fetchSafeNonce(address,undefined,fetchImpl),/temporarily unavailable/);
  await assert.rejects(fetchSafeTransactionHash(address,payload,undefined,fetchImpl),/temporarily unavailable/);
  assert.equal(calls,2);
});

test('aborted Safe observations retain the ordinary abort error',async()=>{
  const fetchImpl=(async()=>{throw new DOMException('Cancelled','AbortError');}) as typeof fetch;
  await assert.rejects(fetchSafeNonce(address,undefined,fetchImpl),{name:'AbortError'});
  await assert.rejects(fetchSafeTransactionHash(address,payload,undefined,fetchImpl),{name:'AbortError'});
});
