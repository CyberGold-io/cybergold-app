import { chromium, expect } from "@playwright/test";
import { parseUnits } from "viem";
import { getMainInput, selectToken, showAllSellTokens } from "../metamask/token-flows/helpers.ts";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { ProtocolFacts } from "../../app/utils/protocolFacts.ts";
import type { BasketPreview } from "../../app/utils/basketPreview.ts";
import type { TradeQuote } from "../../app/utils/tradeQuote.ts";
import { diagnosticReferences, safeDiagnosticReferences } from "../../app/utils/diagnosticReferences.ts";
import { QuotePreviewError, knownQuoteError } from "../../app/utils/quoteErrors.ts";
import { basketFacts, configuredToken, ScenarioUnavailableError, tradeScenarios } from "./scenarios.ts";
import { failureResult, matchesBasketIntent, requireInvariant, resultFor, tokenRequest, validateBasket, validateTrade, type ScenarioResult } from "./regression.ts";

/** Real App interactions: no routes, mocked responses or injected wallet. */
export async function observeBrowserQuotes(origin: string, config: ProtocolConfiguration, facts: ProtocolFacts): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ baseURL: origin });
    page.setDefaultTimeout(20_000);
    for (const scenario of tradeScenarios.filter(scenario => scenario.requestedStrategy === "core")) {
      let result = { ...resultFor(scenario, "browser"), id: `ui-${scenario.id}`, requestedStrategy: "auto" as const };
      const started = performance.now();
      try {
        await page.goto("/en", { timeout: 45_000, waitUntil: "domcontentloaded" });
        await showAllSellTokens(page);
        const buy = scenario.side === "buy", sell = buy ? scenario.asset : "CYGLD", receive = buy ? "CYGLD" : scenario.asset;
        await selectToken(page, "sell", sell); await selectToken(page, "buy", receive);
        const editedSide = scenario.inputMode === "exact-in" ? "sell" : "buy";
        const basketEdited = scenario.asset === "BASKET" && ((buy && scenario.inputMode === "exact-in") || (!buy && scenario.inputMode === "exact-out"));
        const input = basketEdited ? page.locator(`#${editedSide}-basket-composition input`).first() : getMainInput(page, editedSide);
        await input.click();
        const intended = scenario.asset === "BASKET" ? undefined : tokenRequest(scenario, config, config.contracts.helpers!);
        const assets = scenario.asset === "BASKET" ? basketFacts(facts).assets : [];
        const firstAsset = config.tokens.find(token => token.type === "erc20" && token.address.toLowerCase() === assets[0]?.toLowerCase());
        if (basketEdited && !firstAsset) throw new ScenarioUnavailableError("basket-token-decimals-unavailable");
        const basketAmount = scenario.asset === "BASKET" ? String(parseUnits(scenario.displayAmount,
          basketEdited ? firstAsset!.decimals : configuredToken(config, "CYGLD").decimals)) : "0";
        // Clicking selects the amount mode. Only a positive submitted request
        // is eligible; a preceding warm/model request cannot satisfy the case.
        const pending = page.waitForResponse(response => {
          const path = new URL(response.url()).pathname;
          if (path !== (scenario.asset === "BASKET" ? "/api/quotes/basket-preview" : "/api/quotes/trade/stream")) return false;
          const body = response.request().postDataJSON();
          if (scenario.asset === "BASKET") return matchesBasketIntent(body, scenario, basketAmount, assets);
          return body && body.mode === scenario.inputMode
            && (!intended || body.amount === intended.amount && body.side === intended.side
              && body.counterToken?.toLowerCase() === intended.counterToken.toLowerCase() && body.native === intended.native)
            && (body.amount ? BigInt(body.amount) > 0n : true);
        }, { timeout: 75_000 });
        await input.fill(scenario.displayAmount);
        const response = await pending;
        const request = response.request().postDataJSON();
        if (!response.ok()) throw new QuotePreviewError("quote-service-unavailable", "quote-service-unavailable");
        if (scenario.asset === "BASKET") {
          const value: BasketPreview = await response.json();
          result.bounds = validateBasket(value, request, assets);
          result.refs = { ...diagnosticReferences(value), ...safeDiagnosticReferences({ requestId: response.headers()["x-cybergold-request-id"] }) };
          result.actualStrategy = "core"; result.quotedOperation = buy
            ? scenario.inputMode === "exact-in" ? "issueFromBasketExactIn" : "issueFromBasketExactOut"
            : "redeemToBasketExactIn";
          result.context = value.context;
        } else {
          const frames = (await response.text()).split("\n").filter(Boolean).map(line => JSON.parse(line));
          const terminal = frames.find(frame => frame.type === "complete" || frame.type === "error");
          requireInvariant(Boolean(terminal), "browser-stream-incomplete");
          if (terminal.type === "error") throw knownQuoteError(terminal) ?? new QuotePreviewError("quote-unavailable", "quote-unavailable", diagnosticReferences(terminal));
          const quote = terminal.value as TradeQuote;
          const token = config.tokens.find(token => token.symbol.toUpperCase() === (scenario.asset === "ETH" ? "WETH" : scenario.asset));
          requireInvariant(token?.type === "erc20" && request.counterToken.toLowerCase() === token.address.toLowerCase(), "browser-token-mismatch");
          result.bounds = validateTrade(quote, request); result.actualStrategy = quote.strategy; result.context = quote.context;
          result.refs = { ...diagnosticReferences(terminal), ...safeDiagnosticReferences({ requestId: response.headers()["x-cybergold-request-id"] }) };
          result.quotedOperation = quote.strategy === "market" ? scenario.inputMode === "exact-in" ? "swapExactInput" : "swapExactOutput"
            : buy ? scenario.asset === "ETH" ? "issueFromNativeExactOut" : "issueFromTokenExactOut"
              : scenario.asset === "ETH" ? "redeemToNativeExactIn" : "redeemToTokenExactIn";
          const quotedSide = editedSide === "sell" ? "buy" : "sell";
          const decimal = config.tokens.find(token => token.symbol.toUpperCase() === (quotedSide === "buy" ? receive : sell))?.decimals ?? 18;
          await expect.poll(async () => parseUnits(await getMainInput(page, quotedSide).inputValue() || "0", decimal), { timeout: 15_000 }).toBeGreaterThan(0n);
        }
        result.status = "pass"; delete result.code;
      } catch (error) { result = { ...failureResult(result, error), requestedStrategy: "auto" }; }
      result.durationMs = Math.round(performance.now() - started); results.push(result);
    }
    await page.close();
  } finally { await browser.close(); }
  return results;
}
