import { expect, test } from "./fixtures/app-test";
import { install, choose } from "./fixtures/token-quotes";
import { universalFixture } from "./fixtures/universal-exact-input";

test("fee row stays visible and complete universal execution uses final net output fees", async ({ page }) => {
  await install(page,"",undefined,false,undefined,undefined,undefined,true);
  let release!:()=>void,requests=0;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route("**/api/quotes/universal-exact-input",async route=>{
    requests++;const request=route.request().postDataJSON();await pending;
    await route.fulfill({json:universalFixture(request,{quotedOutput:"3000000000000000000",coreProtocolFeeCygld:"1000000000000000"})});
  });
  await page.goto("/en");const feeRow=page.getByRole("button",{name:/Total fee/});
  await expect(feeRow).toBeVisible();await feeRow.click();await choose(page,"WETH");await page.locator("#sell-amount").fill("3");
  const output=page.locator("#buy-amount");await expect(output).toHaveText("3");await expect(output).toHaveAttribute("aria-busy","true");
  await expect.poll(()=>requests).toBe(1);release();
  await expect(output).not.toHaveAttribute("aria-busy","true");await expect(output).toHaveText("3");
  await expect(page.getByText(/^0\.001 CYGLD/)).toBeVisible();await expect(page.getByTestId("quote-estimate-description")).not.toBeAttached();
  await expect(page.getByTestId("exact-input-retention-disclosure")).toBeVisible();
  await page.locator("#sell-amount").fill("");await expect(output).toHaveText(/^0(?:[.,]0+)?$/);await expect(feeRow).toBeVisible();
});
