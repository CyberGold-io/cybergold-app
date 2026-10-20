import { routeBasketQuote } from "./fixtures/universal-exact-input";
import { selectBasket } from "./fixtures/swap-selection";
import { expect, test } from "./fixtures/app-test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { formatUnits } from "viem";
import { install, asset, context } from "./fixtures/token-quotes";
const state=JSON.parse(await readFile(new URL("./fixtures/basket-evaluation-state.json",import.meta.url),"utf8")) as NonNullable<import("../../app/utils/quoteModels").QuoteModelPacket["protocol"]>["state"];
if(!state) throw new Error("Captured Basket state is missing");
const other="0x00000000000000000000000000000000000000b3";
const aliases:Record<string,string>={basketAsset1:asset,basketAsset2:other};
const snapshot={...state,assets:state.assets.map(a=>aliases[a]),descriptors:state.descriptors.map(d=>({...d,token:aliases[d.token]??d.token}))};
const fixture=JSON.parse(await readFile(new URL("../../app/utils/fixtures/basket-model.json",import.meta.url),"utf8")) as {cases:{request:{mode:string;netCygldOut?:string;grossCygldIn?:string};actual:Record<string,unknown>}[]};
for(const mode of ["redeem-exact-in"]) for(const candidate of [false,true]) for(const index of [0,1,2]) {
 test(`${mode} ${index+1}: ${candidate?"cached-state model":"cold model cache"} Basket display`,async({page})=>{
  const row=fixture.cases.filter(c=>c.request.mode===mode)[index],amount=row.request.netCygldOut??row.request.grossCygldIn!;

  await install(page,"",undefined,false,[asset,other]);
  const success=<T,>(value:T)=>({status:"success",value});
  await page.route("**/api/protocol/facts",route=>route.fulfill({json:{context:{...context,blockTimestamp:"1790800000"},basketModel:candidate?{context,state:snapshot}:null,core:"0x00000000000000000000000000000000000000a1",helpers:"0x00000000000000000000000000000000000000b2",basket:{assets:success([asset,other]),targetsPpm:success(["600000","400000"]),goldRefGramsFp18:success(["31103476800000000000","31103476800000000000"]),cygldPerUnitFp18:success(["31103476800000000000","31103476800000000000000000000000"]),metadata:[{address:asset,decimals:success(18),name:success("First Gold"),symbol:success("PAXG")},{address:other,decimals:success(6),name:success("Second Gold"),symbol:success("GOLD2")}]},reference:success("2000000000000000000"),fees:{issuancePpm:success("1000"),helpersPpm:success("0")},pause:success(false)}}));
  let requests=0,completed=false;
  await routeBasketQuote(page,async route=>{requests++;await new Promise(r=>setTimeout(r,250));const result=JSON.parse(JSON.stringify(row.actual).replaceAll("basketAsset1",asset).replaceAll("basketAsset2",other));await route.fulfill({json:{mode,context,helpers:"0x00000000000000000000000000000000000000b2",result}});completed=true;});
  await page.goto("/en");await selectBasket(page);
  if(mode.startsWith("redeem"))await page.getByRole("button",{name:"Reverse swap direction"}).click();
  const input=page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first();
  const quoted=page.getByLabel("Buy amount (PAXG)", { exact: true });
  await input.click();const start=Date.now();await input.fill(formatUnits(BigInt(amount),18));
  await expect(quoted).toHaveJSProperty("tagName", "OUTPUT");
  await expect(quoted).toHaveText(/[1-9]/);const firstMs=Date.now()-start,first=(await quoted.textContent())!;
  const completionAtFirst=completed;await expect.poll(()=>completed).toBe(true);await page.waitForTimeout(50);
  const final=(await quoted.textContent())!;expect(first).toBe(final);expect(requests).toBe(1);expect(completionAtFirst).toBe(!candidate);
  const result={mode,index:index+1,candidate,firstMs,completedAtFirst:completionAtFirst,first,final,requests,snapshotBytes:JSON.stringify(snapshot).length,scope:"Already-paid integer state delivered through the normal facts response; unchanged state, controlled 250ms Helpers. No cold acquisition, execution qualification or extra RPC saving is inferred."};
  await test.info().attach("warm-basket-display",{contentType:"application/json",body:JSON.stringify(result)});
  if(process.env.QUOTE_EVALUATION_DIR){await mkdir(process.env.QUOTE_EVALUATION_DIR,{recursive:true});await writeFile(`${process.env.QUOTE_EVALUATION_DIR}/basket-model-${mode}-${candidate}-${index}.json`,JSON.stringify(result,null,2));}
 });
}
