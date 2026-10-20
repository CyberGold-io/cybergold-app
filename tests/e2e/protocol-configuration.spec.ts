import { expect, test } from "./fixtures/app-test";
import { protocolConfigurationFixture } from "../fixtures/protocol-configuration";
import { installMarket } from "./fixtures/market-quotes";
import { context } from "./fixtures/token-quotes";

async function selectPaxg(page: import("@playwright/test").Page) {
  await page.locator('main button[aria-haspopup="dialog"]').first().click();
  await page.getByPlaceholder("Search currency...").fill("PAXG");
  await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText("PAXG", { exact: true }) }).click();
}

const changedAdapter = "0x00000000000000000000000000000000000000e5";
const changedHelpers = "0x00000000000000000000000000000000000000f6";

test("one configuration bootstrap supplies Core, market and the token catalog without per-quote fetches", async ({ page }) => {
  const observed = await installMarket(page);
  let configurations = 0;
  await page.route("**/api/protocol/config", route => {
    configurations++; return route.fulfill({ json: protocolConfigurationFixture });
  });
  await page.goto("/en");
  await expect(page.getByText("Your budget", { exact: true })).toBeVisible();
  await expect.poll(() => configurations).toBeGreaterThan(0);
  const bootstrapCalls = configurations;
  await selectPaxg(page);
  await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  await page.locator("#sell-amount").fill("2");
  await expect.poll(() => observed.requests.some(request => request.amount === "2000000000000000000")).toBe(true);
  expect(configurations).toBe(bootstrapCalls);
  expect(observed.requests.every(request => !("adapter" in request) && !("orderedAssets" in request))).toBe(true);
});

test("configuration failure leaves the shell interactive and reconnect restores ordinary target availability", async ({ page }) => {
  await installMarket(page);
  let available = false, calls = 0;
  await page.route("**/api/protocol/config", route => {
    calls++; return route.fulfill(available ? { json: protocolConfigurationFixture }
      : { status: 503, json: { error: "Configuration temporarily unavailable" } });
  });
  const failedBootstrap = page.waitForResponse("**/api/protocol/config");
  await page.goto("/en");
  expect((await failedBootstrap).status()).toBe(503);
  await expect(page.locator('main button[aria-haspopup="dialog"]').first()).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByText("Your budget", { exact: true })).toBeVisible();
  await expect(page.getByTestId("trade-mechanism")).toHaveCount(0);
  available = true;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => calls).toBeGreaterThan(1);
  await selectPaxg(page); await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
});

test("ordinary head refresh replaces the cached adapter and Helpers without rebuilding the App", async ({ page }) => {
  await page.clock.install();
  let configuration = protocolConfigurationFixture, currentHead = context;
  const observed = await installMarket(page, undefined, () => configuration.contracts.uniswapAdapter!);
  let calls = 0;
  await page.route("**/api/protocol/config", route => {
    calls++; return route.fulfill({ json: configuration });
  });
  await page.route("**/api/transaction/wait/head", route => route.fulfill({ json: { ...currentHead,
    blockTimestamp: String(Math.floor(Date.now() / 1000)) } }));
  await page.goto("/en"); await selectPaxg(page);
  await page.locator("#sell-amount").fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("0.999");
  const before = calls, previousQuotes = observed.requests.length;
  configuration = { ...protocolConfigurationFixture, contracts: { ...protocolConfigurationFixture.contracts,
    helpers: changedHelpers, uniswapAdapter: changedAdapter }, sandboxForkGeneration: "next-generation" };
  currentHead = { ...context, blockNumber: "101", blockHash: `0x${"b".repeat(64)}` };
  await page.clock.fastForward(61_000);
  await expect.poll(() => calls).toBeGreaterThan(before);
  await expect.poll(() => observed.requests.length).toBeGreaterThan(previousQuotes);
  await expect.poll(() => observed.quotes.at(-1)?.providerQuote.params.adapter).toBe(changedAdapter);
  expect(observed.requests.every(request => !("adapter" in request))).toBe(true);
});
