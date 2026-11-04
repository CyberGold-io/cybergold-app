import { expect, type Page } from "@playwright/test";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import { getSwapButton } from "../metamask/token-flows/helpers.ts";
import type { QuoteObservation } from "./quoteObservation.ts";
import { isEconomicQuoteObservation, quoteObservationIncumbent, quoteObservations } from "./quoteObservation.ts";
import type { Scenario } from "./scenarios.ts";
import { uiPreparationAssertion } from "./uiDiagnostics.ts";
import { browserQuoteMatcher } from "./browserQuoteObservation.ts";

export type UiReadinessDiagnostic = {
  quoteReady: boolean; swapEnabled: boolean; observations: number; matchingObservations: number;
  latest?: { path: string; status: number; requestId?: string; backendRevision?: string;
    qualifiedFrames: number; invalidatedFrames: number; terminal?: string; interrupted?: boolean; aborted?: boolean };
};

export function uiQuoteReadiness(observations: readonly QuoteObservation[], scenario: Scenario,
  configuration: ProtocolConfiguration, swapEnabled: boolean) {
  const matches = observations.filter(browserQuoteMatcher(scenario, configuration,
    scenario.amountRaw ?? "0", scenario.basketAssets ?? []));
  // Legacy producers still require the latest request's terminal winner.
  const quoteReady = matches.some(isEconomicQuoteObservation) ? Boolean(quoteObservationIncumbent(matches))
    : matches.at(-1)?.terminal?.type === 'complete';
  const latest = matches.at(-1);
  return { quoteReady, swapEnabled, observations: observations.length, matchingObservations: matches.length,
    ...(latest ? { latest: { path: latest.path, status: latest.status, requestId: latest.requestId, backendRevision: latest.backendRevision,
      qualifiedFrames: latest.frames?.filter(frame => frame.type === 'qualified').length ?? 0,
      invalidatedFrames: latest.frames?.filter(frame => frame.type === 'invalidated').length ?? 0,
      terminal: typeof latest.terminal?.type === 'string' ? latest.terminal.type : undefined,
      interrupted: latest.interrupted, aborted: latest.aborted } } : {}) } satisfies UiReadinessDiagnostic;
}

export function uiQuoteReady(observations: readonly QuoteObservation[], scenario: Scenario,
  configuration: ProtocolConfiguration, swapEnabled: boolean) {
  const state = uiQuoteReadiness(observations, scenario, configuration, swapEnabled);
  return state.quoteReady && state.swapEnabled;
}

/** Observe the original quote within the existing enabled-Swap deadline. */
export async function waitForUiSwapReady(page: Page, configuration: ProtocolConfiguration, scenario?: Scenario,
  quoteEvidence?: Parameters<typeof uiPreparationAssertion>[2], observed?: (value: UiReadinessDiagnostic) => void) {
  await uiPreparationAssertion("ui-swap-not-enabled", async () => {
    if (!scenario) return expect(await getSwapButton(page)).toBeEnabled({ timeout: 60000 });
    await expect.poll(async () => {
      const state = uiQuoteReadiness(await quoteObservations(page), scenario, configuration,
        await (await getSwapButton(page)).isEnabled());
      try { observed?.(state); } catch { /* Optional predicate evidence cannot change readiness. */ }
      return state.quoteReady && state.swapEnabled;
    }, { timeout: 60000 }).toBe(true);
  }, quoteEvidence);
}
