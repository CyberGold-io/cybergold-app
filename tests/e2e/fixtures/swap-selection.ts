import type { Page } from "@playwright/test";

/** These scenarios exercise an explicitly selected basket, not fresh-form defaults. */
export async function selectBasket(page: Page, side: "sell" | "buy" = "sell") {
  const pickers = page.locator('main button[aria-haspopup="dialog"]');
  await pickers[side === "sell" ? "first" : "last"]().click();
  await page.getByRole("dialog").getByRole("button", { name: /^Gold basket/ }).click();
}
