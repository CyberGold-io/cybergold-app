import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchGovernanceRoles, governanceRoleMembers, normalizeRoleAddress, type GovernanceRoles } from './governanceRoles.ts';

const address=`0x${'1'.repeat(40)}` as const;
const second=`0x${'2'.repeat(40)}` as const;
const facts:GovernanceRoles={context:{chainId:31338,blockNumber:'101',blockHash:`0x${'a'.repeat(64)}`,blockTimestamp:'1',observedAt:'2026-10-02T00:00:00Z'},surface:'core',address,memberDisplayLimit:50,
  roles:[{id:'DEFAULT_ADMIN_ROLE',count:{status:'success',value:'2'},members:[{status:'success',value:address},{status:'success',value:second}]},
    {id:'UPGRADER_ROLE',count:{status:'success',value:'0'},members:[]}]};

test('fixed role roster uses same-origin no-store and cancellation without browser bearer',async()=>{
  const signal=new AbortController().signal;
  assert.deepEqual(await fetchGovernanceRoles('core',signal,(async(url,init)=>{
    assert.equal(url,'/api/governance/roles?surface=core');assert.equal(init?.cache,'no-store');assert.equal(init?.signal,signal);
    assert.equal(new Headers(init?.headers).has('authorization'),false);return Response.json(facts);
  }) as typeof fetch),facts);
});

test('ordered members and successful empty role retain their expected counts',()=>{
  const rows=governanceRoleMembers(facts,['DEFAULT_ADMIN_ROLE','UPGRADER_ROLE'],false,false);
  assert.deepEqual(rows.DEFAULT_ADMIN_ROLE,{members:[address,second],expectedCount:2,isLoading:false,isUnavailable:false});
  assert.deepEqual(rows.UPGRADER_ROLE,{members:[],expectedCount:0,isLoading:false,isUnavailable:false});
});

test('count failure cannot become an empty successful role',()=>{
  const rows=governanceRoleMembers({...facts,roles:[{id:'DEFAULT_ADMIN_ROLE',count:{status:'failure',error:'contract-read-failed'},members:[]}]},['DEFAULT_ADMIN_ROLE'],false,false);
  assert.equal(rows.DEFAULT_ADMIN_ROLE.expectedCount,undefined);assert.equal(rows.DEFAULT_ADMIN_ROLE.isUnavailable,true);
});

test('partial members stay visible with an explicit unavailable observation',()=>{
  const rows=governanceRoleMembers({...facts,roles:[{...facts.roles[0],members:[{status:'failure',error:'contract-read-failed'},{status:'success',value:second}]}]},['DEFAULT_ADMIN_ROLE'],false,false);
  assert.deepEqual(rows.DEFAULT_ADMIN_ROLE.members,[second]);assert.equal(rows.DEFAULT_ADMIN_ROLE.expectedCount,2);assert.equal(rows.DEFAULT_ADMIN_ROLE.isUnavailable,true);
});

test('retained first-50 display preserves the true count rather than calling it complete',()=>{
  const rows=governanceRoleMembers({...facts,roles:[{...facts.roles[0],count:{status:'success',value:'51'},members:Array.from({length:50},()=>({status:'success',value:address}))}]},['DEFAULT_ADMIN_ROLE'],false,false);
  assert.equal(rows.DEFAULT_ADMIN_ROLE.members.length,50);assert.equal(rows.DEFAULT_ADMIN_ROLE.expectedCount,51);
});

test('unconfigured or failed roster does not invent members; existing address normalization skips zero',()=>{
  assert.equal(normalizeRoleAddress('0x'+'0'.repeat(40)),undefined);assert.equal(normalizeRoleAddress('invalid'),undefined);
  const rows=governanceRoleMembers({...facts,address:null},['DEFAULT_ADMIN_ROLE'],false,false);
  assert.equal(rows.DEFAULT_ADMIN_ROLE.isUnavailable,true);
  assert.deepEqual(governanceRoleMembers(undefined,['DEFAULT_ADMIN_ROLE'],false,true).DEFAULT_ADMIN_ROLE.members,[]);
});

test('provider failure remains an error without browser RPC fallback',async()=>{
  let calls=0;
  await assert.rejects(fetchGovernanceRoles('core',undefined,(async()=>{calls++;return Response.json({error:'unavailable'},{status:503});}) as typeof fetch),/temporarily unavailable/);
  assert.equal(calls,1);
});
