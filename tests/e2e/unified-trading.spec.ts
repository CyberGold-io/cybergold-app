import { expect, test, type Page } from "./fixtures/app-test";
import { installMarket, marketTradeFixture } from "./fixtures/market-quotes";
import { install } from "./fixtures/token-quotes";
import { coreIntentRequest, tradeFixture } from "./fixtures/trade-core";
import { intentFixture } from "./fixtures/quote-intent";

async function pickPaxg(page: Page) {
  await page.getByPlaceholder("Search currency...").fill("PAXG");
  await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText("PAXG", { exact: true }) }).click();
}

for (const action of ["click", "edit"] as const) test(`no selected input token: ${action} opens the picker and preserves entered amount`, async ({ page }) => {
  await installMarket(page); await page.goto("/en");
  await expect(page.getByPlaceholder("Search currency...")).toHaveCount(0);
  if (action === "click") await page.locator("#sell-amount").click();
  else await page.locator("#sell-amount").fill("2");
  await expect(page.getByPlaceholder("Search currency...")).toBeVisible();
  await pickPaxg(page);
  await page.locator("#sell-amount").fill("2");
  await expect(page.locator("#buy-amount")).toHaveValue("1.998");
});

test("dark token search uses readable foreground and placeholder colors", async ({ page }) => {
  await install(page); await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/en"); await expect(page.locator("html")).toHaveClass(/dark/);
  await page.locator("#sell-amount").click();
  const search = page.getByPlaceholder("Search currency..."); await search.fill("PAXG");
  const colors = await search.evaluate(input => {
    const style = getComputedStyle(input), placeholder = getComputedStyle(input, "::placeholder");
    return { foreground: style.color, background: style.backgroundColor, placeholder: placeholder.color };
  });
  expect(colors.foreground).not.toBe(colors.background);
  expect(colors.foreground).not.toMatch(/^rgba?\(0, 0, 0(?:, 1)?\)$/);
  expect(colors.placeholder).not.toBe(colors.background);
});

test("market front-end fee is distinct from Core Helpers fee, and tolerance only changes protection", async ({ page }) => {
  const observed = await installMarket(page);
  let release!: () => void, waiting = 0;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/quotes/trade/**", async route => {
    const request = route.request().postDataJSON();
    if (request.side === "buy" && request.mode === "exact-in" && request.slippageBps === 50) { waiting++; await delayed; }
    await route.fallback();
  });
  await page.goto("/en"); await page.locator("#sell-amount").click(); await pickPaxg(page);
  await page.locator("#sell-amount").fill("1"); await expect(page.locator("#buy-amount")).toHaveValue("0.999");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByText("Front-end fee (0.1%):", { exact: true })).toBeVisible();
  await expect(page.getByTestId("swap-helpers-fee").locator("span").last()).toHaveText("—");
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
  const before = (await page.getByTestId("swap-minimum-output").textContent())!;
  await page.locator("#execution-tolerance").fill("0.5");
  await expect.poll(() => waiting).toBeGreaterThan(0);
  await expect(page.locator("#buy-amount")).toHaveValue("0.999");
  await expect(page.locator("#buy-amount")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Front-end fee (0.1%):", { exact: true })).toBeVisible();
  await expect(page.getByTestId("swap-helpers-fee").locator("span").last()).toHaveText("—");
  await expect(page.getByTestId("swap-minimum-output")).toHaveText(before);
  release();
  await expect.poll(() => observed.requests.at(-1)?.slippageBps).toBe(50);
  await expect(page.locator("#buy-amount")).toHaveValue("0.999");
  await expect(page.getByTestId("swap-minimum-output")).not.toHaveText(before);

});

test("Core nominal redemption output is independent of its protective minimum", async ({ page }) => {
  await install(page);
  await page.route("**/api/quotes/trade/stream", async route => {
    const request = coreIntentRequest(route.request().postDataJSON()), base = intentFixture(request);
    const quote = { ...base, expectedOutputAmount: request.amount, displayAmount: "minimumAmountOut" in base.preview ? base.preview.minimumAmountOut ?? "0" : "0" };
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "complete", value: tradeFixture(quote, request) }) + "\n" });
  });
  await page.goto("/en"); await page.locator("#sell-amount").click(); await pickPaxg(page);
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await page.locator("#sell-amount").click(); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveValue("1");
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByText("Helpers fee (0%):", { exact: true })).toBeVisible();
  const before = (await page.getByTestId("swap-minimum-output").textContent())!;
  await page.locator("#execution-tolerance").fill("0.5");
  await expect(page.getByTestId("swap-minimum-output")).not.toHaveText(before);
  await expect(page.locator("#buy-amount")).toHaveValue("1");
});

