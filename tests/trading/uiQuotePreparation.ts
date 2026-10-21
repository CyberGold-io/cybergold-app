import { expect, type Page } from "@playwright/test";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import { getSwapButton } from "../metamask/token-flows/helpers.ts";
import type { QuoteObservation } from "./quoteObservation.ts";
import { quoteObservations } from "./quoteObservation.ts";
import type { Scenario } from "./scenarios.ts";
import { uiPreparationAssertion } from "./uiDiagnostics.ts";
import { browserQuoteMatcher } from "./browserQuoteObservation.ts";

export function uiQuoteReady(observations: readonly QuoteObservation[], scenario: Scenario,
  configuration: ProtocolConfiguration, swapEnabled: boolean) {
  const matches = observations.filter(browserQuoteMatcher(scenario, configuration,
    scenario.amountRaw ?? "0", scenario.basketAssets ?? []));
  return Boolean(matches.at(-1)?.terminal) && swapEnabled;
}

/** Observe the original quote within the existing enabled-Swap deadline. */
export async function waitForUiSwapReady(page: Page, configuration: ProtocolConfiguration, scenario?: Scenario) {
  await uiPreparationAssertion("ui-swap-not-enabled", async () => {
    if (!scenario) return expect(await getSwapButton(page)).toBeEnabled({ timeout: 60000 });
    await expect.poll(async () => uiQuoteReady(await quoteObservations(page), scenario, configuration,
      await (await getSwapButton(page)).isEnabled()), { timeout: 60000 }).toBe(true);
  });
}
