import { expect, test } from "./fixtures/app-test";
import { install } from "./fixtures/token-quotes";
import { openNavbarSettings } from "./fixtures/navbar-settings";

for (const width of [320, 390, 575, 576, 767, 768, 820, 991, 992, 1024, 1199, 1200, 1440]) {
  test(`website chrome fits and keeps settings/wallet accessible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await install(page); await page.goto("/en");
    const nav = page.locator("nav.cg-navbar");
    await expect(nav).toHaveAttribute("data-navbar-ready", "true");
    expect((await nav.boundingBox())!.height).toBe(width < 992 ? 54 : 58);
    const connect = nav.locator("[data-wallet-connect-button]");
    await expect(connect).toBeVisible();
    const walletBox = (await connect.boundingBox())!;
    const settingsBox = (await nav.getByRole("button", { name: "Settings", exact: true }).boundingBox())!;
    expect(walletBox.x + walletBox.width).toBeLessThanOrEqual(settingsBox.x);
    expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(width);
    if (width < 992) {
      await expect(nav.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toBeHidden();
      expect(walletBox.height).toBeGreaterThanOrEqual(44);
    } else {
      await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    }
    const panel = await openNavbarSettings(page, "currency");
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    const columns = await page.locator(".cg-footer-main").evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(width >= 992 ? 3 : width >= 768 ? 2 : 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if ([320, 390, 820, 1024, 1440].includes(width)) {
      await page.screenshot({ path: `out/audit/navbar-footer/${width}-en.png`, fullPage: true });
    }
  });
}

test("brand, internal routes, Litepaper and footer retain the specified destinations", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await install(page); await page.goto("/fr");
  const nav = page.locator("nav.cg-navbar"), footer = page.getByRole("contentinfo");
  await expect(nav.getByRole("link", { name: "CyberGold", exact: true })).toHaveAttribute("href", "https://www.cybergold.io/fr/");
  await expect(nav.getByRole("link", { name: "Swap", exact: true })).toHaveAttribute("href", "/fr");
  await expect(nav.getByRole("link", { name: "Tableau de bord", exact: true })).toHaveAttribute("href", "/fr/dashboard");
  const litepaper = nav.getByRole("link", { name: /^Litepaper/ });
  await expect(litepaper).toHaveAttribute("href", "https://litepaper.cybergold.io/");
  await expect(litepaper).toHaveAttribute("target", "_blank");
  await expect(litepaper).toHaveAttribute("rel", "noopener");
  await expect(footer.getByRole("link", { name: "contact@cybergold.io", exact: true })).toHaveAttribute("href", "mailto:#");
  for (const [name, href] of [
    ["CyberGold on GitHub", "https://github.com/CyberGold-io"],
    ["CyberGold on LinkedIn", "https://www.linkedin.com/company/100201492/"],
    ["CyberGold on X (Twitter)", "https://x.com/CyberGold_io"],
  ]) {
    const link = footer.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(footer.locator('a[href*="cybergold-website"]')).toHaveCount(0);
  await expect(footer).not.toContainText("nammu.ch");
  await expect(footer.locator('[data-testid="deployed-commit"], [data-testid="deployed-commit-unavailable"]')).toHaveCount(1);
  const appCommit = footer.getByTestId("deployed-commit");
  if (await appCommit.count()) {
    await expect(appCommit).toHaveAttribute("href", /^https:\/\/github\.com\/CyberGold-io\/cybergold-app\/commit\/[a-f0-9]{40}$/);
    await expect(appCommit).toHaveText(/^[a-f0-9]{8}$/);
  }
  await expect(footer.locator('a[href="/source"]')).toBeVisible();
  await expect(footer.locator(".cg-footer-brand img")).toHaveAttribute("srcset", "/branding/logo-light@2x.png 2x");
});

test("settings keyboard navigation, focus dismissal, choices and persistence work", async ({ page }) => {
  await install(page); await page.goto("/en");
  const root = page.getByRole("button", { name: "Settings", exact: true });
  await root.focus(); await page.keyboard.press("ArrowDown");
  const panel = page.locator('[data-navbar-menu="settings"]');
  await expect(panel.locator('[data-navbar-toggle="locale"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(panel.locator('[data-navbar-toggle="currency"]')).toBeFocused();
  await page.keyboard.press("Home"); await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: "English", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("ArrowDown");
  await expect(panel.getByRole("button", { name: "English", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(root).toBeFocused(); await expect(panel).toBeHidden();
  await openNavbarSettings(page, "currency");
  await panel.getByRole("button", { name: "EUR", exact: true }).click();
  await openNavbarSettings(page, "goldUnit");
  await panel.getByRole("button", { name: "Imperial (ozt)", exact: true }).click();
  await openNavbarSettings(page, "theme");
  await panel.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await page.reload(); await openNavbarSettings(page, "currency");
  await expect(panel.getByRole("button", { name: "EUR", exact: true })).toHaveAttribute("aria-pressed", "true");
  await openNavbarSettings(page, "goldUnit");
  await expect(panel.getByRole("button", { name: "Imperial (ozt)", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => ({ currency: localStorage.getItem("display-currency"), unit: localStorage.getItem("display-gold-unit"), mode: localStorage.getItem("display-price-mode") })))
    .toEqual({ currency: "EUR", unit: "imperial", mode: "gold" });
  await page.locator("#sell-amount").focus(); await expect(panel).toBeHidden();
});

test("language selection retains the dApp path, query and dashboard hash", async ({ page }) => {
  await install(page); await page.goto("/en/dashboard?review=1#core-protocol");
  const panel = await openNavbarSettings(page, "locale");
  await panel.getByRole("button", { name: "French", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/dashboard\?review=1#core-protocol$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("drawer traps focus, dismisses, and cleans up when resized to desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await install(page); await page.goto("/en");
  const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Menu", exact: true });
  const close = drawer.getByRole("button", { name: "Close navigation", exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("link", { name: /^Litepaper/ })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await expect(drawer).toBeHidden();
  await trigger.click(); await page.locator(".cg-drawer-backdrop").click({ position: { x: 385, y: 500 } });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click(); await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.locator(".cg-drawer-backdrop")).toBeHidden();
  await expect(page.locator(".cg-primary-navigation")).not.toHaveAttribute("role", "dialog");
  await expect(page.locator("nav").getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
});

test("scroll, hover, focus and reduced-motion states match the reference", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await install(page); await page.goto("/en");
  const nav = page.locator("nav.cg-navbar");
  await expect(nav).toHaveAttribute("data-scrolled", "false");
  await page.evaluate(() => scrollTo(0, 100)); await expect(nav).toHaveAttribute("data-scrolled", "true");
  await expect.poll(() => nav.evaluate(node => getComputedStyle(node, "::before").backdropFilter)).toBe("blur(14px)");
  const github = page.getByRole("link", { name: "CyberGold on GitHub", exact: true });
  await github.hover(); await expect(github).toHaveCSS("color", "rgb(226, 189, 73)");
  await github.focus(); await expect(github).toHaveCSS("outline-width", "2px");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await nav.evaluate(node => getComputedStyle(node, "::before").transitionDuration)).toBe("0s");
});

test("navbar wallet opens the existing chooser and dismisses settings", async ({ page }) => {
  await install(page); await page.goto("/en");
  await openNavbarSettings(page);
  await page.locator("nav [data-wallet-connect-button]").click();
  await expect(page.getByText("Connect a Wallet", { exact: true })).toBeVisible();
  await expect(page.locator('[data-navbar-menu="settings"]')).toBeHidden();
});
