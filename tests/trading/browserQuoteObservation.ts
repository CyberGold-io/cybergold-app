import { zeroAddress } from "viem";
import type { ProtocolConfiguration } from "../../app/utils/protocolConfiguration.ts";
import type { QuoteObservation } from "./quoteObservation.ts";
import { matchesBasketIntent, tokenRequest } from "./regression.ts";
import type { Scenario } from "./scenarios.ts";

const sameCurrency = (value: unknown, currency: string) => typeof value === "string" && value.toLowerCase() === currency.toLowerCase();
const amount = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
const positive = (value: unknown) => amount(value) && BigInt(value) > 0n;

/** Follow the UI producer's actual wire request, excluding preceding warm/empty amounts. */
export function browserQuoteMatcher(scenario: Scenario, config: ProtocolConfiguration, basketAmount: string, assets: readonly string[]) {
  const intended = scenario.asset === "BASKET" ? undefined : tokenRequest(scenario, config, config.contracts.helpers!);
  return (observation: QuoteObservation) => {
    const body = observation.request;
    if (scenario.inputMode !== "exact-in") {
      if (observation.path !== (scenario.asset === "BASKET" ? "/api/quotes/basket-preview" : "/api/quotes/trade/stream")) return false;
      if (scenario.asset === "BASKET") return matchesBasketIntent(body, scenario, basketAmount, assets);
      return body.mode === scenario.inputMode && body.amount === intended!.amount && body.side === intended!.side
        && sameCurrency(body.counterToken, intended!.counterToken) && body.native === intended!.native && positive(body.amount);
    }
    if (!["/api/economic-quotes", "/api/economic-quotes/stream", "/api/quotes/universal-exact-input"].includes(observation.path)) return false;
    const basket = scenario.asset === "BASKET", buy = scenario.side === "buy";
    if (body.intent !== (basket ? buy ? 2 : 3 : buy ? 0 : 1)) return false;
    const counter = intended?.native ? zeroAddress : intended?.counterToken;
    if (!sameCurrency(body.outputCurrency, buy ? config.contracts.core! : basket ? zeroAddress : counter!)) return false;
    if (!Array.isArray(body.inputs)) return false;
    const inputs = body.inputs as { currency?: unknown; amount?: unknown }[];
    if (basket && buy) return inputs.length === assets.length && inputs.every((row, index) =>
      sameCurrency(row?.currency, assets[index]) && amount(row?.amount)
      && (!scenario.basketAmounts || row.amount === scenario.basketAmounts[index]))
      && (scenario.basketAmounts || inputs[0]?.amount === basketAmount) && inputs.some(row => positive(row?.amount));
    return inputs.length === 1 && sameCurrency(inputs[0]?.currency, buy ? counter! : config.contracts.core!)
      && inputs[0]?.amount === (basket ? basketAmount : intended!.amount) && positive(inputs[0]?.amount);
  };
}
