import { expect, test, type Page, type Route } from "./fixtures/app-test";
import { choose, install } from "./fixtures/token-quotes";
import { coreIntentRequest } from "./fixtures/trade-core";
import { intentFixture } from "./fixtures/quote-intent";
import { universalFromCoreQuote } from "./fixtures/universal-exact-input";
import type { UniversalExactInputRequest } from "../../app/utils/universalExactInput";

// Universal execution uses one complete JSON plan. Indicative model responses
// remain separate; historical provider NDJSON frames cannot become executable.
async function controlled(page: Page, advisory = true) {
  await install(page, "", undefined, false, undefined, undefined, undefined, advisory);
  const pending: { route: Route; input: UniversalExactInputRequest }[] = [];
  const failed: string[] = [];
  page.on("requestfailed", request => {
    if (new URL(request.url()).pathname === "/api/economic-quotes") failed.push(request.postData()!);
  });
  await page.route("**/api/economic-quotes", route => { pending.push({ route, input: route.request().postDataJSON() }); });
  const complete = async (phase: "first" | "better" = "first", index = pending.length - 1) => {
    const { route, input } = pending[index];
    const value = intentFixture(coreIntentRequest({ ...input, side: input.intent === 0 ? "buy" : "sell", mode: "exact-in",
      counterToken: input.intent === 0 ? input.inputs[0].currency : input.outputCurrency,
      native: false, amount: input.inputs[0].amount }), phase);
    await route.fulfill({ json: universalFromCoreQuote(input, value) });
  };
  return { pending, failed, complete, fail: () => pending.at(-1)!.route.fulfill({ status:503,json:{code:"quote-unavailable"} }) };
}
async function visible(page: Page, value: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, "hidden", { configurable:true,get:()=>!value });
    Object.defineProperty(document, "visibilityState", { configurable:true,get:()=>value?"visible":"hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  },value);
}
for(const symbol of ["WETH","ETH","USDC"] as const) for(const side of ["buy","sell"] as const) {
  test(`${symbol} ${side}: advisory amount is replaced by one complete universal plan`,async({page})=>{
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
    await expect(page.getByTestId("exact-input-retention-disclosure")).toBeVisible();
  });
}
test("an errored universal quote removes its provisional amount",async({page})=>{
  const fixture=await controlled(page);await page.goto("/en");await choose(page,"WETH");
  await page.locator("#sell-amount").fill("1");await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);await fixture.fail();
  await expect(page.getByTestId("quote-estimate-description")).not.toBeAttached();
  await expect(page.locator("#buy-amount")).toHaveText("...");
  await expect(page.getByText("The quote service could not process this request. Retry.",{exact:true}).first()).toBeVisible();
});
test("editing cancels the previous universal request before the replacement debounce",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");
  await page.locator("#sell-amount").fill("1");await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);
  await page.clock.install();const now=await page.evaluate(()=>Date.now());await page.clock.pauseAt(new Date(now+1000));
  const before=fixture.pending.length;await page.locator("#sell-amount").fill("2");
  await expect.poll(()=>fixture.failed.length).toBeGreaterThan(0);expect(fixture.pending.length).toBe(before);
  await expect(page.locator("#buy-amount")).toHaveText("...");
  await page.clock.runFor(100);await expect.poll(()=>fixture.pending.length).toBe(before+1);
  expect(fixture.pending.at(-1)!.input.inputs[0].amount).toBe("2000000000000000000");
  await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("2");
});
test("an expired universal plan renews under the ordinary quote deadline",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");await page.clock.install();
  await page.locator("#sell-amount").fill("1");await page.clock.runFor(250);
  await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("1");
  const before=fixture.pending.length;await page.clock.fastForward(601000);
  await expect.poll(()=>fixture.pending.length).toBeGreaterThan(before);
  const now=await page.evaluate(()=>Math.floor(Date.now()/1000));expect(Number(fixture.pending.at(-1)!.input.deadline)).toBeGreaterThan(now);
  await fixture.complete("better");await expect(page.locator("#buy-amount")).toHaveText("2");
});
test("a new intent after clearing an idle form gets a fresh deadline",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");await page.clock.install();
  const input=page.locator("#sell-amount");await input.fill("1");await page.clock.runFor(250);
  await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("1");
  await input.fill("");await page.clock.fastForward(601000);await input.fill("2");await page.clock.runFor(250);
  await expect.poll(()=>fixture.pending.at(-1)!.input.inputs[0].amount).toBe("2000000000000000000");
  const now=await page.evaluate(()=>Math.floor(Date.now()/1000)),deadline=Number(fixture.pending.at(-1)!.input.deadline);
  expect(deadline).toBeGreaterThan(now);expect(deadline-now).toBeLessThanOrEqual(600);
  await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("2");
});
test("hidden tabs cancel pending universal requests and renew only when visible",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");await page.clock.install();
  await page.locator("#sell-amount").fill("1");await page.clock.runFor(250);await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);
  const before=fixture.pending.length;await visible(page,false);await expect.poll(()=>fixture.failed.length).toBeGreaterThan(0);
  await page.clock.fastForward(601000);expect(fixture.pending.length).toBe(before);
  await visible(page,true);await page.clock.runFor(250);await expect.poll(()=>fixture.pending.length).toBeGreaterThan(before);
  const now=await page.evaluate(()=>Math.floor(Date.now()/1000));expect(Number(fixture.pending.at(-1)!.input.deadline)).toBeGreaterThan(now);
  await fixture.complete();await expect(page.locator("#buy-amount")).toHaveText("1");
});
test("an initially hidden page defers its first universal quote",async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});});
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");await page.clock.install();
  await page.locator("#sell-amount").fill("1");await page.clock.runFor(1000);expect(fixture.pending).toHaveLength(0);
  await visible(page,true);await page.clock.runFor(250);await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);
});
test("token selection and reversal clear a pending universal intent",async({page})=>{
  const fixture=await controlled(page,false);await page.goto("/en");await choose(page,"WETH");
  await page.locator("#sell-amount").fill("1");await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);
  await page.getByRole("button",{name:"WETH WETH",exact:true}).click();await page.getByPlaceholder("Search currency...").fill("USDC");
  await page.locator("#dropdown-from").getByRole("button").filter({has:page.getByText("USDC",{exact:true})}).click();
  await expect.poll(()=>fixture.failed.length).toBeGreaterThan(0);await expect(page.locator("#sell-amount")).toHaveValue("");
  await page.locator("#sell-amount").fill("1");await expect.poll(()=>fixture.pending.at(-1)?.input.inputs[0].amount).toBe("1000000");
  await page.getByRole("button",{name:"Reverse swap direction"}).click();await expect(page.locator("#sell-amount")).toHaveValue("");
  await page.locator("#sell-amount").fill("3");await expect.poll(()=>fixture.pending.at(-1)?.input.intent).toBe(1);
  expect(fixture.pending.at(-1)!.input.inputs[0].amount).toBe("3000000000000000000");
});
for(const width of [1280,390])test(`${width}px universal output and fiat equivalents update together`,async({page})=>{
  await page.setViewportSize({width,height:900});const fixture=await controlled(page);
  await page.goto("/en");await choose(page,"USDC");await page.locator("#sell-amount").fill("1");
  const output=page.locator("#buy-amount"),equivalent=page.getByTestId("buy-amount-equivalents").filter({visible:true});
  await expect(output).toHaveText("1");await expect(equivalent).toContainText("200");
  await expect.poll(()=>fixture.pending.length).toBeGreaterThan(0);await fixture.complete("better");
  await expect(output).toHaveText("2");await expect(equivalent).toContainText("400");
  await page.locator("#sell-amount").fill("");await expect(output).toHaveText(/^0(?:[.,]0+)?$/);await expect(equivalent).not.toContainText("400");
});
