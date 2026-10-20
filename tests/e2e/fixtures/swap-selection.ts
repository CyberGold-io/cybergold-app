import { expect, type Page } from "@playwright/test";

/** These scenarios exercise an explicitly selected basket, not fresh-form defaults. */
export async function selectBasket(page: Page, side: "sell" | "buy" = "sell") {
  const pickers = page.locator('main button[aria-haspopup="dialog"]');
  const option=page.getByRole("dialog").getByRole("button",{name:/^Gold basket/});
  await expect(async()=>{
    if(!await option.isVisible())await pickers[side === "sell" ? "first" : "last"]().click();
    await expect(option).toBeVisible({timeout:300});
  }).toPass();
  await option.click();
}
