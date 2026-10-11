import assert from 'node:assert/strict';
import test from 'node:test';
import {getTokensNeedingPermit2Approval} from './tokensApproval.ts';
const OWNER='0x0000000000000000000000000000000000000001';
const FIRST='0x0000000000000000000000000000000000000003';
const SECOND='0x0000000000000000000000000000000000000004';
test('approval discovery preserves positive permission order and exact uint comparisons',async()=>{
  const required=await getTokensNeedingPermit2Approval({owner:OWNER,
    permitted:[{token:FIRST,amount:2n**255n+1n},{token:SECOND,amount:0n},{token:SECOND,amount:10n}],
    fetchImpl:(async(url,init)=>{
      assert.equal(url,'/api/account/permit2');
      assert.deepEqual(JSON.parse(init?.body as string),{mode:'allowances',owner:OWNER,tokens:[FIRST,SECOND]});
      assert.equal(init?.cache,'no-store');
      return Response.json({mode:'allowances',result:{allowances:[{token:FIRST,value:(2n**255n).toString()},{token:SECOND,value:'10'}]}});
    }) as typeof fetch});
  assert.deepEqual(required,[{token:FIRST,amount:2n**255n+1n,allowance:2n**255n}]);
});
test('zero-only permissions probe no backend or token',async()=>{
  assert.deepEqual(await getTokensNeedingPermit2Approval({owner:OWNER,permitted:[{token:FIRST,amount:0n}],
    fetchImpl:(async()=>{throw new Error('should not request');}) as typeof fetch}),[]);
});
test('allowance outage cannot be interpreted as zero or approval permission',async()=>{
  await assert.rejects(getTokensNeedingPermit2Approval({owner:OWNER,permitted:[{token:FIRST,amount:1n}],
    fetchImpl:(async()=>Response.json({error:'unavailable'},{status:503})) as typeof fetch}),/temporarily unavailable/);
});
