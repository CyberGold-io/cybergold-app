import { expect, test } from "./fixtures/app-test";
import { install } from "./fixtures/token-quotes";

for (const restoreDisabledAttribute of [false, true]) test(`a disconnected CYGLD reload keeps MAX disabled${restoreDisabledAttribute ? " when the initial DOM lost its disabled attribute" : ""}`, async ({ page, browserName }) => {
  await install(page);
  const hydrationErrors: string[] = [];
  const consoleMessages: string[] = [];
  const pendingScripts = new Set<string>();
  page.on("console", message => {
    consoleMessages.push(message.text());
    if (/hydrat|server.rendered HTML/i.test(message.text())) hydrationErrors.push(message.text());
  });
  page.on("pageerror", error => hydrationErrors.push(error.message));
  page.on("request", request => { if (request.resourceType() === "script") pendingScripts.add(request.url()); });
  page.on("requestfinished", request => pendingScripts.delete(request.url()));
  page.on("requestfailed", request => pendingScripts.delete(request.url()));
  await page.goto("/en");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await page.locator("#sell-amount").fill("0.01");
  await expect(page.locator("main button[aria-haspopup='dialog']").first()).toHaveText("CYGLD");
  await expect(page.locator("#buy-amount")).toHaveText("0.01");
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cg:swap-form-state:v1") ?? "null")?.sellAmount)).toBe("0.01");
  const restoredDisabled: boolean[][] = [];
  const liveDisabled: boolean[][] = [];
  if (restoreDisabledAttribute) {
    // A fulfilled document loses Chromium's loopback address classification.
    // Let this synthetic context reconnect to the local Next dev HMR endpoint.
    if (browserName === "chromium") await page.context().grantPermissions(["local-network-access"], { origin: new URL(page.url()).origin });
    // Replay the reported DOM/React disagreement before the inline bootstrap.
    // React's server payload still expects disabled=true for the live MAX.
    await page.route("**/en", async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace(/<button\b[^>]*\bdata-trade-max\b[^>]*>/g,
        tag => tag.replace(/\sdisabled(?:="[^"]*")?/, ""));
      const headers = { ...response.headers() };
      delete headers["content-length"];
      delete headers["content-encoding"];
      delete headers["transfer-encoding"];
      await route.fulfill({ status: response.status(), headers, body: html });
    });
  }

  for (let refresh = 0; refresh < 3; refresh++) {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const holdScripts = async (route: import("@playwright/test").Route) => {
      await pending;
      await route.continue();
    };
    await page.route("**/_next/static/**/*.js*", holdScripts);
    try {
      await page.reload({ waitUntil: "commit" });
      await expect(page.getByTestId("trade-cached-view")).toBeVisible();
      restoredDisabled.push(await page.locator("[data-trade-cached] button[data-trade-max]")
        .evaluateAll(nodes => nodes.map(node => node.hasAttribute("disabled"))));
      liveDisabled.push(await page.locator("[data-trade-live] button[data-trade-max]")
        .evaluateAll(nodes => nodes.map(node => node.hasAttribute("disabled"))));
      for (const selector of ["[data-trade-live]", "[data-trade-cached]"]) {
        const controls = page.locator(`${selector} button[data-trade-max]`);
        await expect(controls).toHaveCount(2);
        for (const control of await controls.all()) {
          await expect(control).toHaveAttribute("hidden", "");
        }
      }
      release();
      await expect(page.getByTestId("trade-cached-view")).toBeHidden();
      await expect(page.locator("#sell-amount")).toHaveValue("0.01");
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      liveDisabled.push(await page.locator("[data-trade-live] button[data-trade-max]")
        .evaluateAll(nodes => nodes.map(node => node.hasAttribute("disabled"))));
      expect(hydrationErrors).toEqual([]);
    } catch (error) {
      await test.info().attach("reload-diagnostics", { contentType: "application/json", body: JSON.stringify({
        consoleMessages, hydrationErrors, pendingScripts: [...pendingScripts],
        document: await page.evaluate(() => ({ ready: document.readyState, focused: document.activeElement?.outerHTML.slice(0, 300),
          navbar: document.querySelector("nav")?.outerHTML.slice(0, 300),
          live: document.querySelector("[data-trade-live]")?.getAttribute("hidden"),
          cached: document.querySelector("[data-trade-cached]")?.getAttribute("hidden"),
          scripts: [...document.scripts].map(script => ({ src: script.src, type: script.type })),
        })),
      }, null, 2) });
      throw error;
    } finally {
      release();
      await page.unroute("**/_next/static/**/*.js*", holdScripts);
    }
  }
  expect(restoredDisabled).toEqual([[true, true], [true, true], [true, true]]);
  expect(liveDisabled).toEqual(Array.from({ length: 6 }, () => [true, true]));
});
