import { expect, test } from "./fixtures/app-test";
import { asset, context, install } from "./fixtures/token-quotes";
import { protocolConfigurationFixture } from "../fixtures/protocol-configuration";
import { getTokenButton, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers";

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

for (const previousGeneration of [null, "old-fork"]) {
  test(`an open token picker survives ${previousGeneration ? "a replacement" : "the first"} Sandbox generation`, async ({ page }) => {
    // Match the quote observer's ordinary token-selection timeout.
    page.setDefaultTimeout(20_000);
    const generation = "new-fork";
    await page.addInitScript(({ marker, execution, nonce, previousGeneration }) => {
      if (previousGeneration) localStorage.setItem(marker, previousGeneration);
      localStorage.setItem(execution, "old execution receipt");
      localStorage.setItem(nonce, "7");
      localStorage.setItem("cybergold:governance-safe-executions:1:same-safe", "mainnet");
    }, { marker, execution, nonce, previousGeneration });
    await install(page, "", undefined, false, [asset], () => ({ ...context, chainId: 31338 }));
    let releaseConfiguration!: () => void, releaseGeneration!: () => void;
    const configurationReady = new Promise<void>(resolve => { releaseConfiguration = resolve; });
    const generationReady = new Promise<void>(resolve => { releaseGeneration = resolve; });
    await page.route("**/api/protocol/config", async route => {
      await configurationReady;
      // The generation reset cancels the initial request before refetching.
      await route.fulfill({ json: { ...protocolConfigurationFixture, chainId: 31338,
        tokens: protocolConfigurationFixture.tokens.map(token => ({ ...token, chainId: 31338 })),
        sandboxForkGeneration: generation } }).catch(() => {});
    });
    await page.route("**/api/dashboard/onchain-summary", async route => {
      await generationReady;
      await route.fulfill({ json: { sandboxForkGeneration: generation } });
    });
    let selection: Promise<void> | undefined;
    try {
      await page.goto("/en");
      await expect(page.getByRole("button", { name: "Connect Wallet", exact: true })).toBeVisible();
      await showAllSellTokens(page);
      selection = (async () => {
        await selectToken(page, "sell", "PAXG");
        await selectToken(page, "buy", "CYGLD");
      })();
      // Release the generation only after the real helper has opened the empty picker.
      await expect(page.locator("#dropdown-from").getByRole("status")).toHaveText("...");
      const oldDialog = await page.locator("#dropdown-from").elementHandle();
      releaseGeneration();
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), marker)).toBe(generation);
      // The execution subtree still remounts, while its new picker stays open.
      await expect.poll(() => oldDialog!.evaluate(element => element.isConnected)).toBe(false);
      await expect(getTokenButton(page, "sell")).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#dropdown-from").getByRole("status")).toHaveText("...");
      expect(await page.evaluate((key) => localStorage.getItem(key), execution)).toBeNull();
      expect(await page.evaluate((key) => localStorage.getItem(key), nonce)).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem("cybergold:governance-safe-executions:1:same-safe"))).toBe("mainnet");
      releaseConfiguration();
      await selection;
      await expect(getTokenButton(page, "sell", "PAXG")).toBeVisible();
      await expect(getTokenButton(page, "buy", "CYGLD")).toBeVisible();
    } finally {
      releaseGeneration();
      releaseConfiguration();
      await selection?.catch(() => {});
    }
  });
}
