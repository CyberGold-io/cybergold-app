import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, toEventHash } from 'viem';
import { statusFromSafeExecutionLogs } from './governanceSafeContracts.ts';
import { fetchTransactionReceipt, type TransactionReceiptObservation } from './transactionReceipt.ts';

const hash=`0x${'a'.repeat(64)}` as const;
const safeHash=`0x${'b'.repeat(64)}` as const;
const safe=`0x${'1'.repeat(40)}` as const;
const data=encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[safeHash,0n]);
const snapshot:TransactionReceiptObservation={chainId:31338,observedAt:'2026-10-02T00:00:00Z',transactionHash:hash,
  receipt:{transactionHash:hash,blockHash:`0x${'c'.repeat(64)}`,blockNumber:(2n**60n+1n).toString(),status:'success',
    logs:[{address:safe,data,topics:[toEventHash('ExecutionSuccess(bytes32,uint256)')]}]}};

test('receipt conversion retains wide block identity and Safe event bytes',async()=>{
  const receipt=await fetchTransactionReceipt(hash,undefined,(async()=>Response.json(snapshot)) as typeof fetch);
  assert.equal(receipt?.blockNumber,2n**60n+1n);
  assert.equal(receipt?.transactionHash,hash);
  assert.equal(statusFromSafeExecutionLogs(receipt!.logs,safe,safeHash),'executed');
  assert.equal(statusFromSafeExecutionLogs(receipt!.logs,safe,hash),undefined);
});

test('Safe ExecutionFailure is interpreted by its existing decoder, not EVM success alone',async()=>{
  const value={...snapshot,receipt:{...snapshot.receipt!,logs:[{address:safe,data,topics:[toEventHash('ExecutionFailure(bytes32,uint256)')]}]}};
  const receipt=await fetchTransactionReceipt(hash,undefined,(async()=>Response.json(value)) as typeof fetch);
  assert.equal(receipt?.status,'success');
  assert.equal(statusFromSafeExecutionLogs(receipt!.logs,safe,safeHash),'failed');
});

test('native missing receipt is unknown and does not become a Safe outage or replacement',async()=>{
  assert.equal(await fetchTransactionReceipt(hash,undefined,(async()=>Response.json({...snapshot,receipt:null})) as typeof fetch),null);
});

test('receipt reads forward cancellation, disable cache and expose no browser bearer',async()=>{
  const abort=new AbortController();
  await fetchTransactionReceipt(hash,abort.signal,(async(url,init)=>{
    assert.equal(url,`/api/transaction/receipt?hash=${hash}`);
    assert.equal(init?.signal,abort.signal);assert.equal(init?.cache,'no-store');
    assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json(snapshot);
  }) as typeof fetch);
});

test('provider outage is an error, with no missing substitution or browser RPC fallback',async()=>{
  let calls=0;
  await assert.rejects(fetchTransactionReceipt(hash,undefined,(async()=>{
    calls++;return Response.json({error:'unavailable'},{status:503});
  }) as typeof fetch),/temporarily unavailable/);
  assert.equal(calls,1);
});

test('successive reads do not reuse a receipt from an earlier fork or observation',async()=>{
  let calls=0;
  const fetchImpl=(async()=>Response.json(calls++===0?snapshot:{...snapshot,receipt:null})) as typeof fetch;
  assert.ok(await fetchTransactionReceipt(hash,undefined,fetchImpl));
  assert.equal(await fetchTransactionReceipt(hash,undefined,fetchImpl),null);
});
