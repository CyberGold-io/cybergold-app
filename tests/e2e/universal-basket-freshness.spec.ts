import { expect, test } from "./fixtures/app-test";
import { install } from "./fixtures/token-quotes";
import { selectBasket } from "./fixtures/swap-selection";
import type { EconomicRequest } from "../../app/utils/economicQuotes";

for (const intent of [2, 3]) test(`basket intent ${intent} retains its economic observation until explicit Refresh`, async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  if (intent === 3) await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await selectBasket(page, intent === 3 ? "buy" : "sell");
  await page.clock.install();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance):visible').first().fill("1");
  await page.clock.runFor(250);
  await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
  const requests = () => (observed.rawIntents as (EconomicRequest & { refresh?: boolean })[]).filter(row => row.intent === intent);
  await expect.poll(() => requests().length).toBe(1);
  const initial = requests()[0];
  expect(initial).not.toHaveProperty('deadline');
  expect(initial).not.toHaveProperty('recipient');
  await page.clock.fastForward(601_000);
  expect(requests()).toHaveLength(1);
  await page.locator('[data-trade-refresh]').click();
  await expect.poll(() => requests().length).toBe(2);
  const renewed = requests().at(-1)!;
  expect(renewed.inputs).toEqual(initial.inputs);
  expect(renewed.refresh).toBe(true);
  expect(renewed).not.toHaveProperty('deadline');
  await expect(page.locator("#swapsection")).toHaveAttribute("data-trade-evaluation", "confirmed");
});
