import { expect, test } from "./fixtures/app-test";
import { protocolConfigurationFixture, protocolAddresses } from "../fixtures/protocol-configuration";
import { installMarket } from "./fixtures/market-quotes";
import { context } from "./fixtures/token-quotes";

const changedAdapter = "0x00000000000000000000000000000000000000e5";
const changedHelpers = "0x00000000000000000000000000000000000000f6";

test("one configuration bootstrap supplies Core, market and the token catalog without per-quote fetches", async ({ page }) => {
  const observed = await installMarket(page);
  let configurations = 0;
  await page.route("**/api/protocol/config", route => {
    configurations++; return route.fulfill({ json: protocolConfigurationFixture });
  });
  await page.goto("/en");
  await expect(page.getByText("You Sell", { exact: true })).toBeVisible();
  await expect.poll(() => configurations).toBeGreaterThan(0);
  const bootstrapCalls = configurations;
  await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  await page.getByLabel("Amount (PAXG)").fill("1");
  await expect(page.getByTestId("market-quote-details")).toBeVisible();
  await page.getByLabel("Amount (PAXG)").fill("2");
  await expect.poll(() => observed.requests.some(request => request.amount === "2000000000000000000")).toBe(true);
  expect(configurations).toBe(bootstrapCalls);
  expect(observed.requests.every(request => request.adapter?.toLowerCase() === protocolAddresses.adapter)).toBe(true);
});

test("configuration failure leaves the shell interactive and reconnect restores ordinary target availability", async ({ page }) => {
  await installMarket(page);
  let available = false, calls = 0;
  await page.route("**/api/protocol/config", route => {
    calls++; return route.fulfill(available ? { json: protocolConfigurationFixture }
      : { status: 503, json: { error: "Configuration temporarily unavailable" } });
  });
  await page.goto("/en");
  await expect(page.getByRole("button", { name: "Liquidity swap", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  await page.getByLabel("Amount (PAXG)").fill("1");
  await expect(page.getByTestId("market-quote-details")).toHaveCount(0);
  available = true;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => calls).toBeGreaterThan(1);
  await expect(page.getByTestId("market-quote-details")).toBeVisible();
});

test("ordinary head refresh replaces the cached adapter and Helpers without rebuilding the App", async ({ page }) => {
  await page.clock.install();
  const observed = await installMarket(page);
  let configuration = protocolConfigurationFixture, currentHead = context;
  let calls = 0;
  await page.route("**/api/protocol/config", route => {
    calls++; return route.fulfill({ json: configuration });
  });
  await page.route("**/api/transaction/wait/head", route => route.fulfill({ json: { ...currentHead,
    blockTimestamp: String(Math.floor(Date.now() / 1000)) } }));
  await page.goto("/en"); await page.getByRole("button", { name: "Liquidity swap", exact: true }).click();
  await page.getByLabel("Amount (PAXG)").fill("1");
  await expect(page.getByTestId("market-quote-details")).toBeVisible();
  const before = calls;
  configuration = { ...protocolConfigurationFixture, contracts: { ...protocolConfigurationFixture.contracts,
    helpers: changedHelpers, uniswapAdapter: changedAdapter }, sandboxForkGeneration: "next-generation" };
  currentHead = { ...context, blockNumber: "101", blockHash: `0x${"b".repeat(64)}` };
  await page.clock.fastForward(61_000);
  await expect.poll(() => calls).toBeGreaterThan(before);
  await expect.poll(() => observed.requests.some(request => request.adapter?.toLowerCase() === changedAdapter)).toBe(true);
  expect(observed.models.some(request => request.adapter?.toLowerCase() === changedAdapter)).toBe(true);
});
