import { openNavbarSettings } from "./fixtures/navbar-settings";
import { expect, test } from "./fixtures/app-test";
import { context, install } from "./fixtures/token-quotes";
import { selectBasket } from "./fixtures/swap-selection";

test("a failed focused read of the selected basket reports availability without blaming Core configuration", async ({ page }) => {
  let head = { ...context }, unavailable = false, failedReads = 0;
  await install(page, "", undefined, false, undefined, () => head);
  await page.route("**/api/protocol/facts", route => {
    if (!unavailable) return route.fallback();
    failedReads++;
    return route.fulfill({ status: 503, json: { error: "Protocol facts are temporarily unavailable." } });
  });
  await page.goto("/en");
  await selectBasket(page);
  await expect(page.getByText("Basket data could not be loaded. Try again later.")).toHaveCount(0);
  await page.clock.install();
  unavailable = true;
  head = { ...head, blockHash: `0x${"b".repeat(64)}` };
  await page.clock.runFor(12_000);
  await expect.poll(async () => { await page.clock.runFor(1_000); return failedReads; }).toBeGreaterThan(0);
  await expect(page.getByText("Basket data could not be loaded. Try again later.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Check NEXT_PUBLIC_CORE_DIAMOND_ADDRESS", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Basket is not available from the configured core address", { exact: false })).toHaveCount(0);
});

test("renders the English swap page", async ({ page }) => {
  await page.goto("/en");

  await expect(page).toHaveTitle(/CyberGold/i);
  await expect(page.getByText("Your budget", { exact: true })).toBeVisible();
  await expect(page.getByText("You Buy", { exact: true })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText(
    "© 2026 CyberGold. All rights reserved."
  );
});

test("renders the French swap page", async ({ page }) => {
  await page.goto("/fr");

  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByText("Votre budget", { exact: true })).toBeVisible();
  await expect(page.getByText("Vous recevez", { exact: true })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText(
    "© 2026 CyberGold. Tous droits réservés."
  );
});

test("renders the German swap page", async ({ page }) => {
  await page.goto("/de");

  await expect(page).toHaveURL(/\/de$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByText("Ihr Budget", { exact: true })).toBeVisible();
  await expect(page.getByText("Sie erhalten", { exact: true })).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText(
    "© 2026 CyberGold. Alle Rechte vorbehalten."
  );
});

test("switches from English to French from the language menu", async ({ page }) => {
  await page.goto("/en");

  await expect(page.getByText("Your budget", { exact: true })).toBeVisible();
  await openNavbarSettings(page, "locale");
  await page.getByRole("button", { name: "French", exact: true }).click();

  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByText("Votre budget", { exact: true })).toBeVisible();
  await expect(page.getByText("Vous recevez", { exact: true })).toBeVisible();
});

test("switches from English to German from the language menu", async ({ page }) => {
  await page.goto("/en");

  await expect(page.getByText("Your budget", { exact: true })).toBeVisible();
  await openNavbarSettings(page, "locale");
  await page.getByRole("button", { name: "German", exact: true }).click();

  await expect(page).toHaveURL(/\/de$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByText("Ihr Budget", { exact: true })).toBeVisible();
  await expect(page.getByText("Sie erhalten", { exact: true })).toBeVisible();
});


test("retired RPC returns 404 and reloaded current clients use fixed observations", async ({ page, request }) => {
  const retired = await request.post("/api/rpc", { data: {
    jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [],
  } });
  expect(retired.status()).toBe(404);
  const genericRequests: string[] = [];
  let factsRequests = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/rpc") genericRequests.push(request.url());
  });
  await page.route("**/api/protocol/facts", route => {
    factsRequests++;
    return route.fulfill({ status: 503, json: { error: "Protocol facts are temporarily unavailable." } });
  });
  await page.goto("/en");
  await expect(page.getByText("Your budget", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect.poll(() => factsRequests).toBeGreaterThan(0);
  const beforeReload = factsRequests;
  await page.reload();
  await expect(page.getByText("Your budget", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect.poll(() => factsRequests).toBeGreaterThan(beforeReload);
  await page.getByRole("button", { name: "Connect Wallet", exact: true }).first().click();
  await expect(page.getByText("Connect a Wallet", { exact: true })).toBeVisible();
  expect(genericRequests).toEqual([]);
});
