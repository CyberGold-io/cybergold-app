import { safeSelectedPlan } from './selectedPlan.ts';
import { chromium, expect } from "@playwright/test";
import { parseUnits } from "viem";
import { ensureBasketInputEditable, getMainInput, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers.ts";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { ProtocolFacts } from "../../app/utils/protocolFacts.ts";
import type { BasketPreview, BasketPreviewRequest } from "../../app/utils/basketPreview.ts";
import type { TradeQuote, TradeQuoteRequest } from "../../app/utils/tradeQuote.ts";
import type { UniversalExactInputQuote, UniversalExactInputRequest } from "../../app/utils/universalExactInput.ts";
import { diagnosticReferences, safeDiagnosticReferences } from "../../app/utils/diagnosticReferences.ts";
import { QuotePreviewError, knownQuoteError } from "../../app/utils/quoteErrors.ts";
import { basketFacts, configuredToken, ScenarioUnavailableError, tradeScenarios, type Scenario } from "./scenarios.ts";
import { applyEconomicQuote, applyUniversalExactInputQuote, failureResult, requireInvariant, resultFor, validateBasket, validateTrade, type ScenarioResult } from "./regression.ts";
import type { EconomicQuote, EconomicRequest } from "../../app/utils/economicQuotes.ts";
import { browserQuoteMatcher } from "./browserQuoteObservation.ts";
import { isEconomicQuoteObservation, quoteObservationIncumbent, installQuoteObservation, quoteObservations, type QuoteObservation } from "./quoteObservation.ts";
import { observedBasketProviderEvidence, providerSummaries, planDigest, type ProviderQuote } from "./providerEvidence.ts";
import { activeScenarios, type MatrixScenario, type ValuationSnapshot } from "./matrix.ts";
import { basketQualityTerms, tradeQualityTerms, enrichResultQuality } from "./quoteQuality.ts";
import { safeRunnerError } from "./runnerDiagnostics.ts";
import { positiveDisplayedAmount } from "./uiEconomics.ts";
import { basketAmountControls, displayedUiAmount } from "./uiQuoteCapture.ts";
import { regressionPolicy, unexpectedFailure, type RegressionRunPolicy } from './runPolicy.ts';

/** Real App interactions: no routes, mocked responses or injected wallet. */
export async function observeBrowserQuotes(origin: string, config: ProtocolConfiguration, facts: ProtocolFacts,
  inventory: readonly Scenario[] = activeScenarios(tradeScenarios.filter(s => s.requestedStrategy === "core")),
  checkpoint?: (results: readonly ScenarioResult[]) => Promise<void>, valuation?: ValuationSnapshot,
  runPolicy: RegressionRunPolicy = 'full'): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const policy = regressionPolicy(runPolicy);
  const unavailable = () => { throw new ScenarioUnavailableError("browser-unavailable"); };
  const browser = await chromium.launch({ headless: true }).catch(unavailable);
  try {
    const page = await browser.newPage({ baseURL: origin }).catch(unavailable);
    page.setDefaultTimeout(20_000);
    await page.addInitScript(installQuoteObservation as () => void).catch(unavailable);
    for (const scenario of inventory) {
      let result: ScenarioResult = { ...resultFor(scenario, "browser"), id: `ui-${scenario.id}`, requestedStrategy: "auto" as const,
        executionAttempted: false, transactionDisposition: 'not-submitted' as const };
      const started = performance.now();
      try {
        if (scenario.sizingError) throw new ScenarioUnavailableError(scenario.sizingError);
        result.executionStage = "ui-prepare-navigation";
        await page.goto("/en", { timeout: 45_000, waitUntil: "load" });
        result.executionStage = "ui-prepare-wallet";
        await page.getByRole("button", { name: "Connect Wallet", exact: true }).waitFor({ state: "visible" });
        result.executionStage = "ui-prepare-tokens";
        await showAllSellTokens(page);
        const buy = scenario.side === "buy", sell = buy ? scenario.asset : "CYGLD", receive = buy ? "CYGLD" : scenario.asset;
        await selectToken(page, "sell", sell); await selectToken(page, "buy", receive);
        const editedSide = scenario.inputMode === "exact-in" ? "sell" : "buy";
        const basketEdited = scenario.asset === "BASKET" && ((buy && scenario.inputMode === "exact-in") || (!buy && scenario.inputMode === "exact-out"));
        result.executionStage = "ui-prepare-amount";
        const input = basketEdited ? await ensureBasketInputEditable(page, editedSide) : getMainInput(page, editedSide);
        await input.click();
        const assets = scenario.asset === "BASKET" ? basketFacts(facts).assets : [];
        const firstAsset = config.tokens.find(token => token.type === "erc20" && token.address.toLowerCase() === assets[0]?.toLowerCase());
        if (basketEdited && !firstAsset) throw new ScenarioUnavailableError("basket-token-decimals-unavailable");
        const basketAmount = scenario.asset === "BASKET" ? String(parseUnits(scenario.displayAmount,
          basketEdited ? firstAsset!.decimals : configuredToken(config, "CYGLD").decimals)) : "0";
        // Clicking selects the amount mode. Only a positive submitted request
        // is eligible; a preceding warm/model request cannot satisfy the case.
        const matches = browserQuoteMatcher(scenario, config, basketAmount, assets);
        result.executionStage = "ui-prepare-quote";
        const before = (await quoteObservations(page)).length;
        await input.fill(scenario.displayAmount);
        let observation: QuoteObservation | undefined;
        let ready: unknown;
        await expect.poll(async () => {
          const matching = (await quoteObservations(page)).slice(before).filter(matches);
          const latest = matching.at(-1);
          // A completed matching quote still supplies the checked bounds. An
          // obsolete error or intentional input cancellation cannot preempt
          // its replacement while the existing terminal deadline continues.
          const accepted = quoteObservationIncumbent(matching);
          ready = accepted?.value;
          observation = (matching.some(isEconomicQuoteObservation) ? accepted?.observation
            : matching.find(row => row.terminal?.type === 'complete'))
            ?? (latest?.terminal || latest?.interrupted && !latest.aborted ? latest : undefined);
          const observed = observation ?? latest;
          if (observed) result.refs = { ...result.refs, ...safeDiagnosticReferences({ requestId: observed.requestId }) };
          return Boolean(observation);
        }, { timeout: 75_000 }).toBe(true).catch(() => { throw new ScenarioUnavailableError("quote-stream-interrupted"); });
        if (!observation) throw new ScenarioUnavailableError("quote-stream-interrupted");
        const observed = observation!, request = observed.request;
        const terminal=ready?{type:'complete',value:ready}:observed.terminal!;
        if(!terminal)throw new ScenarioUnavailableError("quote-stream-interrupted");
        result.refs = safeDiagnosticReferences({ ...diagnosticReferences(terminal), requestId: observed.requestId });
        if (scenario.size && scenario.inputMode !== "exact-in") result.providers = scenario.asset === "BASKET"
          ? observedBasketProviderEvidence([observed], scenario as MatrixScenario, config.contracts.core ?? undefined)
          : providerSummaries(terminal.type === "complete" ? terminal.value as ProviderQuote : terminal as Partial<ProviderQuote>);
        if (terminal.type === "error") throw knownQuoteError(terminal)
          ?? new QuotePreviewError(observed.status >= 400 ? "quote-service-unavailable" : "quote-unavailable", "quote-unavailable", result.refs);
        if (observed.status < 200 || observed.status >= 300) throw new QuotePreviewError("quote-service-unavailable", "quote-service-unavailable", result.refs);
        if (scenario.inputMode === "exact-in") {
          const value = terminal.value as UniversalExactInputQuote | EconomicQuote;
          if (["/api/economic-quotes","/api/economic-quotes/stream"].includes(observed.path)) applyEconomicQuote(result, value as EconomicQuote, request as EconomicRequest);
          else applyUniversalExactInputQuote(result, value as UniversalExactInputQuote, (request as UniversalExactInputRequest).inputs);
          result.refs = { ...diagnosticReferences(value), ...result.refs };
          result.deployment = { core: config.contracts.core as `0x${string}`, helpers: value.deployment.helpers as `0x${string}`, adapter: value.deployment.adapter as `0x${string}` };
        } else if (scenario.asset === "BASKET") {
          const value = terminal.value as BasketPreview;
          result.bounds = validateBasket(value, request as BasketPreviewRequest, assets);
          result.refs = { ...diagnosticReferences(value), ...result.refs };
          result.actualStrategy = "core"; result.quotedOperation = buy ? "issueFromBasketExactOut" : "redeemToBasketExactIn";
          result.context = value.context; result.selectedPlan = safeSelectedPlan({ ...value, basketRequest: request }, 'core');
          if (config.contracts.core) result.quoteTerms = basketQualityTerms(value, request as BasketPreviewRequest, config.contracts.core);
          if (scenario.size && result.providers) result.providers.core.bounds = result.bounds;
        } else {
          const quote = terminal.value as TradeQuote;
          const token = config.tokens.find(token => token.symbol.toUpperCase() === (scenario.asset === "ETH" ? "WETH" : scenario.asset));
          requireInvariant(token?.type === "erc20" && typeof request.counterToken === "string" && request.counterToken.toLowerCase() === token.address.toLowerCase(), "browser-token-mismatch");
          result.bounds = validateTrade(quote, request as TradeQuoteRequest); result.actualStrategy = quote.strategy;
          result.quoteTerms = tradeQualityTerms(quote); result.selectedPlan = safeSelectedPlan(quote.providerQuote, quote.strategy, quote);
          if (scenario.size) Object.assign(result, { selectedProvider: quote.strategy, planDigest: planDigest(quote), executionAttempted: false, transactionDisposition: "not-submitted" }); result.context = quote.context;
          result.quotedOperation = quote.strategy === "market" ? "swapExactOutput"
            : buy ? scenario.asset === "ETH" ? "issueFromNativeExactOut" : "issueFromTokenExactOut"
              : scenario.asset === "ETH" ? "redeemToNativeExactIn" : "redeemToTokenExactIn";
        }
        const quotedSide = editedSide === "sell" ? "buy" : "sell";
        if (scenario.asset === "BASKET" && !basketEdited) {
          await expect.poll(async () => {
            const amounts = await Promise.all((await basketAmountControls(page, quotedSide).all()).map(displayedUiAmount));
            return amounts.some(amount => positiveDisplayedAmount(amount, 18));
          }, { timeout: 15_000 }).toBe(true);
        } else {
          const decimal = config.tokens.find(token => token.symbol.toUpperCase() === (quotedSide === "buy" ? receive : sell))?.decimals ?? 18;
          await expect.poll(async () => positiveDisplayedAmount(await displayedUiAmount(getMainInput(page, quotedSide)), decimal), { timeout: 15_000 }).toBe(true);
        }
        result.status = "pass"; result.executionStage = "complete"; delete result.code;
      } catch (error) { result = { ...failureResult(result, error), ...safeRunnerError(error), requestedStrategy: "auto" }; }
      enrichResultQuality(result, valuation, config);
      result.durationMs = Math.round(performance.now() - started); results.push(result);
      const stopped = policy === 'diagnostic' && unexpectedFailure(result);
      if (stopped) results.push(...inventory.slice(results.length).map(remaining => ({
        ...resultFor(remaining, 'browser'), id: `ui-${remaining.id}`, requestedStrategy: 'auto' as const,
        executionAttempted: false, transactionDisposition: 'not-submitted' as const,
      })));
      // Reuse the host's owned UI checkpoint contract. A later browser stall
      // must not erase completed observations; failed optional writes leave
      // quotation behavior and the original per-operation deadlines unchanged.
      try { await checkpoint?.(results); } catch { /* Optional evidence cannot stop the remaining cases. */ }
      if (stopped) break;
    }
    await page.close().catch(() => {});
  } finally { await browser.close().catch(() => {}); }
  return results;
}
