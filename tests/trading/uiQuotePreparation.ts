import { expect, type Page } from "@playwright/test";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import { getSwapButton } from "../metamask/token-flows/helpers.ts";
import type { QuoteObservation } from "./quoteObservation.ts";
import { isEconomicQuoteObservation, quoteObservationIncumbent, quoteObservations } from "./quoteObservation.ts";
import type { Scenario } from "./scenarios.ts";
import { uiPreparationAssertion } from "./uiDiagnostics.ts";
import { browserQuoteMatcher } from "./browserQuoteObservation.ts";

export function uiQuoteReady(observations: readonly QuoteObservation[], scenario: Scenario,
  configuration: ProtocolConfiguration, swapEnabled: boolean) {
  const matches = observations.filter(browserQuoteMatcher(scenario, configuration,
    scenario.amountRaw ?? "0", scenario.basketAssets ?? []));
  // Legacy producers still require the latest request's terminal winner.
  const ready = matches.some(isEconomicQuoteObservation) ? Boolean(quoteObservationIncumbent(matches))
    : matches.at(-1)?.terminal?.type === 'complete';
  return ready && swapEnabled;
}

/** Observe the original quote within the existing enabled-Swap deadline. */
export async function waitForUiSwapReady(page: Page, configuration: ProtocolConfiguration, scenario?: Scenario,
  quoteEvidence?: Parameters<typeof uiPreparationAssertion>[2]) {
  await uiPreparationAssertion("ui-swap-not-enabled", async () => {
    if (!scenario) return expect(await getSwapButton(page)).toBeEnabled({ timeout: 60000 });
    await expect.poll(async () => uiQuoteReady(await quoteObservations(page), scenario, configuration,
      await (await getSwapButton(page)).isEnabled()), { timeout: 60000 }).toBe(true);
  }, quoteEvidence);
}
