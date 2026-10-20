import { expect, test, type Page } from "./fixtures/app-test";
import { install } from "./fixtures/token-quotes";

async function holdScripts(page: Page) {
  let release!: () => void;
  let requests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/_next/static/**/*.js*", async route => { requests++; await pending; await route.fallback(); });
  return { release, requests: () => requests };
}

async function firstPaint(page: Page) {
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("paint")
    .some(entry => entry.name === "first-contentful-paint"))).toBe(true);
}

test("desktop display preferences and an open currency menu stay unchanged through reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await install(page);
  await page.goto("/en");
  await page.getByTestId("display-currency-control").click();
  await page.locator('[data-navbar-menu="currency"]').getByRole("button", { name: "EUR", exact: true }).click();
  await page.getByTestId("display-gold-unit-control").click();
  await page.locator('[data-navbar-menu="goldUnit"]').getByRole("button", { name: "Imperial (ozt)", exact: true }).click();
  await page.getByTestId("display-currency-control").click();
  const menu = page.locator('[data-navbar-menu="currency"]');
  await expect(menu).toBeVisible();
  const background = await menu.evaluate(node => getComputedStyle(node).backgroundColor);
  const scripts = await holdScripts(page);
  try {
    await page.reload({ waitUntil: "commit" });
    await expect.poll(scripts.requests).toBeGreaterThan(0);
    await firstPaint(page);
    await expect(menu).toBeVisible();
    await expect(menu).toHaveCSS("background-color", background);
    await expect(page.getByTestId("display-currency-control")).toHaveText("EUR");
    await expect(page.getByTestId("display-currency-control")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("display-gold-unit-control")).toHaveText("IMP");
    scripts.release();
    await expect(page.locator("nav[data-navbar-ready='true']")).toBeVisible();
    await expect(menu).toBeVisible();
    await page.getByTestId("display-currency-control").click();
    await expect(menu).toBeHidden();
  } finally { scripts.release(); }
});

test("mobile navigation keeps its disclosure and selected preferences before hydration", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await install(page);
  await page.addInitScript(() => {
    localStorage.setItem("display-currency", "CHF");
    localStorage.setItem("display-gold-unit", "imperial");
  });
  await page.goto("/en");
  const toggle = page.getByRole("button", { name: "Toggle navigation menu", exact: true });
  await toggle.click();
  const menu = page.locator('[data-navbar-menu="mobile"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-navbar-currency-option="CHF"]')).toHaveAttribute("aria-pressed", "true");
  const scripts = await holdScripts(page);
  try {
    await page.reload({ waitUntil: "commit" });
    await firstPaint(page);
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-navbar-currency-option="CHF"]')).toHaveAttribute("aria-pressed", "true");
    await expect(menu.locator('[data-navbar-gold-unit-option="imperial"]')).toHaveAttribute("aria-pressed", "true");
    scripts.release();
    await expect(page.locator("nav[data-navbar-ready='true']")).toBeVisible();
    await expect(menu).toBeVisible();
    await toggle.click();
    await expect(menu).toBeHidden();
  } finally { scripts.release(); }
});

test("the document keeps its scroll position through a full reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await install(page);
  await page.goto("/en");
  await page.locator("#sell-amount").fill("0.01");
  await expect(page.locator("#buy-amount")).toHaveText("0.01");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await page.locator("footer").scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(100);
  const scripts = await holdScripts(page);
  try {
    await page.reload({ waitUntil: "commit" });
    await firstPaint(page);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(before, 0);
    scripts.release();
    await expect(page.locator("[data-trade-live] #sell-amount")).toBeEditable();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(before, 0);
  } finally { scripts.release(); }
});


test("an open mobile navigation menu retains its own scroll before hydration and through handoff", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 });
  await install(page);
  await page.goto("/en");
  await page.getByRole("button", { name: "Toggle navigation menu", exact: true }).click();
  const menu = page.locator('[data-navbar-menu="mobile"]');
  const before = await menu.evaluate(node => { node.scrollTop = 80; return node.scrollTop; });
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const scripts = await holdScripts(page);
  try {
    await page.reload({ waitUntil: "commit" });
    await firstPaint(page);
    await expect(menu).toBeVisible();
    await expect.poll(() => menu.evaluate(node => node.scrollTop)).toBe(before);
    scripts.release();
    await expect(page.locator("nav[data-navbar-ready='true']")).toBeVisible();
    await expect.poll(() => menu.evaluate(node => node.scrollTop)).toBe(before);
  } finally { scripts.release(); }
});
