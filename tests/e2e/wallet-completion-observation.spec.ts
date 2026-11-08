import assert from "node:assert/strict";
import { expect, test, type Page } from "@playwright/test";
import { approveUntilMined } from "../trading/uiCompletion";
import { isUiCompletionDeadlineError } from "../trading/uiDiagnostics";

test.use({ actionTimeout: 0 });

for (const succeed of [true, false]) test(`original receipt recheck ${succeed ? "observes completion" : "does not treat a submitted hash as completion"}`, async ({ page }) => {
  await page.setContent('<button>Check confirmation</button><output id="count">0</output><div id="status"></div><section id="swapsection"><button>Waiting for confirmation</button></section>');
  await page.getByRole("button", { name: "Check confirmation" }).evaluate((button, succeeds) => {
    button.addEventListener("click", () => {
      document.querySelector("output")!.textContent = "1";
      if (succeeds) document.querySelector("#status")!.textContent = "Transaction confirmed";
      button.remove();
    });
  }, succeed);
  const run = approveUntilMined(page, () => true, undefined, undefined, performance.now() + 1000);
  if (succeed) await run;
  else await assert.rejects(run, isUiCompletionDeadlineError);
  await expect(page.locator("#count")).toHaveText("1");
  expect(await page.evaluate(() => "ethereum" in window)).toBe(false);
});

// This control uses Playwright's real enclosing test deadline with inert Page
// controls; it launches no browser/wallet/provider and changes no real run limit.
test("completion helper lifetime ends at an earlier enclosing Playwright deadline", async () => {
  test.setTimeout(1000);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const state = { observations: 0, reads: 0, clicks: 0, opens: 0, resumed: false };
  const control = { isVisible: async () => { state.reads++; return true; }, or: () => control,
    click: async () => { state.clicks++; } };
  const popup = { url: () => "chrome-extension://inert/notification.html", bringToFront: async () => { state.opens++; },
    setDefaultTimeout() {}, getByTestId: () => control, locator: () => control, isClosed: () => false };
  const hidden = { isVisible: async () => { state.reads++; return false; }, filter: () => hidden, first: () => hidden };
  const page = {
    getByText: () => hidden,
    getByRole: () => ({ isVisible: hidden.isVisible }),
    locator: () => ({ last: () => ({ innerText: async () => { state.reads++; return "MetaMask 1 of 1: Transaction confirmation"; } }) }),
    context: () => ({ serviceWorkers: () => [{ url: () => "chrome-extension://inert/background.js" }], pages: () => [popup] }),
  } as unknown as Page;
  const deadline = performance.now() + 10_000;
  const run = approveUntilMined(page, () => false, async () => {
    state.observations++; entered.resolve(); await release.promise; state.resumed = true; return undefined;
  }, undefined, deadline);
  try {
    await entered.promise;
    await assert.rejects(run, isUiCompletionDeadlineError);
    // Matcher deadlines use the genuine owning test limit minus250ms. Restore
    // this synthetic test's own limit before releasing the losing callback.
    test.setTimeout(5000);
    const observations = state.observations, reads = state.reads;
    release.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(state.resumed).toBe(true);
    expect(performance.now()).toBeLessThan(deadline);
    expect(state.observations).toBe(observations);
    expect(state.reads).toBe(reads);
    expect(state.opens).toBe(0); expect(state.clicks).toBe(0);
  } finally { test.setTimeout(5000); release.resolve(); }
});
