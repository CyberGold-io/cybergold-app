import { routeCoreIntent } from "./fixtures/trade-core";
import { selectBasket } from "./fixtures/swap-selection";
import { expect, test } from "./fixtures/app-test";
import { install as tokenInstall } from "./fixtures/token-quotes";
import { install as basketInstall } from "./fixtures/basket-quotes";
const messages = {
  en: "The Core redemption exceeds available supply or redemption capacity.",
  fr: "Le rachat Core dépasse l’offre disponible ou la capacité de rachat.",
  de: "Die Core-Rücknahme überschreitet das verfügbare Angebot oder die Rücknahmekapazität.",
};
const labels = {
  en: { search: "Search currency...", reverse: "Reverse swap direction", fees: "Total fee" },
  fr: { search: "Rechercher une devise...", reverse: "Inverser le sens de l’échange", fees: "Frais totaux" },
  de: { search: "Währung suchen...", reverse: "Tauschrichtung umkehren", fees: "Gesamtgebühr" },
};
const cases = [
  ...(["en", "fr", "de"] as const).map(locale => ({ locale, code: "insufficient-protocol-supply", message: messages[locale] })),
  { locale: "en" as const, code: "redemption-supply-exceeded", message: "The CYGLD input exceeds the available supply for redemption." },
  { locale: "en" as const, code: "redemption-capacity-exceeded", message: "The requested Core outputs exceed the available redemption capacity." },
];
for (const { locale, code, message } of cases) for (const path of ["token", "basket"]) {
  test(`${locale} ${path}: ${code} is specific and fees stay visible`, async ({ page }) => {
    if (path === "token") {
      await tokenInstall(page);
      await routeCoreIntent(page, route => route.fulfill({ contentType: "application/x-ndjson", body:
        JSON.stringify({ type: "error", code, error: "private diagnostic", correlationId: "fixture" }) + "\n" }));
    } else {
      await basketInstall(page);
      await page.route("**/api/quotes/basket-preview", route => route.fulfill({ status: 503, json: {
        code, error: "private diagnostic", correlationId: "fixture" } }));
    }
    await page.goto(`/${locale}`);
    if (path === "token") {
      await page.getByRole("button", { name: /^(Select token|BASKET|XAUt XAUt|PAXG PAXG|Sélectionner un token|Token auswählen)$/ }).first().click();
      await page.getByPlaceholder(labels[locale].search).fill("WETH");
      await page.locator("#dropdown-from").getByRole("button").filter({ has: page.getByText("Wrapped Ether", { exact: true }) }).click();
    }
    if (path === "basket") await selectBasket(page);
    await page.getByRole("button", { name: labels[locale].reverse }).click();
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().click();
    await page.locator('input[inputmode="decimal"]:not(#execution-tolerance)').first().fill("3");
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByText("private diagnostic", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: new RegExp(labels[locale].fees) })).toBeVisible();
  });
}
