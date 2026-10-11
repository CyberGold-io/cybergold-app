import type { Page, Route } from "@playwright/test";

type FixtureRoute = Pick<Route, "request" | "fulfill">;
type FixtureHandler = (route: FixtureRoute) => Promise<void>;
export async function routeWalletBalances(page: Page, aggregate: FixtureHandler) {
  await page.route("**/api/account/wallet-balances*", route => aggregate(route));
}
