import { expect, test } from "./fixtures/app-test";
import { choose, context, install } from "./fixtures/token-quotes";
import { coreIntentRequest, tradeFixture } from "./fixtures/trade-core";
import { intentFixture } from "./fixtures/quote-intent";
import type { TradeModelRequest } from "../../app/utils/tradeQuote";

for (const symbol of ["WETH", "USDC"] as const) {
  for (const mode of ["issue-in", "redeem-in"] as const) {
    test(`${symbol} ${mode}: an exact fresh revisit bypasses typing debounce without another request`, async ({ page }) => {
      const observed = await install(page);
      await page.goto("/en"); await choose(page, symbol);
      if (mode.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
      const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)'), exactIn = mode.endsWith("-in");
      const edited = exactIn ? inputs.first() : inputs.last(), quoted = exactIn ? inputs.last() : inputs.first();
      await edited.click(); await edited.fill("1"); await expect(quoted).not.toHaveValue(""); await expect(quoted).not.toHaveAttribute("aria-busy", "true");
      const expected = await quoted.inputValue();
      await edited.fill("2");
      // Empty/enabled is a transient edit state, not a completed second quote.
      await expect(quoted).toHaveValue(String(Number(expected) * 2));
      await expect(quoted).not.toHaveAttribute("aria-busy", "true");
      await expect.poll(() => observed.intents.length).toBe(2);
      const before = observed.intents.length;
      await edited.evaluate((input, expectedValue) => {
        const all = [...document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]:not(#execution-tolerance)')];
        const output = all.find(row => row !== input)!;
        input.addEventListener("input", () => {
          const started = performance.now();
          const check = () => {
            if (output.getAttribute("aria-busy") !== "true" && output.value === expectedValue) Object.assign(window, { __revisitMs: performance.now() - started });
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        }, { once: true });
      }, expected);
      await edited.fill("1"); await expect(quoted).toHaveValue(expected); await expect(quoted).not.toHaveAttribute("aria-busy", "true");
      expect(observed.intents.length).toBe(before);
      await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __revisitMs?: number }).__revisitMs)).toBe("number");
      const elapsed = await page.evaluate(() => (window as unknown as { __revisitMs: number }).__revisitMs);
      await test.info().attach("exact-revisit", { contentType: "application/json", body: JSON.stringify({ symbol, mode,
        elapsedMs: elapsed, newRequests: observed.intents.length - before, requests: observed.intents,
        scope: "Fresh exact browser cache fixture at one head." }) });
      expect(observed.intents.length).toBe(before);
    });
  }
}

for (const symbol of ["WETH", "USDC"] as const) {
  for (const mode of ["issue-in", "redeem-in"]) {
    test(`${symbol} ${mode}: organic browser preview precedes debounce, stays approximate and clears invalid input`, async ({ page }) => {
      let pending = Promise.resolve(), finish!: () => void;
      const observed = await install(page, "", () => pending, false, undefined, undefined, undefined, true);
      // The coordinator owns organic history and ranks the indicative value.
      // Empty history stays unavailable; no App family ranking is synthesized.
      await page.route("**/api/quotes/trade/model", async route => {
        const request: TradeModelRequest = route.request().postDataJSON();
        if (!observed.intents.length || BigInt(request.amount) <= 0n) {
          await route.fulfill({ json: { namespace: "trade", intent: request, models: [] } }); return;
        }
        const providerRequest = coreIntentRequest({ ...request, recipient: `0x${"0".repeat(40)}`, deadline: "1900000000" });
        const value = tradeFixture(intentFixture(providerRequest), providerRequest);
        const amount = request.mode === "exact-in" ? value.quotedOutput : value.quotedInput;
        await route.fulfill({ json: { namespace: "trade", intent: request,
          models: [{ strategy: "core", value: { revision: 1, intent: { ...providerRequest, deadline: undefined },
            protocol: null, routes: [], whole: [{ input: request.amount, display: amount, context, recordedAt: Date.now() / 1000 }] } }],
          estimate: { strategy: "core", amount } } });
      });
      await page.goto("/en"); await choose(page, symbol);
      if (mode.startsWith("redeem")) await page.getByRole("button", { name: "Reverse swap direction" }).click();
      const inputs = page.locator('input[inputmode="decimal"]:not(#execution-tolerance)'), exactIn = mode.endsWith("-in");
      const edited = exactIn ? inputs.first() : inputs.last(), quoted = exactIn ? inputs.last() : inputs.first();
      await edited.click(); await edited.fill("1");
      await expect(quoted).not.toHaveAttribute("aria-busy", "true"); await expect(quoted).not.toHaveValue("");
      pending = new Promise<void>(resolve => { finish = resolve; });
      const clockStart = new Date();
      await page.clock.install({ time: clockStart });
      // Installing the clock alone keeps it advancing with wall time. Pause
      // explicitly before edit/assertions so a busy runner cannot expire the
      // typing debounce while we inspect the immediate model.
      await page.clock.pauseAt(new Date(clockStart.getTime() + 1000));
      const before = observed.intents.length;
      await page.evaluate(() => {
        const inputs = [...document.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]:not(#execution-tolerance)')];
        const source = inputs.find(input => input === document.activeElement)!;
        const output = inputs.find(input => input !== source)!;
        const measurement = { start: null as number | null, previewMs: null as number | null };
        Object.assign(window, { __modelTiming: measurement });
        source.addEventListener("input", () => { measurement.start = performance.now(); });
        const observer = new MutationObserver(() => {
          if (measurement.start !== null && measurement.previewMs === null && output.value !== "") measurement.previewMs = performance.now() - measurement.start;
        });
        observer.observe(output, { attributes: true, attributeFilter: ["value"] });
      });
      await edited.fill("2");
      // The Backend-ranked model arrives asynchronously. Flush only immediate
      // query notifications, leaving the exact-quote debounce clock unchanged.
      await expect.poll(async () => { await page.clock.runFor(0); return quoted.inputValue(); }).not.toBe("");
      await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
      const timing = await page.evaluate(() => (window as unknown as { __modelTiming: { previewMs: number | null } }).__modelTiming);
      expect(timing.previewMs).not.toBeNull();
      // No logical time has elapsed: the lightweight Backend model follows the
      // raw amount before the typing timer starts the next exact request.
      // Wall-time CPU scheduling is a measurement, not this invariant.
      expect(observed.intents.length).toBe(before);
      await page.clock.runFor(150);
      await expect.poll(() => observed.intents.length).toBe(before + 1);
      await expect(quoted).toHaveAttribute("aria-busy", "true");
      await edited.fill("");
      await expect(quoted).toHaveValue("");
      finish();
      await page.waitForTimeout(150);
      await expect(quoted).toHaveValue("");
      await test.info().attach("local-preview-timing", { body: JSON.stringify({ symbol, mode, ...timing,
        quoteRequests: observed.intents.length, scope: "linear read-only fixture history with a controlled debounce clock; previewMs is logical time, not wall-clock latency" }), contentType: "application/json" });
    });
  }
}
