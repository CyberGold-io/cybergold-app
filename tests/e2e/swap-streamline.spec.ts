import { expect, test } from "./fixtures/app-test";
import { choose, install } from "./fixtures/token-quotes";

test("a fresh disconnected form asks for a sell token and exposes all receive assets", async ({ page }) => {
  const observed = await install(page);
  await page.goto("/en");
  const pickers = page.locator("main button[aria-haspopup='dialog']");
  await expect(pickers.first()).toHaveText("Select token");
  await expect(pickers.last()).toHaveText("CYGLD");
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByTestId("market-data-stale-notice")).toHaveCount(0);
  expect(observed.intents).toHaveLength(0);
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(pickers.first()).toHaveText("CYGLD");
  await expect(pickers.last()).toHaveText("Select token");
  await page.getByRole("button", { name: "Reverse swap direction", exact: true }).click();
  await expect(pickers.first()).toHaveText("Select token");
  await choose(page, "WETH");
  await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("1");
  await expect(page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').last()).toHaveValue("1");
  await pickers.last().click();
  const buy = page.getByRole("dialog");
  await expect(buy.getByRole("button", { name: "USDC USDC USDC", exact: true })).toBeVisible();
  await buy.getByRole("button", { name: "USDC USDC USDC", exact: true }).click();
  await expect(pickers.first()).toHaveText("CYGLD");
  await expect(pickers.last()).toHaveText("USDC");
  await expect.poll(() => observed.intents.some(intent => intent.mode === "redeem-exact-in")).toBe(true);
  // Choosing CYGLD again restores the valid opposite side, including reload.
  await pickers.last().click();
  await buy.getByRole("button", { name: "CYGLD CyberGold CYGLD", exact: true }).click();
  await expect(pickers.first()).toHaveText("USDC");
  await expect(pickers.last()).toHaveText("CYGLD");
  await page.reload();
  await expect(pickers.first()).toHaveText("USDC");
  await expect(pickers.last()).toHaveText("CYGLD");
});

for (const code of ["rpc-rate-limit", "rpc-timeout", "rpc-access-denied"] as const) {
  test(`French ${code} reports the specific RPC cause without raw English`, async ({ page }) => {
    await install(page);
    await page.route("**/api/quotes/intent/stream", route => route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "error", code, error: "private provider failure", correlationId: "fixture" }) + "\n",
    }));
    await page.goto("/fr");
    await page.getByRole("button", { name: "Sélectionner un token", exact: true }).first().click();
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
