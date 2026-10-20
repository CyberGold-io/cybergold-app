import { routeCoreIntent } from "./fixtures/trade-core";
import { expect, test } from "./fixtures/app-test";
import { choose, install } from "./fixtures/token-quotes";

test("a fresh disconnected form defaults to native ETH and preserves later currency selections", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  const pickers = page.locator("main button[aria-haspopup='dialog']");
  await expect(pickers.first()).toHaveText("ETH");
  await expect(pickers.last()).toHaveText("CYGLD");
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByTestId("market-data-stale-notice")).toHaveCount(0);
  expect(observed.intents).toHaveLength(0);
  await expect(page.locator("#sell-amount")).toBeFocused();
  await page.keyboard.type("1");
  await expect.poll(() => observed.intents.at(-1)).toMatchObject({ mode: "issue-exact-in", native: true });
  await page.locator("#sell-amount").clear();
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(pickers.first()).toHaveText("CYGLD");
  await expect(pickers.last()).toHaveText("ETH");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(pickers.first()).toHaveText("ETH");
  await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.locator("#buy-amount")).toHaveText("1");
  await pickers.last().click();
  const buy = page.getByRole("dialog");
  await expect(buy.getByRole("button", { name: "USDC USDC USDC", exact: true })).toBeVisible();
  await buy.getByRole("button", { name: "USDC USDC USDC", exact: true }).click();
  await expect(pickers.first()).toHaveText("CYGLD");
  await expect(pickers.last()).toHaveText("USDC");
  // A changed spend asset needs a fresh amount in that asset's units.
  await expect(page.locator("#sell-amount")).toHaveValue("");
  expect(observed.intents.some(intent => intent.mode === "redeem-exact-in")).toBe(false);
  await page.locator("#sell-amount").fill("1");
  await expect.poll(() => observed.intents.some(intent => intent.mode === "redeem-exact-in")).toBe(true);
  // Choosing CYGLD again restores the valid opposite side, including reload.
  await pickers.last().click();
  await buy.getByRole("button", { name: "CYGLD CyberGold CYGLD", exact: true }).click();
  await expect(pickers.first()).toHaveText("USDC");
  await expect(pickers.last()).toHaveText("CYGLD");
  await expect(page.locator("#sell-amount")).toHaveValue("");
  await page.reload();
  await expect(pickers.first()).toHaveText("USDC");
  await expect(pickers.last()).toHaveText("CYGLD");
});

for (const code of ["rpc-rate-limit", "rpc-timeout", "rpc-access-denied"] as const) {
  test(`French ${code} reports the specific RPC cause without raw English`, async ({ page }) => {
    await install(page);
    await routeCoreIntent(page, route => route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "error", code, error: "private provider failure", correlationId: "fixture" }) + "\n",
    }));
    await page.goto("/fr");
    await page.locator('main button[aria-haspopup="dialog"]').first().click();
    await page.getByPlaceholder("Rechercher une devise...").fill("WETH");
    await page.locator("#dropdown-from").getByRole("button", { name: "WETH Wrapped Ether WETH", exact: true }).click();
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
    const copy = code === "rpc-rate-limit" ? "Erreur RPC : limite de requêtes atteinte. Réessayez dans un instant."
      : code === "rpc-timeout" ? "Erreur RPC : le serveur n’a pas répondu à temps. Réessayez."
      : "Erreur RPC : le fournisseur a refusé l’accès. Réessayez plus tard.";
    await expect(page.getByText(copy, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("private provider failure")).toHaveCount(0);
    await expect(page.getByText("Quote is temporarily unavailable.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Veuillez connecter votre portefeuille", exact: true })).toBeEnabled();
  });
}
