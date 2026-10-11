import { expect, test, type Page } from './fixtures/app-test';
import { encodeFunctionData, parseAbi } from 'viem';
import type { ProtocolFacts } from '../../app/utils/protocolFacts';

const success=<T,>(value:T)=>({status:'success' as const,value});
const failure={status:'failure' as const,error:'contract-read-failed' as const};
const selectors=new Set(['basketAssets','basketTargetsPpm','basketGoldRefGramsFp18','basketCygldPerUnitFp18','cygldRefGramsFp18','issuanceFeePpm','paused','helperFeePpm'].map(name=>encodeFunctionData({abi:parseAbi([`function ${name}() view returns (uint256)`]),functionName:name}).slice(0,10)));
function payload():ProtocolFacts{const asset='0x45804880de22913dafe09f4980848ece6ecbaf78';return {context:{chainId:31337,blockNumber:'100',blockHash:`0x${'a'.repeat(64)}`,blockTimestamp:'1790800000',observedAt:'2026-10-01T00:00:00Z'},core:'0x00000000000000000000000000000000000000a1',helpers:'0x00000000000000000000000000000000000000b2',basket:{assets:success([asset]),targetsPpm:success(['1000000']),goldRefGramsFp18:success(['31103476800000000000']),cygldPerUnitFp18:success(['15551738400000000000']),metadata:[{address:asset,decimals:success(18),name:success('PAX Gold'),symbol:success('PAXG')}]},reference:success('2000000000000000000'),fees:{issuancePpm:success('1000'),helpersPpm:success('1000')},pause:success(false)};}
async function install(page:Page,mode:'success'|'partial'|'empty'|'unavailable'){
 const attempted:string[]=[];let factsRequests=0;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/protocol/config'){await route.fallback();return;}
  if(url.pathname==='/api/protocol/facts'){
   factsRequests++;const facts=payload();
   if(mode==='partial')facts.basket.targetsPpm=failure;
   if(mode==='empty'){facts.basket.assets=success([]);facts.basket.targetsPpm=success([]);facts.basket.goldRefGramsFp18=success([]);facts.basket.cygldPerUnitFp18=success([]);facts.basket.metadata=[];}
   await route.fulfill(mode==='unavailable'?{status:503,json:{error:'Protocol facts are temporarily unavailable.'}}:{json:facts});
  }else if(url.pathname==='/api/gold')await route.fulfill({json:{price:3110.34768,fetchedAt:new Date().toISOString(),stale:false}});
  else if(url.pathname==='/api/fx')await route.fulfill({json:{base:'USD',rates:{EUR:.9},fetchedAt:new Date().toISOString(),stale:false}});
  else if(url.pathname==='/api/rpc'){
   expect(url.pathname).not.toBe('/api/rpc');await route.continue();
  }else await route.fulfill({status:503,json:{error:'Unrelated fixture data unavailable'}});
 });
 return {attempted,count:()=>factsRequests};
}

test('Swap reads its basket, reference, fees and pause from one focused query',async({page})=>{
 const observed=await install(page,'success');await page.goto('/en');
 await expect(page.getByText('You Sell',{exact:true})).toBeVisible();
 // Next.js development Strict Mode can cancel the first mount's query.
 // The shared mounted observers must not each initiate their own request.
 await expect.poll(observed.count).toBeGreaterThanOrEqual(1);
 expect(observed.count()).toBeLessThanOrEqual(2);
 await expect(page.getByText('Basket data unavailable',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Connect Wallet',exact:true}).first().click();
 await expect(page.getByText('Connect a Wallet',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 expect(observed.attempted.filter(selector=>selectors.has(selector))).toEqual([]);
});
test('partial basket read failures report availability, not a missing Core',async({page})=>{
 const observed=await install(page,'partial');await page.goto('/en');
 await expect(page.getByText('Basket data unavailable',{exact:true})).toBeVisible();
 await expect(page.getByText('Basket data could not be loaded. Try again later.',{exact:true})).toBeVisible();
 await expect(page.getByText('Check NEXT_PUBLIC_CORE_DIAMOND_ADDRESS',{exact:false})).toHaveCount(0);
 expect(observed.attempted.filter(selector=>selectors.has(selector))).toEqual([]);
});
test('facts outage displays the existing error and never retries it through browser RPC',async({page})=>{
 const observed=await install(page,'unavailable');await page.goto('/en');
 await expect(page.getByText('Basket data unavailable',{exact:true})).toBeVisible({timeout:15_000});
 await expect(page.getByText('Basket data could not be loaded. Try again later.',{exact:true})).toBeVisible();
 expect(observed.attempted.filter(selector=>selectors.has(selector))).toEqual([]);
});

test('a successful empty basket remains distinct from a failed read',async({page})=>{
 await install(page,'empty');await page.goto('/en');
 await expect(page.getByText("The basket is currently unavailable. Choose another token or try again later.",{exact:true})).toBeVisible();
 await expect(page.getByText('Basket data could not be loaded.',{exact:false})).toHaveCount(0);
});
