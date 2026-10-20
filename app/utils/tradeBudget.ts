import type { TradeQuoteResult } from "./tradeQuote";

/** Quoted spending applies to either trade direction; the edited input is its budget. */
export function purchaseBudgetAmounts(budget: bigint, quote?: Pick<TradeQuoteResult, "quotedInput" | "inputMaximum">) {
  if (budget === 0n) return { spending: 0n, matchesBudget: true };
  if (!quote) return;
  return { spending: quote.quotedInput, matchesBudget: quote.quotedInput === budget };
}
