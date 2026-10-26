import { expect, test } from "./fixtures/app-test";
import { install } from "./fixtures/basket-quotes";
import { selectBasket } from "./fixtures/swap-selection";

test("basket input changes quote once; visibility and elapsed time do not refetch", async ({ page }) => {
  await install(page);
  await page.goto("/en"); await selectBasket(page);
  await page.clock.install();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  let quotes = 0;
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/economic-quotes") quotes++; });
  await page.getByRole("textbox", { name: "Sell amount (PAXG)", exact: true }).fill("1");
  await page.clock.runFor(250);
  await expect.poll(() => quotes).toBe(1);
  await expect(page.getByRole("status", { name: "You Buy CYGLD", exact: true })).toHaveText("1");
  await page.clock.fastForward(601_000);
  expect(quotes).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByRole("status", { name: "You Buy CYGLD", exact: true })).toHaveText("1");
  expect(quotes).toBe(1);
});
