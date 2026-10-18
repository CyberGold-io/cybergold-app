import { expect, test } from "./fixtures/app-test";
import { choose, install } from "./fixtures/token-quotes";

test("an expired exact quote can be edited without notifying React during render", async ({ page }) => {
  const renderErrors: string[] = [], pageErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /Cannot update a component.*while rendering a different component/.test(message.text())) {
      renderErrors.push(message.text());
    }
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  const observed = await install(page);
  await page.clock.install();
  await page.goto("/en");
  await choose(page, "WETH");
  const edited = page.locator("#sell-amount"), quoted = page.locator("#buy-amount");
  await edited.fill("1");
  await expect(quoted).toHaveValue("1");
  await expect(quoted).toBeEnabled();
  await edited.fill("2");
  await expect(quoted).toHaveValue("2");
  await expect(quoted).toBeEnabled();
  await expect.poll(() => observed.intents.length).toBe(2);

  const pausedAt = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(pausedAt + 1_000));
  await edited.fill("1");
  await expect.poll(async () => { await page.clock.runFor(0); return quoted.inputValue(); }).toBe("1");
  await expect(quoted).toBeEnabled();
  expect(observed.intents).toHaveLength(2);

  // Expire the current external-store snapshot without running timers or cache
  // notifications first. The next render creates a query for the edited amount.
  await page.clock.setSystemTime(new Date(pausedAt + 12_000));
  await edited.fill("3");
  await page.clock.runFor(150);
  await expect.poll(async () => { await page.clock.runFor(0); return quoted.inputValue(); }).toBe("3");
  await expect(quoted).toBeEnabled();
  await expect.poll(() => observed.intents.length).toBe(3);
  expect(observed.intents.at(-1)?.amount).toBe("3000000000000000000");
  expect(renderErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
