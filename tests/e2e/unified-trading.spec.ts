import { expect, test, type Page } from "./fixtures/app-test";
import { installMarket, marketUniversalFixture } from "./fixtures/market-quotes";
import { universalFixture } from "./fixtures/universal-exact-input";
import { install } from "./fixtures/token-quotes";

async function pickPaxg(page: Page) {
  const search=page.getByPlaceholder("Search currency...");
  await expect(async()=>{if(!await search.isVisible())await page.locator('main button[aria-haspopup="dialog"]').first().click();await expect(search).toBeVisible({timeout:300});}).toPass();
  await search.fill("PAXG");
  await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText("PAXG", { exact: true }) }).click();
}

for (const action of ["click", "edit"] as const) test(`fresh ETH input: ${action} keeps the amount editable until explicit token selection`, async ({ page }) => {
  await installMarket(page); await page.goto("/en");
  await expect(page.locator("#sell-token-label")).toHaveText("ETH");
  await expect(page.getByPlaceholder("Search currency...")).toHaveCount(0);
  if (action === "click") await page.locator("#sell-amount").click();
  else await page.locator("#sell-amount").fill("2");
  await expect(page.locator("#sell-amount")).toBeEditable();
  await expect(page.getByPlaceholder("Search currency...")).toHaveCount(0);
  await page.locator("#sell-amount").fill("2");
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  await expect(page.getByPlaceholder("Search currency...")).toBeVisible();
  await pickPaxg(page);
  await expect(page.locator("#sell-token-label")).toHaveText("PAXG");
  await page.locator("#sell-amount").fill("2");
  await expect(page.locator("#buy-amount")).toHaveText("1.998");
});

test("dark token search uses readable foreground and placeholder colors", async ({ page }) => {
  await install(page); await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/en"); await expect(page.locator("html")).toHaveClass(/dark/);
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
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
  await page.goto("/en"); await page.locator("#sell-amount").click(); await pickPaxg(page);
  await page.locator("#sell-amount").fill("1"); await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByText("Front-end fee:", { exact: true })).toBeVisible();
  await expect(page.getByTestId("swap-helpers-fee").locator("span").last()).toContainText("0 CYGLD");
  const minimum = page.getByTestId("swap-minimum-output");
  await expect(minimum).toContainText("CYGLD");
  const before = await minimum.textContent(), requests = observed.requests.length;
  await page.locator("#execution-tolerance").fill("0.5");
  await expect(minimum).not.toHaveText(before!);
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await expect(page.getByTestId("swap-helpers-fee").locator("span").last()).toContainText("0 CYGLD");
  expect(observed.requests).toHaveLength(requests);
});

test("Core nominal redemption output is independent of its protective minimum", async ({ page }) => {
  await install(page);
  await page.route("**/api/economic-quotes", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ json: universalFixture(request, { quotedOutput: request.inputs[0].amount }) });
  });
  await page.goto("/en"); await page.locator("#sell-amount").click(); await pickPaxg(page);
  await page.getByRole("button", { name: "Reverse swap direction" }).click();
  await page.locator("#sell-amount").click(); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByText("Helpers fee (0%):", { exact: true })).toBeVisible();
  const before = (await page.getByTestId("swap-minimum-output").textContent())!;
  await page.locator("#execution-tolerance").fill("0.5");
  await expect(page.getByTestId("swap-minimum-output")).not.toHaveText(before);
  await expect(page.locator("#buy-amount")).toHaveText("1");
});

test("a later selected Core plan replaces the complete market tuple without a strategy toggle", async ({ page }) => {
  await installMarket(page);
  await page.route("**/api/economic-quotes", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ json: BigInt(request.inputs[0].amount) === 10n ** 18n
      ? marketUniversalFixture(request) : universalFixture(request, { quotedOutput: request.inputs[0].amount }) });
  });
  await page.goto("/en"); await page.locator("#sell-amount").click(); await pickPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await page.locator("#sell-amount").fill("2");
  await expect(page.locator("#buy-amount")).toHaveText("2");
  await expect(page.getByRole("button", { name: "Liquidity swap", exact: true })).toHaveCount(0);
});

test("rapid tolerance edits retain nominal terms without starting economic search", async ({ page }) => {
  const observed = await installMarket(page); await page.goto("/en");
  await page.locator("#sell-amount").click(); await pickPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
  const before = observed.requests.length, originalBound = (await page.getByTestId("swap-minimum-output").textContent())!;
  // Hold time fixed: committed guard edits must not start an economic search.
  await page.clock.pauseAt(new Date());
  for (const value of ["0.5", "0.3", "0.7"]) {
    await page.locator("#execution-tolerance").fill(value);
    await page.clock.runFor(0);
    await expect(page.locator("#execution-tolerance")).toHaveValue(value);
    await expect(page.locator("#buy-amount")).toHaveText("0.999");
    await expect(page.getByText("Front-end fee:", { exact: true })).toBeVisible();
    await expect(page.getByTestId("swap-minimum-output")).not.toHaveText(originalBound);
  }
  expect(observed.requests).toHaveLength(before);
  await page.clock.runFor(150);
  await expect.poll(async () => { await page.clock.runFor(0); return observed.requests.length; }).toBe(before);
  await expect(page.getByTestId("swap-minimum-output")).not.toHaveText(originalBound);
  await expect(page.getByTestId("swap-minimum-output")).toContainText("CYGLD");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
});

test("explicit Refresh retains complete measured terms while pending", async ({ page }) => {
  const observed = await installMarket(page);
  let release!: () => void, waiting = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/economic-quotes", async route => {
    if (route.request().postDataJSON().refresh) { waiting++; await held; }
    await route.fallback();
  });
  try {
    await page.goto("/en"); await page.locator("#sell-amount").click(); await pickPaxg(page);
    await page.locator("#sell-amount").fill("1");
    await expect(page.locator("#buy-amount")).toHaveText("0.999");
    await page.getByRole("button", { name: /Total fee/ }).click();
    const bound = page.getByTestId("swap-minimum-output");
    await expect(bound).toContainText("CYGLD");
    const originalBound = await bound.textContent(), requests = observed.requests.length;
    await page.locator('[data-trade-refresh]').click();
    await expect.poll(() => waiting).toBe(1);
    await expect(page.locator("#buy-amount")).toHaveText("0.999");
    await expect(bound).toHaveText(originalBound!);
    release();
    await expect.poll(() => observed.requests.length).toBe(requests + 1);
    await expect(page.locator('[data-trade-refresh]')).toBeEnabled();
    await expect(page.locator("#buy-amount")).toHaveText("0.999");
  } finally { release(); }
});
