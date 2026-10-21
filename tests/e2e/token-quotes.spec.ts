import { routeCoreIntent } from "./fixtures/trade-core";
import { expect, test } from "./fixtures/app-test";
import { choose, install, previewSelectors } from "./fixtures/token-quotes";

for (const [symbol, kind] of [["WETH", "token"], ["ETH", "native"], ["USDC", "token"]] as const) {
  test(`${symbol} issuance and redemption use one intent stream per edited amount`, async ({ page }) => {
    const observed = await install(page);
    await page.goto("/en");
    await choose(page, symbol);
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
    await expect.poll(() => observed.previews).toContain(`issue-${kind}-exact-in`);
    await expect(page.locator("#buy-amount")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#buy-amount")).toHaveText("1");
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("");
    await expect(page.locator("#buy-amount")).toHaveText(/^0(?:[.,]0+)?$/);
    await page.getByRole("button", { name: "Reverse swap direction" }).click();
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().click();
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("3");
    await expect.poll(() => observed.previews).toContain(`redeem-${kind}-exact-in`);
    await expect(page.locator("#buy-amount")).not.toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#buy-amount")).toHaveText("3");
    expect(observed.intents.map(request => request.mode), JSON.stringify(observed.rawIntents)).toEqual(["issue-exact-in", "redeem-exact-in"]);
    expect(observed.intents.every(request => request.native === (kind === "native"))).toBe(true);
    // Price valuation can still read pools; quote routing no longer lists/records the cache.
    expect(observed.poolReads).not.toContain("/api/quote-pool-cache");
    expect(observed.quotes).toContain("exact-in");
    expect(observed.quotes).not.toContain("exact-out");
    expect(observed.rpcSelectors.filter(value => previewSelectors.has(value))).toEqual([]);
  });
}

for (const failure of ["token-preview", "uniswap"]) {
  test(`failed ${failure} does not retry through generic browser RPC`, async ({ page }) => {
    const observed = await install(page, failure);
    await page.goto("/en");
    await choose(page, "WETH");
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
    if (failure === "token-preview") await expect.poll(() => observed.previews).toContain("issue-token-exact-in");
    else await expect.poll(() => observed.quotes).toContain("exact-in");
    await expect(page.getByText("The quote service could not process this request. Retry.", { exact: true }).first()).toBeVisible();
    expect(observed.rpcSelectors.filter(value => previewSelectors.has(value))).toEqual([]);
  });
}


test("a completed issue estimate appears while the final quote is still preparing", async ({ page }) => {
  let finish!: () => void;
  const finalPreview = new Promise<void>(resolve => { finish = resolve; });
  await install(page, "", () => finalPreview);
  await page.goto("/en");
  await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  await expect(page.getByRole("status").filter({ hasText: "Estimate — preparing final quote" })).toBeHidden();
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await expect(page.locator("#buy-amount")).toHaveAttribute("aria-busy", "true");
  finish();
  await expect(page.getByRole("status").filter({ hasText: "Estimate — preparing final quote" })).toBeHidden();
  await expect(page.locator("#buy-amount")).not.toHaveAttribute("aria-busy", "true");
});


test("USDT issuance does not preflight empty routes while execution quotes are pending", async ({ page }) => {
  let finishExecution!: () => void;
  const pendingExecution = new Promise<void>(resolve => { finishExecution = resolve; });
  const observed = await install(page, "", () => pendingExecution);
  const browserPreflights: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/quotes/token-preview") browserPreflights.push(request.url()); });
  await page.goto("/en");
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  await page.getByRole("button", { name: "USDT Tether USD USDT", exact: true }).click();
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("10");
  await expect.poll(() => observed.previews).toContain("issue-token-exact-in");
  await expect.poll(() => observed.intents.length).toBe(1);
  await page.waitForTimeout(250);
  expect(browserPreflights).toEqual([]);
  await expect(page.getByTestId("quote-estimate-description")).toBeAttached();
  await expect(page.getByRole("status").filter({ hasText: "Estimate — preparing final quote" })).toBeHidden();
  await expect(page.getByText("Issue preflight validation failed for the entered amount.", { exact: true })).toHaveCount(0);
  finishExecution();
  await expect(page.getByRole("status").filter({ hasText: "Estimate — preparing final quote" })).toBeHidden();
  await expect(page.locator("#buy-amount")).toHaveText("10");
  await expect(page.getByText("Quote unavailable", { exact: true })).toHaveCount(0);
});


test("a failed final issuance preview still reports a quote failure", async ({ page }) => {
  await install(page);
  let validated = 0;
  await routeCoreIntent(page, async route => {
    validated++;
    await route.fulfill({ contentType: "application/x-ndjson", body:
      JSON.stringify({ type: "estimate", amount: "1000000000000000000" }) + "\n" +
      JSON.stringify({ type: "error", error: "Quote is temporarily unavailable.", correlationId: "fixture" }) + "\n" });
  });
  await page.goto("/en");
  await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect.poll(() => validated).toBe(1);
  await expect(page.getByText("The quote service could not process this request. Retry.", { exact: true }).first()).toBeVisible();
  await expect(page.locator("#buy-amount")).toHaveText("...");
});
