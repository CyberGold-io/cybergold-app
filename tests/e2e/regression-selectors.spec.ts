import { expect, test } from "./fixtures/app-test";
import { install as installTokens } from "./fixtures/token-quotes";
import { install as installBasket } from "./fixtures/basket-quotes";
import { ensureBasketInputEditable, getMainInput, getTokenButton, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";
import { installQuoteObservation, quoteObservations } from "../trading/quoteObservation";

test("regression helpers select tokens and preserve input-driven quotes on the current App DOM", async ({ page }) => {
  await page.addInitScript(installQuoteObservation as () => void);
  const observed = await installTokens(page);
  await page.goto("/en");
  await showAllSellTokens(page);
  await selectToken(page, "sell", "USDC");
  await selectToken(page, "buy", "CYGLD");
  await expect(getTokenButton(page, "sell", "USDC")).toBeVisible();
  await getMainInput(page, "sell").fill("1");
  await expect(getMainInput(page, "buy")).toHaveText("1");
  await getMainInput(page, "buy").click();
  await expect(getMainInput(page, "buy")).toHaveJSProperty("tagName", "OUTPUT");
  await expect(getMainInput(page, "sell")).toHaveValue("1");
  await expect.poll(async () => (await quoteObservations(page)).some(row => row.request.intent === 0
    && (row.request.inputs as {amount:string}[])[0].amount === "1000000" && row.terminal?.type === "complete")).toBe(true);
  expect(observed.intents.every(request => request.mode === "issue-exact-in")).toBe(true);
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await expect(getMainInput(page, "sell")).toHaveValue("");
  await expect(getMainInput(page, "buy")).toHaveText(/^0(?:[.,]0+)?$/);
  await selectToken(page, "buy", "ETH");
  await expect(getTokenButton(page, "sell", "CYGLD")).toBeVisible();
  await expect(getTokenButton(page, "buy", "ETH")).toBeVisible();
});

test("regression token picker stays selectable after an input-driven basket quote", async ({ page }) => {
  await installBasket(page);
  await page.goto("/en");
  await selectToken(page, "sell", "BASKET");
  await (await ensureBasketInputEditable(page, "sell")).fill("2");
  await expect(getMainInput(page, "buy")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
  await expect(getTokenButton(page, "sell", "BASKET")).toBeVisible();
  await selectToken(page, "sell", "PAXG");
  await expect(getMainInput(page, "sell")).toBeVisible();
  await expect(getTokenButton(page, "sell", "PAXG")).toBeVisible();
});

test("regression basket output remains a read-only estimate when focused or clicked", async ({ page }) => {
  const observed = await installBasket(page);
  await page.goto("/en");
  await selectToken(page, "sell", "CYGLD");
  await selectToken(page, "buy", "BASKET");
  await getMainInput(page, "sell").fill("1");
  const output = page.getByRole("status", { name: "Buy amount (PAXG)", exact: true });
  await expect(output).toHaveText("1");
  await output.focus(); await expect(output).not.toBeFocused(); await output.click();
  await expect(output).toHaveJSProperty("tagName", "OUTPUT");
  await expect(getMainInput(page, "sell")).toHaveValue("1");
  expect(observed.timings.filter(row => row.mode.startsWith("redeem")).every(row => row.mode === "redeem-exact-in")).toBe(true);
});
