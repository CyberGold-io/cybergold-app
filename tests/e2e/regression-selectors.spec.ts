import { expect, test } from "./fixtures/app-test";
import { install as installTokens } from "./fixtures/token-quotes";
import { install as installBasket } from "./fixtures/basket-quotes";
import { ensureBasketInputEditable, getMainInput, getTokenButton, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";
import { installQuoteObservation, quoteObservations } from "../trading/quoteObservation";

test("regression helpers select tokens and both amount modes on the current App DOM", async ({ page }) => {
  await page.addInitScript(installQuoteObservation as () => void);
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
  await expect.poll(async () => (await quoteObservations(page)).some(row => row.request.mode === "exact-out"
    && row.request.amount === "2000000000000000000" && row.terminal?.type === "complete")).toBe(true);
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

test("regression basket output switches from a quoted button to the exact-out driver", async ({ page }) => {
  const observed = await installBasket(page);
  await page.goto("/en");
  await selectToken(page, "sell", "CYGLD");
  await selectToken(page, "buy", "BASKET");
  await getMainInput(page, "sell").fill("1");
  await expect(page.getByRole("button", { name: "Edit buy amount (PAXG)", exact: true })).toHaveText("1");
  const input = await ensureBasketInputEditable(page, "buy");
  await input.fill("0.002");
  await expect.poll(() => observed.timings.some(row => row.mode === "redeem-exact-out"
    && (row.request as { minimumOutputs: { minimumAmount: string }[] }).minimumOutputs[0].minimumAmount === "2000000000000000")).toBe(true);
  await expect(getMainInput(page, "sell")).toHaveValue("1");
});
