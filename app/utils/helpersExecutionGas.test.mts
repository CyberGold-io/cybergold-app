import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateHelpersExecutionGas, type HelpersExecutionOperation } from './helpersExecutionGas.ts';

const owner=`0x${'1'.repeat(40)}` as const;
const operations:HelpersExecutionOperation[]=['issueFromBasketExactInWithPermit2','issueFromBasketExactOutWithPermit2',
  'issueFromTokenExactOutWithPermit2','issueFromTokenExactOutWithPermit','issueFromTokenExactOut','issueFromNativeExactOut','redeemToBasketExactInWithPermit',
  'redeemToTokenExactInWithPermit','redeemToNativeExactInWithPermit'];

test('exact purchase and signed operation hints retain nested amounts and signatures without an ABI or target',async()=>{
  const amount=2n**200n+1n,gas=2n**100n+1n;
  const args=[{recipient:owner,expectedCoreOutputs:[{kind:1,token:owner,id:amount,minimumAmount:0n}]},
    {permit:{nonce:amount,permitted:[{token:owner,amount}]},signature:'0xabcd'}] as const;
  for(const operation of operations) {
    const result=await estimateHelpersExecutionGas(owner,operation,args,undefined,(async(url,init)=>{
      assert.equal(url,'/api/transaction/helpers-execution');assert.equal(init?.method,'POST');assert.equal(init?.cache,'no-store');
      assert.deepEqual(JSON.parse(String(init?.body)),{owner,operation,args:[{recipient:owner,
        expectedCoreOutputs:[{kind:1,token:owner,id:amount.toString(),minimumAmount:'0'}]},
        {permit:{nonce:amount.toString(),permitted:[{token:owner,amount:amount.toString()}]},signature:'0xabcd'}]});
      assert.equal(new Headers(init?.headers).has('authorization'),false);
      return Response.json({gas:gas.toString()});
    }) as typeof fetch);
    assert.equal(result,gas);
  }
});

test('native execution value preserves zero and large exact values',async()=>{
  for(const value of [0n,2n**200n+1n]) {
    const gas=await estimateHelpersExecutionGas(owner,'issueFromNativeExactOut',[],value,(async(_,init)=>{
      assert.equal(JSON.parse(String(init?.body)).value,value.toString());return Response.json({gas:'0'});
    }) as typeof fetch);
    assert.equal(gas,0n);
  }
});

test('fee-hint supplier failure remains unavailable with no browser RPC fallback or default gas',async()=>{
  let calls=0;
  await assert.rejects(estimateHelpersExecutionGas(owner,operations[0],[],undefined,(async()=>{
    calls++;return Response.json({error:'reverted'},{status:503});
  }) as typeof fetch),/temporarily unavailable/);
  assert.equal(calls,1);
});

test('malformed gas and transport failure remain ordinary errors for the existing optional hint caller',async()=>{
  await assert.rejects(estimateHelpersExecutionGas(owner,operations[0],[],undefined,
    (async()=>Response.json({gas:'unavailable'})) as typeof fetch));
  await assert.rejects(estimateHelpersExecutionGas(owner,operations[0],[],undefined,
    (async()=>{throw new Error('Connection closed');}) as typeof fetch),/Connection closed/);
});

test('ending a swap aborts its optional signed fee hint', async()=>{
  const controller=new AbortController();
  const result=estimateHelpersExecutionGas(owner,operations[0],[],undefined,(async(_,init)=>{
    assert.equal(init?.signal,controller.signal);
    return new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason)));
  }) as typeof fetch,controller.signal);
  controller.abort();
  await assert.rejects(result,{name:'AbortError'});
});

const helpers = `0x${"2".repeat(40)}` as const;
test("gas from a different configured Helpers cannot become the captured operation's fee hint", async () => {
  let calls = 0;
  const observed = (async () => { calls++; return Response.json({ helpers: owner, gas: "100" }); }) as typeof fetch;
  await assert.rejects(estimateHelpersExecutionGas(owner, operations[0], [], undefined, observed, undefined, helpers), /Helpers simulation target changed/);
  assert.equal(calls, 1);
  assert.equal(await estimateHelpersExecutionGas(owner, operations[0], [], undefined,
    (async () => Response.json({ helpers: helpers.toUpperCase(), gas: "100" })) as typeof fetch, undefined, helpers), 100n);
});
