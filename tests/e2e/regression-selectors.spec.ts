import { expect, test, type Page } from "./fixtures/app-test";
import { install as installTokens } from "./fixtures/token-quotes";
import { install as installBasket } from "./fixtures/basket-quotes";
import { ensureBasketInputEditable, getMainInput, getTokenButton, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";
import { installQuoteObservation, quoteObservations } from "../trading/quoteObservation";
import { browserQuoteMatcher } from "../trading/browserQuoteObservation";
import { applyEconomicQuote, resultFor } from "../trading/regression";
import { tradeScenarios, type Scenario } from "../trading/scenarios";
import { protocolConfigurationFixture, tokenAddresses } from "../fixtures/protocol-configuration";
import type { EconomicQuote, EconomicRequest } from "../../app/utils/economicQuotes";

/** Qualify the request/response emitted by the real UI with the deployed runner's reader. */
async function checkEconomicObservation(page: Page, scenario: Scenario, basketAmount = "0", assets: readonly string[] = []) {
  const matches = browserQuoteMatcher(scenario, protocolConfigurationFixture, basketAmount, assets);
  await expect.poll(async () => (await quoteObservations(page)).some(row => matches(row) && row.terminal?.type === "complete")).toBe(true);
  const observation = (await quoteObservations(page)).find(row => matches(row) && row.terminal?.type === "complete")!;
  expect(observation.path).toBe("/api/economic-quotes/stream");
  const result = resultFor(scenario, "browser");
  applyEconomicQuote(result, observation.terminal!.value as EconomicQuote, observation.request as EconomicRequest);
  expect(result.quotedOperation).toBe("executeExactInput");
  expect(result.selectedProvider).toBe("universal");
  expect(result.providers).toBeUndefined();
  expect(result.planDigest).toMatch(/^[a-f0-9]{64}$/);
  return result;
}
const scenarioFor = (asset: Scenario["asset"], side: Scenario["side"], displayAmount: string): Scenario => ({
  ...tradeScenarios.find(row => row.asset === asset && row.side === side && row.inputMode === "exact-in" && row.requestedStrategy === "core")!, displayAmount,
});

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
  const purchase = await checkEconomicObservation(page, scenarioFor("USDC", "buy", "1"));
  expect(purchase.bounds!.inputMaximum).toBe("1000000");
  expect(observed.intents.every(request => request.mode === "issue-exact-in")).toBe(true);
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await expect(getMainInput(page, "sell")).toHaveValue("");
  await expect(getMainInput(page, "buy")).toHaveText(/^0(?:[.,]0+)?$/);
  await selectToken(page, "buy", "ETH");
  await expect(getTokenButton(page, "sell", "CYGLD")).toBeVisible();
  await expect(getTokenButton(page, "buy", "ETH")).toBeVisible();
  await getMainInput(page, "sell").fill("1");
  const sale = await checkEconomicObservation(page, scenarioFor("ETH", "sell", "1"));
  expect(sale.bounds!.inputMaximum).toBe("1000000000000000000");
});

test("regression token picker stays selectable after an input-driven basket quote", async ({ page }) => {
  await page.addInitScript(installQuoteObservation as () => void);
  await installBasket(page);
  await page.goto("/en");
  await selectToken(page, "sell", "BASKET");
  await (await ensureBasketInputEditable(page, "sell")).fill("2");
  await expect(getMainInput(page, "buy")).not.toHaveText(/^(?:0(?:[.,]0+)?|\.\.\.)?$/);
  await expect(getTokenButton(page, "sell", "BASKET")).toBeVisible();
  const issued = await checkEconomicObservation(page, scenarioFor("BASKET", "buy", "2"), "2000000000000000000", [tokenAddresses.PAXG]);
  expect(issued.bounds!.inputMaximum).toBe("2000000000000000000");
  await selectToken(page, "sell", "PAXG");
  await expect(getMainInput(page, "sell")).toBeVisible();
  await expect(getTokenButton(page, "sell", "PAXG")).toBeVisible();
});

test("regression basket output remains a read-only estimate when focused or clicked", async ({ page }) => {
  await page.addInitScript(installQuoteObservation as () => void);
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
  const redeemed = await checkEconomicObservation(page, scenarioFor("BASKET", "sell", "1"), "1000000000000000000", [tokenAddresses.PAXG]);
  expect(redeemed.bounds!.outputMinimum).toBeUndefined();
  expect(redeemed.quoteTerms!.netOutput?.map(row => row.amount)).toEqual(["1000000000000000000"]);
  await expect(page.getByTestId("swap-minimum-output")).toContainText("0.99 PAXG");
  expect(observed.timings.filter(row => row.mode.startsWith("redeem")).every(row => row.mode === "redeem-exact-in")).toBe(true);
});
