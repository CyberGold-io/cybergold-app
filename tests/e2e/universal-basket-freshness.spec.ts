import { expect, test } from "./fixtures/app-test";
import { install } from "./fixtures/token-quotes";
import { selectBasket } from "./fixtures/swap-selection";
import type { UniversalExactInputRequest } from "../../app/utils/universalExactInput";

for (const intent of [2, 3]) test(`basket intent ${intent} renews complete executable bytes at their ordinary deadline`, async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  if (intent === 3) await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await selectBasket(page, intent === 3 ? "buy" : "sell");
  await page.clock.install();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await page.clock.runFor(250);
  await expect(page.getByTestId("exact-input-retention-disclosure")).toBeVisible();
  const requests = () => (observed.rawIntents as UniversalExactInputRequest[]).filter(row => row.intent === intent);
  await expect.poll(() => requests().length).toBe(1);
  const initial = requests()[0];
  await page.clock.fastForward(601_000);
  await expect.poll(() => requests().length).toBe(2);
  const renewed = requests().at(-1)!;
  expect(renewed.inputs).toEqual(initial.inputs);
  const now = await page.evaluate(() => Math.floor(Date.now() / 1000));
  expect(Number(renewed.deadline)).toBeGreaterThan(now);
  expect(Number(renewed.deadline) - now).toBeLessThanOrEqual(600);
  await expect(page.getByTestId("exact-input-retention-disclosure")).toBeVisible();
});
