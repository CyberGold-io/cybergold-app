import assert from 'node:assert/strict';
import test from 'node:test';
import {getPermit2Nonce} from './permit2/nonce.ts';
const OWNER='0x0000000000000000000000000000000000000001';
for(const nonce of [2n,257n,2n**255n]){
  test(`fresh Permit2 nonce retains backend traversal and all bits (${nonce})`,async()=>{
    const value=await getPermit2Nonce({owner:OWNER,fetchImpl:(async(url,init)=>{
      assert.equal(url,'/api/account/permit2');
      assert.deepEqual(JSON.parse(init?.body as string),{mode:'nonce',owner:OWNER});
      assert.equal(init?.cache,'no-store');
      return Response.json({mode:'nonce',result:{nonce:nonce.toString()}});
    }) as typeof fetch});
    assert.equal(value,nonce);
  });
}
test('nonce outage cannot supply zero or a previous value',async()=>{
  await assert.rejects(getPermit2Nonce({owner:OWNER,fetchImpl:(async()=>Response.json({error:'unavailable'},{status:503})) as typeof fetch}),/temporarily unavailable/);
});
