import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPendingTransactionNonce, transactionNonceValue, type TransactionNonce } from './transactionNonce.ts';

const owner=`0x${'1'.repeat(40)}` as const;
const snapshot:TransactionNonce={context:{chainId:31338,blockNumber:'101',blockHash:`0x${'a'.repeat(64)}`,blockTimestamp:'1',observedAt:'2026-10-02T00:00:00Z'},owner,blockTag:'pending',nonce:'7'};

test('nonce conversion retains Viem integer behavior instead of silently truncating',()=>{
  assert.equal(transactionNonceValue(snapshot),7);
  assert.equal(transactionNonceValue({...snapshot,nonce:'0'}),0);
  assert.equal(transactionNonceValue({...snapshot,nonce:String(Number.MAX_SAFE_INTEGER)}),Number.MAX_SAFE_INTEGER);
  assert.throws(()=>transactionNonceValue({...snapshot,nonce:(2n**53n).toString()}));
});

test('pending nonce uses its fixed same-origin adapter with no cache or browser bearer',async()=>{
  const value=await fetchPendingTransactionNonce(owner,(async(url,init)=>{
    assert.equal(url,`/api/account/transaction-nonce?owner=${owner}`);
    assert.equal(init?.cache,'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'),false);
    return Response.json(snapshot);
  }) as typeof fetch);
  assert.equal(value,7);
});

test('each intent fetches fresh pending state without reserving or reusing a nonce',async()=>{
  let nonce=3;
  const fetchImpl=(async()=>Response.json({...snapshot,nonce:String(nonce++)})) as typeof fetch;
  assert.equal(await fetchPendingTransactionNonce(owner,fetchImpl),3);
  assert.equal(await fetchPendingTransactionNonce(owner,fetchImpl),4);
});

test('unavailable nonce never becomes zero or retries through browser RPC',async()=>{
  let calls=0;
  await assert.rejects(fetchPendingTransactionNonce(owner,(async()=>{
    calls++;return Response.json({error:'unavailable'},{status:503});
  }) as typeof fetch),/temporarily unavailable/);
  assert.equal(calls,1);
});

test('transport failure remains an ordinary error before wallet submission',async()=>{
  let calls=0;
  await assert.rejects(fetchPendingTransactionNonce(owner,(async()=>{
    calls++;throw new Error('fixture transport failure');
  }) as typeof fetch),/fixture transport failure/);
  assert.equal(calls,1);
});