test("a later selected Core plan replaces the complete market tuple without a strategy toggle", async ({ page }) => {
  await installMarket(page);
  await page.route("**/api/quotes/trade/stream", async route => {
    const request = route.request().postDataJSON(), coreRequest = coreIntentRequest(request), core = tradeFixture(intentFixture(coreRequest, "better"), coreRequest);
    await route.fulfill({ contentType: "application/x-ndjson", body: [
      { type: "qualified", value: marketTradeFixture(request) }, { type: "qualified", value: core },
      { type: "invalidated", strategy: "market" }, { type: "complete", value: core },
    ].map(value => JSON.stringify(value)).join("\n") + "\n" });
  });
  await page.goto("/en"); await page.locator("#sell-amount").click(); await pickPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
  await expect(page.locator("#buy-amount")).toHaveValue("2");
  await expect(page.getByRole("button", { name: "Liquidity swap", exact: true })).toHaveCount(0);
});

test("rapid tolerance edits retain nominal terms and start one settled competition", async ({ page }) => {
  const observed = await installMarket(page); await page.goto("/en");
  await page.locator("#sell-amount").click(); await pickPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveValue("0.999");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
  const before = observed.requests.length, originalBound = (await page.getByTestId("swap-minimum-output").textContent())!;
  // Slow CI assertions must not advance the debounce between burst edits.
  await page.clock.pauseAt(new Date());
  for (const value of ["0.5", "0.3", "0.7"]) {
    await page.locator("#execution-tolerance").fill(value);
    await page.clock.runFor(0);
    await expect(page.locator("#execution-tolerance")).toHaveValue(value);
    await expect(page.locator("#buy-amount")).toHaveValue("0.999");
    await expect(page.getByText("Front-end fee (0.1%):", { exact: true })).toBeVisible();
    await expect(page.getByTestId("swap-minimum-output")).toHaveText(originalBound);
  }
  expect(observed.requests).toHaveLength(before);
  await page.clock.runFor(150);
  await expect.poll(async () => { await page.clock.runFor(0); return observed.requests.length; }).toBe(before + 1);
  expect(observed.requests.at(-1)?.slippageBps).toBe(70);
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
  await expect(page.locator("#buy-amount")).toHaveValue("0.999");
});

for (const mode of ["exact-in"] as ("exact-in" | "exact-out")[]) test(`${mode}: tolerance refresh keeps amounts, fee colors and displayed bounds steady`, async ({ page }) => {
  await installMarket(page);
  let release!: () => void, waiting = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/quotes/trade/**", async route => {
    if (route.request().postDataJSON().slippageBps === 50) { waiting++; await held; }
    await route.fallback();
  });
  try {
    await page.goto("/en"); await page.locator("#sell-amount").click(); await pickPaxg(page);
    const driver = page.locator(mode === "exact-in" ? "#sell-amount" : "#buy-amount");
    await driver.click(); await driver.fill("1");
    await page.getByRole("button", { name: /Total fee/ }).click();
    const computed = page.locator(mode === "exact-in" ? "#buy-amount" : "#sell-amount");
    const bound = page.getByTestId(mode === "exact-in" ? "swap-minimum-output" : "swap-maximum-input");
    await expect(bound).toContainText(mode === "exact-in" ? "CYGLD" : "PAXG");
    await expect(page.getByTestId("swap-fees")).toHaveAttribute("aria-busy", "false");
    const originalAmount = await computed.inputValue(), originalBound = (await bound.textContent())!;
    const colors = () => page.evaluate(({ amountId, boundId }) => {
      const fees = document.querySelector('[data-testid="swap-fees"]')!;
      const row = [...fees.querySelectorAll("span")].find(value => value.textContent?.startsWith("Front-end fee ("))!.parentElement!;
      const elements = [document.querySelector(amountId)!, fees.querySelector("button")!.lastElementChild!,
        row.lastElementChild!, document.querySelector("#execution-tolerance")!, document.querySelector(`[data-testid="${boundId}"]`)!.lastElementChild!];
      return elements.map(element => ({ color: getComputedStyle(element).color, className: element.className }));
    }, { amountId: mode === "exact-in" ? "#buy-amount" : "#sell-amount", boundId: mode === "exact-in" ? "swap-minimum-output" : "swap-maximum-input" });
    const originalColors = await colors();
    await page.locator("#execution-tolerance").fill("0.5");
    await expect(computed).toHaveValue(originalAmount); await expect(bound).toHaveText(originalBound);
    expect(await colors()).toEqual(originalColors);
    await expect.poll(() => waiting).toBeGreaterThan(0);
    await expect(computed).toHaveAttribute("aria-busy", "true"); // The current quote is still preparing execution terms.
    await expect(computed).toHaveValue(originalAmount); await expect(bound).toHaveText(originalBound);
    expect(await colors()).toEqual(originalColors);
    release();
    await expect(bound).not.toHaveText(originalBound); await expect(computed).toHaveValue(originalAmount);
    expect(await colors()).toEqual(originalColors);
  } finally { release(); }
});
