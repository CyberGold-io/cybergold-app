import { openNavbarSettings } from "./fixtures/navbar-settings";
import { expect, test } from "./fixtures/app-test";
import { install } from "./fixtures/token-quotes";

type ThemeSurfaces = {
  dark: boolean;
  colorScheme: string;
  variables: string[];
  buttons: Record<string, { background: string; foreground: string } | null>;
};

test("theme changes keep native controls in the saved color scheme after reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await install(page);
  await page.goto("/en");
  const root = page.locator("html");
  await expect(root).toHaveCSS("color-scheme", "dark");
  await openNavbarSettings(page, "theme");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(root).not.toHaveClass(/dark/);
  await expect(root).toHaveCSS("color-scheme", "light");
  await page.reload();
  await expect(root).not.toHaveClass(/dark/);
  await expect(root).toHaveCSS("color-scheme", "light");
  await openNavbarSettings(page, "theme");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(root).toHaveClass(/dark/);
  await expect(root).toHaveCSS("color-scheme", "dark");
});

test("saved dark mode keeps button surfaces unchanged before hydration and throughout a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await install(page);
  const hydrationErrors: string[] = [];
  const pageErrors: string[] = [], consoleErrors: string[] = [], failedRequests: string[] = [];
  const pendingScripts = new Set<string>();
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
    if (["error", "warning"].includes(message.type()) && /hydrat|server.rendered HTML/i.test(message.text())) hydrationErrors.push(message.text());
  });
  page.on("pageerror", error => { pageErrors.push(error.message); if (/hydrat/i.test(error.message)) hydrationErrors.push(error.message); });
  page.on("request", request => { if (request.resourceType() === "script") pendingScripts.add(new URL(request.url()).pathname); });
  page.on("requestfinished", request => pendingScripts.delete(new URL(request.url()).pathname));
  page.on("requestfailed", request => { pendingScripts.delete(new URL(request.url()).pathname);
    failedRequests.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`); });
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    Object.assign(window, { __readThemeSurfaces: () => {
      const visible = (node: Element) => Boolean(node.getClientRects().length) && !node.closest("[hidden]");
      const firstVisible = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].find(visible);
      const selectors = {
        settings: '[data-navbar-toggle="settings"]',
        wallet: '[data-wallet-connect-button]',
        sellToken: '[data-trade-display="sellSymbol"]',
        buyToken: '[data-trade-display="buySymbol"]',
        fees: "[data-trade-fees] > summary",
      };
      const buttons = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
        const label = firstVisible(selector);
        const element = key.endsWith("Token") ? label?.closest("button") : label;
        const style = element ? getComputedStyle(element) : undefined;
        return [key, style ? { background: style.backgroundColor, foreground: style.color } : null];
      }));
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        dark: document.documentElement.classList.contains("dark"),
        colorScheme: rootStyle.colorScheme,
        variables: ["--background", "--background-input", "--background-swap-container"].map(key => rootStyle.getPropertyValue(key).trim()),
        buttons,
      };
    } });
  });
  await page.goto("/en");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.locator("#sell-amount").fill("0.01");
  await expect(page.locator("#buy-amount")).toHaveText("0.01");
  await page.getByRole("button", { name: /Total fee/ }).click();
  await expect(page.locator("#execution-tolerance")).toBeEditable();
  await page.getByRole("button", { name: /Total fee/ }).click();
  const baseline = await page.evaluate(() => (window as unknown as { __readThemeSurfaces: () => ThemeSurfaces }).__readThemeSurfaces());
  expect(Object.values(baseline.buttons).every(value => value !== null)).toBe(true);
  expect(baseline.dark).toBe(true);
  expect(baseline.colorScheme).toBe("dark");
  expect(baseline.buttons.settings!.background).not.toMatch(/^(?:white|rgb\(255, 255, 255\)|oklch\(1 0 0\))$/);

  // An absent cookie must not cause a light frame while the browser restores
  // its saved dark preference and the trade presentation hydrates.
  await page.context().clearCookies({ name: "theme" });
  let release!: () => void, scriptRequests = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/_next/static/**/*.js*", async route => { scriptRequests++; await pending; await route.fallback(); });
  try {
    await page.reload({ waitUntil: "commit" });
    await expect.poll(() => scriptRequests).toBeGreaterThan(0);
    await expect(page.getByTestId("trade-cached-view")).toBeVisible();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType("paint")
      .some(entry => entry.name === "first-contentful-paint"))).toBe(true);
    const beforeHydration = await page.evaluate(() => (window as unknown as { __readThemeSurfaces: () => ThemeSurfaces }).__readThemeSurfaces());
    expect(beforeHydration).toEqual(baseline);
    await page.evaluate(() => {
      const target = window as unknown as {
        __readThemeSurfaces: () => ThemeSurfaces;
        __themeReloadFrames: { stopped: boolean; frames: ThemeSurfaces[] };
      };
      const state: { stopped: boolean; frames: ThemeSurfaces[] } = { stopped: false, frames: [] };
      target.__themeReloadFrames = state;
      const sample = () => {
        if (state.stopped) return;
        state.frames.push(target.__readThemeSurfaces());
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    release();
    try { await expect(page.getByTestId("trade-cached-view")).toBeHidden(); }
    catch (error) {
      const browserState = await page.evaluate(() => ({ readyState: document.readyState,
        focused: document.activeElement?.outerHTML.slice(0, 300),
        liveInputs: [...document.querySelectorAll('[data-trade-live] [data-trade-spend-input]')].map(node => node.outerHTML.slice(0, 300)),
        scripts: [...document.scripts].filter(script => script.src).map(script => new URL(script.src).pathname),
      }));
      const diagnostics = JSON.stringify({ pageErrors, consoleErrors, failedRequests, pendingScripts: [...pendingScripts], browserState });
      await test.info().attach("theme-handoff-diagnostics", { body: diagnostics, contentType: "application/json" });
      console.log(diagnostics);
      throw error;
    }
    await expect(page.locator("#sell-amount")).toHaveValue("0.01");
    const frames = await page.evaluate(() => new Promise<ThemeSurfaces[]>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      const state = (window as unknown as { __themeReloadFrames: { stopped: boolean; frames: ThemeSurfaces[] } }).__themeReloadFrames;
      state.stopped = true;
      resolve(state.frames);
    }))));
    await test.info().attach("dark-button-reload-frames", { body: JSON.stringify({ baseline, beforeHydration, frames }), contentType: "application/json" });
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(frame => JSON.stringify(frame) === JSON.stringify(baseline))).toBe(true);
    expect(hydrationErrors).toEqual([]);
  } finally { release(); }
});
