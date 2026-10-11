import { test } from "./metamask/testWithMetaMask";

test.describe("Environment seed", () => {
  test("seed", async ({ page }) => {
    // Keep this file minimal for Playwright agents.
    // It should prepare a default starting state, not hold business test data.
    // Use the same MetaMask-aware test layer as the real wallet tests.
    // Shared issue/redeem inputs live in tests/test-data/cybergold-flow-data.ts.
    await page.goto("/en");
  });
});
