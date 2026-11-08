import { expect, test, type Page, type Route } from "./fixtures/app-test";
import { choose, install } from "./fixtures/token-quotes";
import { coreIntentRequest } from "./fixtures/trade-core";
import { intentFixture } from "./fixtures/quote-intent";
import { tradeRequestFromUniversal, universalFromCoreQuote } from "./fixtures/universal-exact-input";
import type { UniversalExactInputRequest } from "../../app/utils/universalExactInput";

// Economic quotes contain one complete semantic plan. Indicative estimates
// remain separate; execution bytes are prepared only after the Swap click.
async function controlled(page: Page, advisory = true) {
  await install(page, "", undefined, false, undefined, undefined, undefined, advisory);
  const pending: { route: Route; input: UniversalExactInputRequest }[] = [];
  await page.route("**/api/economic-quotes", route => { pending.push({ route, input: route.request().postDataJSON() }); });
  const complete = async (phase: "first" | "better" = "first", index = pending.length - 1) => {
    const { route, input } = pending[index];
    const value = intentFixture(coreIntentRequest(tradeRequestFromUniversal(input)), phase);
    await route.fulfill({ json: universalFromCoreQuote(input, value) });
  };
  return { pending, complete, fail: () => pending.at(-1)!.route.fulfill({ status:503,json:{code:"quote-unavailable"} }) };
}
async function visible(page: Page, value: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable:true,get:()=>!value });
    Object.defineProperty(document, "visibilityState", { configurable:true,get:()=>value?"visible":"hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  },value);
}
for(const symbol of ["WETH","ETH","USDC"] as const) for(const side of ["buy","sell"] as const) {
  test(`${symbol} ${side}: advisory amount is replaced by one complete economic quote`,async({page})=>{
    const fixture=await controlled(page);
    await page.goto("/en"); await choose(page,symbol);
    if(side==="sell")await page.getByRole("button",{name:"Reverse swap direction"}).click();
    await page.locator("#sell-amount").fill("1");
    const output=page.locator("#buy-amount"),description=page.getByTestId("quote-estimate-description");
    await expect(description).toBeAttached(); await expect(output).toHaveAttribute("aria-busy","true");
    await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);
    const before=Number(await output.textContent());expect(before).toBeGreaterThan(0);
    await fixture.complete("better");
    await expect(description).not.toBeAttached();await expect(output).not.toHaveAttribute("aria-busy","true");
    await expect.poll(async()=>Number(await output.textContent())).toBe(before*2);
    await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
  });
}
test("an errored economic quote removes its provisional amount",async({page})=>{
  const fixture=await controlled(page);await page.goto("/en");await choose(page,"WETH");
  await page.locator("#sell-amount").fill("1");await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);await fixture.fail();
  await expect(page.getByTestId("quote-estimate-description")).not.toBeAttached();
  await expect(page.locator("#buy-amount")).toHaveText("...");
  await expect(page.getByText("The quote service could not process this request. Retry.",{exact:true}).first()).toBeVisible();
});
test("an edited amount keeps a late response attached to its original request",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");
  await page.locator("#sell-amount").fill("1");await expect.poll(()=>fixture.pending.length).toBe(1);
  await page.locator("#sell-amount").fill("2");
  await expect(page.locator("#buy-amount")).toHaveText("...");
  await expect.poll(()=>fixture.pending.length).toBe(2);
  expect(fixture.pending[1].input.inputs[0].amount).toBe("2000000000000000000");
  await fixture.complete("better",1);await expect(page.locator("#buy-amount")).toHaveText("4");
  await fixture.complete("first",0);await expect(page.locator("#buy-amount")).toHaveText("4");
  expect(fixture.pending).toHaveLength(2);
});
test("elapsed time retains a measured quote until explicit Refresh",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");await page.clock.install();
  await page.locator("#sell-amount").fill("1");await page.clock.runFor(250);
  await expect.poll(()=>fixture.pending.length).toBe(1);await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("1");
  await page.clock.fastForward(601000);expect(fixture.pending).toHaveLength(1);
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await page.locator("[data-trade-refresh]").click();await expect.poll(()=>fixture.pending.length).toBe(2);
  expect(fixture.pending[1].input).toMatchObject({refresh:true});
  expect(fixture.pending[1].input).not.toHaveProperty("deadline");
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await fixture.complete("better");await expect(page.locator("#buy-amount")).toHaveText("2");
});
test("a new input after clearing an idle form has economic fields only",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");await page.clock.install();
  const input=page.locator("#sell-amount");await input.fill("1");await page.clock.runFor(250);
  await expect.poll(()=>fixture.pending.length).toBe(1);await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("1");
  await input.fill("");await page.clock.fastForward(601000);await input.fill("2");await page.clock.runFor(250);
  await expect.poll(()=>fixture.pending.at(-1)!.input.inputs[0].amount).toBe("2000000000000000000");
  for(const name of ["deadline","recipient","slippageBps"])expect(fixture.pending.at(-1)!.input).not.toHaveProperty(name);
  await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("2");
});
test("visibility cancels an unfinished search, resumes it once, and retains its completed observation",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");await page.clock.install();
  await page.locator("#sell-amount").fill("1");await page.clock.runFor(250);await expect.poll(()=>fixture.pending.length).toBe(1);
  await visible(page,false);await page.clock.fastForward(601000);expect(fixture.pending).toHaveLength(1);
  await fixture.complete("first",0);await expect(page.locator("#buy-amount")).toHaveText("...");
  await visible(page,true);await page.clock.runFor(250);await expect.poll(()=>fixture.pending.length).toBe(2);
  expect(fixture.pending[1].input.inputs[0].amount).toBe("1000000000000000000");
  for(const name of ["deadline","recipient","slippageBps"])expect(fixture.pending[1].input).not.toHaveProperty(name);
  await fixture.complete("first",1);await expect(page.locator("#buy-amount")).toHaveText("1");
  await visible(page,false);await page.clock.fastForward(601000);await visible(page,true);await page.clock.runFor(250);
  expect(fixture.pending).toHaveLength(2);await expect(page.locator("#buy-amount")).toHaveText("1");
});
test("hidden input edits wait for visibility and acquire only the latest intent once",async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});});
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");await page.clock.install();
  await page.locator("#sell-amount").fill("1");await page.clock.runFor(250);
  await page.locator("#sell-amount").fill("2");await page.clock.fastForward(601000);expect(fixture.pending).toHaveLength(0);
  await visible(page,true);await page.clock.runFor(250);await expect.poll(()=>fixture.pending.length).toBe(1);
  expect(fixture.pending[0].input.inputs[0].amount).toBe("2000000000000000000");
  for(const name of ["deadline","recipient","slippageBps"])expect(fixture.pending[0].input).not.toHaveProperty(name);
  await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("2");
  await visible(page,false);await page.clock.fastForward(601000);await visible(page,true);await page.clock.runFor(250);
  expect(fixture.pending).toHaveLength(1);await expect(page.locator("#buy-amount")).toHaveText("2");
});
test("token selection and reversal clear the previous economic intent",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");
  await page.locator("#sell-amount").fill("1");await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);
  await page.getByRole("button",{name:"WETH WETH",exact:true}).click();await page.getByPlaceholder("Search currency...").fill("USDC");
  await page.locator("#dropdown-from").getByRole("button").filter({has:page.getByText("USDC",{exact:true})}).click();
  await expect(page.locator("#sell-amount")).toHaveValue("");
  await page.locator("#sell-amount").fill("1");await expect.poll(()=>fixture.pending.at(-1)?.input.inputs[0].amount).toBe("1000000");
  await page.getByRole("button",{name:"Reverse swap direction"}).click();await expect(page.locator("#sell-amount")).toHaveValue("");
  await page.locator("#sell-amount").fill("3");await expect.poll(()=>fixture.pending.at(-1)?.input.intent).toBe(1);
  expect(fixture.pending.at(-1)!.input.inputs[0].amount).toBe("3000000000000000000");
});
for(const width of [1280,390])test(`${width}px quoted output and fiat equivalents update together`,async({page})=>{
  await page.setViewportSize({width,height:900});const fixture=await controlled(page);
  await page.goto("/en");await choose(page,"USDC");await page.locator("#sell-amount").fill("1");
  const output=page.locator("#buy-amount"),equivalent=page.getByTestId("buy-amount-equivalents").filter({visible:true});
  await expect(output).toHaveText("1");await expect(equivalent).toContainText("200");
  await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);await fixture.complete("better");
  await expect(output).toHaveText("2");await expect(equivalent).toContainText("400");
  await page.locator("#sell-amount").fill("");await expect(output).toHaveText(/^0(?:[.,]0+)?$/);await expect(equivalent).not.toContainText("400");
});
