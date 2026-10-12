import { chromium, expect } from "@playwright/test";
import { parseUnits } from "viem";
import { ensureBasketInputEditable, getMainInput, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers.ts";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { ProtocolFacts } from "../../app/utils/protocolFacts.ts";
import type { BasketPreview, BasketPreviewRequest } from "../../app/utils/basketPreview.ts";
import type { TradeQuote, TradeQuoteRequest } from "../../app/utils/tradeQuote.ts";
import { diagnosticReferences, safeDiagnosticReferences } from "../../app/utils/diagnosticReferences.ts";
import { QuotePreviewError, knownQuoteError } from "../../app/utils/quoteErrors.ts";
import { basketFacts, configuredToken, ScenarioUnavailableError, tradeScenarios } from "./scenarios.ts";
import { failureResult, matchesBasketIntent, requireInvariant, resultFor, tokenRequest, validateBasket, validateTrade, type ScenarioResult } from "./regression.ts";
import { installQuoteObservation, quoteObservations, type QuoteObservation } from "./quoteObservation.ts";

/** Real App interactions: no routes, mocked responses or injected wallet. */
export async function observeBrowserQuotes(origin: string, config: ProtocolConfiguration, facts: ProtocolFacts): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const unavailable = () => { throw new ScenarioUnavailableError("browser-unavailable"); };
  const browser = await chromium.launch({ headless: true }).catch(unavailable);
  try {
    const page = await browser.newPage({ baseURL: origin }).catch(unavailable);
    page.setDefaultTimeout(20_000);
    await page.addInitScript(installQuoteObservation as () => void).catch(unavailable);
    for (const scenario of tradeScenarios.filter(scenario => scenario.requestedStrategy === "core")) {
      let result = { ...resultFor(scenario, "browser"), id: `ui-${scenario.id}`, requestedStrategy: "auto" as const };
      const started = performance.now();
      try {
        await page.goto("/en", { timeout: 45_000, waitUntil: "domcontentloaded" });
        // This existing wallet control is only visible once the App mounts.
        // Waiting for it prevents clicking a server-rendered picker before its
        // React handlers are attached on a cold deployed page.
        await page.getByRole("button", { name: "Connect Wallet", exact: true }).waitFor({ state: "visible" });
        await showAllSellTokens(page);
        const buy = scenario.side === "buy", sell = buy ? scenario.asset : "CYGLD", receive = buy ? "CYGLD" : scenario.asset;
        await selectToken(page, "sell", sell); await selectToken(page, "buy", receive);
        const editedSide = scenario.inputMode === "exact-in" ? "sell" : "buy";
        const basketEdited = scenario.asset === "BASKET" && ((buy && scenario.inputMode === "exact-in") || (!buy && scenario.inputMode === "exact-out"));
        const input = basketEdited ? await ensureBasketInputEditable(page, editedSide) : getMainInput(page, editedSide);
        await input.click();
        const intended = scenario.asset === "BASKET" ? undefined : tokenRequest(scenario, config, config.contracts.helpers!);
        const assets = scenario.asset === "BASKET" ? basketFacts(facts).assets : [];
        const firstAsset = config.tokens.find(token => token.type === "erc20" && token.address.toLowerCase() === assets[0]?.toLowerCase());
        if (basketEdited && !firstAsset) throw new ScenarioUnavailableError("basket-token-decimals-unavailable");
        const basketAmount = scenario.asset === "BASKET" ? String(parseUnits(scenario.displayAmount,
          basketEdited ? firstAsset!.decimals : configuredToken(config, "CYGLD").decimals)) : "0";
        // Clicking selects the amount mode. Only a positive submitted request
        // is eligible; a preceding warm/model request cannot satisfy the case.
        const matches = (observation: QuoteObservation) => {
          if (observation.path !== (scenario.asset === "BASKET" ? "/api/quotes/basket-preview" : "/api/quotes/trade/stream")) return false;
          const body = observation.request;
          if (scenario.asset === "BASKET") return matchesBasketIntent(body, scenario, basketAmount, assets);
          return body && body.mode === scenario.inputMode
            && (!intended || body.amount === intended.amount && body.side === intended.side
              && typeof body.counterToken === "string" && body.counterToken.toLowerCase() === intended.counterToken.toLowerCase() && body.native === intended.native)
            && (typeof body.amount === "string" ? BigInt(body.amount) > 0n : true);
        };
        const before = (await quoteObservations(page)).length;
        await input.fill(scenario.displayAmount);
        let observation: QuoteObservation | undefined;
        await expect.poll(async () => {
          const matching = (await quoteObservations(page)).slice(before).filter(matches);
          observation = matching.find(row => Boolean(row.terminal));
          const latest = observation ?? matching.at(-1);
          if (latest) result.refs = { ...result.refs, ...safeDiagnosticReferences({ requestId: latest.requestId }) };
          return Boolean(observation);
        }, { timeout: 75_000 }).toBe(true).catch(() => { throw new ScenarioUnavailableError("quote-stream-interrupted"); });
        const observed = observation!, request = observed.request, terminal = observed.terminal!;
        result.refs = safeDiagnosticReferences({ ...diagnosticReferences(terminal), requestId: observed.requestId });
        if (terminal.type === "error") throw knownQuoteError(terminal)
          ?? new QuotePreviewError(observed.status >= 400 ? "quote-service-unavailable" : "quote-unavailable", "quote-unavailable", result.refs);
        if (observed.status < 200 || observed.status >= 300) throw new QuotePreviewError("quote-service-unavailable", "quote-service-unavailable", result.refs);
        if (scenario.asset === "BASKET") {
          const value = terminal.value as BasketPreview;
          result.bounds = validateBasket(value, request as BasketPreviewRequest, assets);
          result.refs = { ...diagnosticReferences(value), ...result.refs };
          result.actualStrategy = "core"; result.quotedOperation = buy
            ? scenario.inputMode === "exact-in" ? "issueFromBasketExactIn" : "issueFromBasketExactOut"
            : "redeemToBasketExactIn";
          result.context = value.context;
        } else {
          const quote = terminal.value as TradeQuote;
          const token = config.tokens.find(token => token.symbol.toUpperCase() === (scenario.asset === "ETH" ? "WETH" : scenario.asset));
          requireInvariant(token?.type === "erc20" && typeof request.counterToken === "string" && request.counterToken.toLowerCase() === token.address.toLowerCase(), "browser-token-mismatch");
          result.bounds = validateTrade(quote, request as TradeQuoteRequest); result.actualStrategy = quote.strategy; result.context = quote.context;
          result.quotedOperation = quote.strategy === "market" ? scenario.inputMode === "exact-in" ? "swapExactInput" : "swapExactOutput"
            : buy ? scenario.asset === "ETH" ? "issueFromNativeExactOut" : "issueFromTokenExactOut"
              : scenario.asset === "ETH" ? "redeemToNativeExactIn" : "redeemToTokenExactIn";
        }
        const quotedSide = editedSide === "sell" ? "buy" : "sell";
        if (scenario.asset === "BASKET" && !basketEdited) {
          await expect.poll(() => page.locator(`#${quotedSide}-basket-composition`).getByRole("button", {
            name: new RegExp(`^Edit ${quotedSide} amount \\(`),
          }).evaluateAll(buttons => buttons.some(button => Number(button.textContent?.replace(/,/g, "")) > 0)), { timeout: 15_000 }).toBe(true);
        } else {
          const decimal = config.tokens.find(token => token.symbol.toUpperCase() === (quotedSide === "buy" ? receive : sell))?.decimals ?? 18;
          await expect.poll(async () => parseUnits(await getMainInput(page, quotedSide).inputValue() || "0", decimal), { timeout: 15_000 }).toBeGreaterThan(0n);
        }
        result.status = "pass"; delete result.code;
      } catch (error) { result = { ...failureResult(result, error), requestedStrategy: "auto" }; }
      result.durationMs = Math.round(performance.now() - started); results.push(result);
    }
    await page.close().catch(() => {});
  } finally { await browser.close().catch(() => {}); }
  return results;
}
