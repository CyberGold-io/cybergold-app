import assert from 'node:assert/strict';
import test from 'node:test';
import {zeroAddress,type Hex} from 'viem';
import {requirePermit2ContractAddress,verifyPermit2ContractAddress} from './permit2/verifyAddress.ts';
const PERMIT2='0x000000000022D473030F116dDEE9F6B43aC78BA3';
const OTHER_PERMIT2='0x0000000000000000000000000000000000000002';
function fetcher({permit2=PERMIT2,code='0x6000',status=200}:{permit2?:string;code?:Hex|null;status?:number}={}){
  return (async(url,init)=>{
    assert.equal(url,'/api/account/permit2');
    assert.deepEqual(JSON.parse(init?.body as string),{mode:'verify'});
    assert.equal(init?.cache,'no-store');
    return Response.json({mode:'verify',permit2,result:{code}},{status});
  }) as typeof fetch;
}
test('fresh backend router/bytecode facts preserve Permit2 verification',async()=>{
  assert.equal(await verifyPermit2ContractAddress({expectedPermit2Address:PERMIT2.toLowerCase() as `0x${string}`,fetchImpl:fetcher()}),PERMIT2);
});
test('a changed router address still rejects the cached Permit2 before signing',async()=>{
  await assert.rejects(verifyPermit2ContractAddress({expectedPermit2Address:PERMIT2,fetchImpl:fetcher({permit2:OTHER_PERMIT2})}),/Permit2 address changed/);
});
test('router outage cannot fall back to a cached address',async()=>{
  await assert.rejects(verifyPermit2ContractAddress({expectedPermit2Address:PERMIT2,fetchImpl:fetcher({status:503})}),/temporarily unavailable/);
});
test('a zero router address still fails verification',async()=>{
  await assert.rejects(verifyPermit2ContractAddress({expectedPermit2Address:PERMIT2,fetchImpl:fetcher({permit2:zeroAddress})}),/address is invalid/);
});
for(const code of [null,'0x'] as const){
  test(`an address without bytecode still fails verification (${code})`,async()=>{
    await assert.rejects(verifyPermit2ContractAddress({expectedPermit2Address:PERMIT2,fetchImpl:fetcher({code})}),/no deployed contract/);
  });
}
test('existing address validation retains missing malformed and zero failures',()=>{
  for(const value of [undefined,null,'','0x1234',zeroAddress])assert.throws(()=>requirePermit2ContractAddress(value),/address is (unavailable|invalid)/);
});
