import { expect, test } from "./fixtures/app-test";

const marker = "cybergold:sandbox-fork-generation:31338";
const execution = "cybergold:governance-safe-executions:31338:same-safe";
const nonce = "cybergold:governance-safe-nonce:31338:same-safe";
test.skip(process.env.NEXT_PUBLIC_CHAIN_ID !== "31338", "Sandbox generation reset runs against the chain-31338 build");

test("a new Sandbox generation clears old browser executions without a nonce regression", async ({ page }) => {
  await page.addInitScript(({ marker, execution, nonce }) => {
    localStorage.setItem(marker, "old-fork");
    localStorage.setItem(execution, "old execution receipt");
    localStorage.setItem(nonce, "7");
    localStorage.setItem("cybergold:governance-safe-executions:1:same-safe", "mainnet");
  }, { marker, execution, nonce });
  await page.route("**/api/dashboard/onchain-summary", (route) => route.fulfill({ json: {
    enabled: true, sandboxForkGeneration: "new-fork", snapshotBlock: "100",
  } }));
  await page.goto("/en");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), marker)).toBe("new-fork");
  expect(await page.evaluate((key) => localStorage.getItem(key), execution)).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), nonce)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("cybergold:governance-safe-executions:1:same-safe"))).toBe("mainnet");
  await expect(page.getByText("You Sell")).toBeVisible();
});

test("a retained dashboard cannot erase current pending transactions", async ({ page }) => {
  await page.addInitScript(({ marker, execution }) => {
    localStorage.setItem(marker, "current-fork");
    localStorage.setItem(execution, "current pending transaction");
  }, { marker, execution });
  await page.route("**/api/dashboard/onchain-summary", (route) => route.fulfill({ json: { enabled: true } }));
  await page.goto("/en");
  await expect(page.getByText("You Sell")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), execution)).toBe("current pending transaction");
});

test("an unavailable dashboard cannot erase current pending transactions", async ({ page }) => {
  await page.addInitScript(({ marker, execution }) => {
    localStorage.setItem(marker, "current-fork");
    localStorage.setItem(execution, "current pending transaction");
  }, { marker, execution });
  await page.route("**/api/dashboard/onchain-summary", (route) => route.fulfill({ status: 503,
    json: { error: "Dashboard is rebuilding" } }));
  await page.goto("/en");
  await expect(page.getByText("You Sell")).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), execution)).toBe("current pending transaction");
});
