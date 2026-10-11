import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchTransactionFees, transactionFeesQuery, transactionFeeValues, type TransactionFees } from './transactionFees.ts';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

test('fee observers reuse one observation until head invalidation, including same-height replacements', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({...snapshot, maxFeePerGas:String(++calls)}));
  const client = new QueryClient();
  t.after(() => client.clear());
  const options = transactionFeesQuery(31338, 'generation');
  const observer = new QueryObserver(client, options);
  const stop = observer.subscribe(() => {});
  t.after(stop);
  await Promise.all(Array.from({length:20},()=>client.fetchQuery(options)));
  assert.equal(calls, 1);
  await client.fetchQuery(options);
  assert.equal(calls, 1);
  await client.invalidateQueries({queryKey:['transaction-fees']});
  assert.equal(calls, 2);
  assert.equal(client.getQueryData<TransactionFees>(options.queryKey)?.maxFeePerGas, '2');
  await client.invalidateQueries({queryKey:['transaction-fees']});
  assert.equal(calls, 3);
});
const snapshot:TransactionFees={context:{chainId:31338,blockNumber:'101',blockHash:`0x${'a'.repeat(64)}`,blockTimestamp:'1',observedAt:'2026-10-02T00:00:00Z'},maxFeePerGas:(2n**180n+1n).toString(),maxPriorityFeePerGas:(2n**120n).toString()};

test('fee conversion keeps all integer bits and authoritative zero',()=>{
  assert.deepEqual(transactionFeeValues(snapshot),{maxFeePerGas:2n**180n+1n,maxPriorityFeePerGas:2n**120n});
  assert.deepEqual(transactionFeeValues({...snapshot,maxFeePerGas:'0',maxPriorityFeePerGas:'0'}),{maxFeePerGas:0n,maxPriorityFeePerGas:0n});
});

test('fee read uses the fixed adapter without browser credentials and forwards cancellation',async()=>{
  const abort=new AbortController();
  const result=await fetchTransactionFees(abort.signal,(async(url,init)=>{
    assert.equal(url,'/api/transaction/fees');assert.equal(init?.signal,abort.signal);assert.equal(init?.cache,'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json(snapshot);
  }) as typeof fetch);
  assert.deepEqual(result,snapshot);
});

test('failed fees remain unavailable with no zero substitution or RPC fallback',async()=>{
  let calls=0;
  await assert.rejects(fetchTransactionFees(undefined,(async()=>{calls++;return Response.json({error:'unavailable'},{status:503});}) as typeof fetch),/temporarily unavailable/);
  assert.equal(calls,1);
});

test('successive fee calls obtain fresh observations',async()=>{
  let calls=0;
  const fetchImpl=(async()=>Response.json({...snapshot,maxFeePerGas:String(++calls)})) as typeof fetch;
  assert.equal((await fetchTransactionFees(undefined,fetchImpl)).maxFeePerGas,'1');
  assert.equal((await fetchTransactionFees(undefined,fetchImpl)).maxFeePerGas,'2');
});
