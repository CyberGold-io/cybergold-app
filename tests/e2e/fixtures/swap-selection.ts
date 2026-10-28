import type { Page } from "@playwright/test";
import { selectToken } from "../../metamask/token-flows/helpers";

/** These scenarios exercise an explicitly selected basket, not fresh-form defaults. */
export async function selectBasket(page: Page, side: "sell" | "buy" = "sell") {
  await selectToken(page, side, "BASKET");
}
