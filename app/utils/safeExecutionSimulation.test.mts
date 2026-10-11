import assert from 'node:assert/strict';
import test from 'node:test';
import type { SafeTxPayload } from './governanceSafeContracts.ts';
import { safeExecutionRequest, simulateSafeExecution } from './safeExecutionSimulation.ts';

const address=`0x${'1'.repeat(40)}` as const,executor=`0x${'2'.repeat(40)}` as const;
const signatures=`0x${'ab'.repeat(130)}` as const;
const payload:SafeTxPayload={to:`0x${'3'.repeat(40)}`,value:2n**200n+1n,data:'0xabcdef00',operation:1,
  safeTxGas:120000n,baseGas:0n,gasPrice:7n,gasToken:`0x${'0'.repeat(40)}`,refundReceiver:address,nonce:99n};

test('Safe simulation preserves execution payload, executor nonce and signatures without signing',()=>{
  assert.deepEqual(safeExecutionRequest(address,payload,executor,7,signatures),{address,to:payload.to,
    value:payload.value.toString(),data:payload.data,operation:1,safeTxGas:'120000',baseGas:'0',gasPrice:'7',
    gasToken:payload.gasToken,refundReceiver:address,executor,executorNonce:'7',signatures});
});

test('fresh private adapter simulation distinguishes true and false',async()=>{
  for(const success of [true,false]) {
    const result=await simulateSafeExecution(address,payload,executor,7,signatures,(async(url,init)=>{
      assert.equal(url,'/api/governance/safe-execution');assert.equal(init?.method,'POST');assert.equal(init?.cache,'no-store');
      assert.deepEqual(JSON.parse(String(init?.body)),safeExecutionRequest(address,payload,executor,7,signatures));
      assert.equal(new Headers(init?.headers).has('authorization'),false);
      return Response.json({success});
    }) as typeof fetch);
    assert.equal(result,success);
  }
});

test('simulation failure remains an error before wallet submission with no browser RPC fallback',async()=>{
  let calls=0;
  await assert.rejects(simulateSafeExecution(address,payload,executor,7,signatures,(async()=>{
    calls++;return Response.json({error:'unavailable'},{status:503});
  }) as typeof fetch),/temporarily unavailable/);
  assert.equal(calls,1);
});

test('simulation transport failure remains its ordinary error',async()=>{
  await assert.rejects(simulateSafeExecution(address,payload,executor,7,signatures,(async()=>{
    throw new Error('Connection closed');
  }) as typeof fetch),/Connection closed/);
});
