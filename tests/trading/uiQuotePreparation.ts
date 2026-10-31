import { expect, type Page } from "@playwright/test";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import { getSwapButton } from "../metamask/token-flows/helpers.ts";
import type { QuoteObservation } from "./quoteObservation.ts";
import { quoteObservations } from "./quoteObservation.ts";
import type { Scenario } from "./scenarios.ts";
import { uiPreparationAssertion } from "./uiDiagnostics.ts";
import { browserQuoteMatcher } from "./browserQuoteObservation.ts";
import { quoteResponseError } from "../../app/utils/quoteErrors.ts";
import type { EconomicQuote } from "../../app/utils/economicQuotes.ts";
import { applySlippageFloor } from "../../app/utils/swapPolicy.ts";
import { formatUnits } from "viem";
import { quoteAssets } from "./uiQuoteCapture.ts";
import { selectedTolerance } from "./uiEconomics.ts";

export function uiQuoteReady(observations: readonly QuoteObservation[], scenario: Scenario,
  configuration: ProtocolConfiguration, swapEnabled: boolean) {
  const matches = observations.filter(browserQuoteMatcher(scenario, configuration,
    scenario.amountRaw ?? "0", scenario.basketAssets ?? []));
  return Boolean(matches.at(-1)?.terminal) && swapEnabled;
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

/** Select the actual Refresh request, not an earlier retained display observation. */
export function refreshedUiQuote(observations: readonly QuoteObservation[], scenario: Scenario,
  configuration: ProtocolConfiguration) {
  const matches = browserQuoteMatcher(scenario, configuration, scenario.amountRaw ?? "0", scenario.basketAssets ?? []);
  return observations.findLast(row => row.path === "/api/economic-quotes" && row.request.refresh === true && matches(row));
}

export function refreshedUiMinimum(quote: EconomicQuote, scenario: Scenario,
  configuration: ProtocolConfiguration, tolerance: string) {
  const outputs = quote.request.intent === 3
    ? quote.estimatedRecipientOutputs.filter(row => row.kind === 0).map(row => row.amount) : [quote.quotedOutput];
  const bps = selectedTolerance(tolerance);
  return quoteAssets(scenario, configuration, scenario.basketAssets ?? []).output.map((token, index) =>
    `${formatUnits(applySlippageFloor(BigInt(outputs[index]), bps), token.decimals)} ${token.symbol}`).join(" + ");
}

/** Positive execution exercises the existing current-state Refresh before accepting its displayed terms. */
export async function refreshUiQuote(page: Page, configuration: ProtocolConfiguration, scenario: Scenario,
  quoteEvidence?: Parameters<typeof uiPreparationAssertion>[2]) {
  await uiPreparationAssertion("ui-swap-not-enabled", async () => {
    const before = (await quoteObservations(page)).length;
    const refresh = page.locator("[data-trade-refresh]");
    await refresh.click();
    let observed: QuoteObservation | undefined;
    await expect.poll(async () => {
      observed = refreshedUiQuote((await quoteObservations(page)).slice(before), scenario, configuration);
      return Boolean(observed?.terminal);
    }, { timeout: 60000 }).toBe(true);
    if (observed!.terminal!.type !== "complete") {
      // Reuse ordinary HTTP error classification and its original request refs.
      // A failed Refresh may leave the previous quote visible and Swap enabled.
      throw await quoteResponseError(Response.json(observed!.terminal, { status: observed!.status,
        headers: observed!.requestId ? { "X-CyberGold-Request-Id": observed!.requestId } : {} }));
    }
    // The fetch observer can finish before React commits. Bind readiness to the
    // exact minimum rendered from the returned economics and current tolerance;
    // unchanged economics remain valid without an output or head-change rule.
    const tolerance = await page.locator('[data-testid="execution-tolerance-control"] input[type="range"]').inputValue();
    await expect(page.getByTestId("swap-minimum-output").locator("span").last())
      .toHaveText(refreshedUiMinimum(observed!.terminal!.value as EconomicQuote, scenario, configuration, tolerance), { timeout: 60000 });
    await expect(refresh).toBeEnabled({ timeout: 60000 });
    await waitForUiSwapReady(page, configuration, scenario, quoteEvidence);
  }, quoteEvidence);
}
