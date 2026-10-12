import { expect, test } from "./fixtures/app-test";
import { install as installTokens } from "./fixtures/token-quotes";
import { install as installBasket } from "./fixtures/basket-quotes";
import { getMainInput, getTokenButton, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";

test("regression helpers select tokens and both amount modes on the current App DOM", async ({ page }) => {
  const observed = await installTokens(page);
  await page.goto("/en");
  await showAllSellTokens(page);
  await selectToken(page, "sell", "USDC");
  await selectToken(page, "buy", "CYGLD");
  await expect(getTokenButton(page, "sell", "USDC")).toBeVisible();
  await getMainInput(page, "sell").fill("1");
  await expect(getMainInput(page, "buy")).toHaveValue("1");
  await getMainInput(page, "buy").click(); await getMainInput(page, "buy").fill("2");
  await expect.poll(() => observed.intents.map(request => request.mode)).toContain("issue-exact-out");
  await expect(getMainInput(page, "sell")).toHaveValue("2");
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await selectToken(page, "buy", "ETH");
  await expect(getTokenButton(page, "sell", "CYGLD")).toBeVisible();
  await expect(getTokenButton(page, "buy", "ETH")).toBeVisible();
});

test("regression token picker stays selectable when the opposite side is a quoted basket", async ({ page }) => {
  await installBasket(page);
  await page.goto("/en");
  await selectToken(page, "sell", "BASKET");
  await getMainInput(page, "buy").click(); await getMainInput(page, "buy").fill("2");
  await expect(page.locator("#sell-basket-composition")).toBeVisible();
  await expect(getTokenButton(page, "sell", "BASKET")).toBeVisible();
  await selectToken(page, "sell", "PAXG");
  await expect(getMainInput(page, "sell")).toBeVisible();
  await expect(getTokenButton(page, "sell", "PAXG")).toBeVisible();
});
