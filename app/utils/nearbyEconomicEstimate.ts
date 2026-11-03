import type { QueryClient } from "@tanstack/react-query";
import { economicQuoteKey, economicRequest, type EconomicQuote, type EconomicQuoteScope, type EconomicRequest } from "./economicQuotes.ts";

export type EconomicReuseSample = NonNullable<EconomicQuote["reuseSample"]>;
export type ArithmeticEconomicEstimate = {
  quotedOutput: bigint;
  fees: { protocolFeeCygld: bigint; helperFeeCygld: bigint; marketFeeCygld: bigint };
  basis: EconomicReuseSample["basis"];
};

/** Advisory arithmetic only. Cached net output already includes these fees. */
export function arithmeticEconomicEstimate(sample: EconomicReuseSample, budget: bigint): ArithmeticEconomicEstimate | undefined {
  return scaleEconomicEstimate(sample, budget, true);
}

/** Extrapolation is display-only; an observed input limit cannot be scaled away. */
export function fullBudgetEconomicEstimate(quote: EconomicQuote, budget: bigint): ArithmeticEconomicEstimate | undefined {
  try {
    if (quote.reuseSample?.inputLimitObserved || BigInt(quote.inputs[0].amount) >= budget) return undefined;
    const sample = quote.reuseSample ?? { referenceInput: quote.inputs[0].amount, netOutput: quote.quotedOutput,
      fees: quote.fees, basis: "funded-input-approximation" as const };
    return scaleEconomicEstimate(sample, budget, false);
  } catch { return undefined; }
}

function scaleEconomicEstimate(sample: EconomicReuseSample, budget: bigint, clipped: boolean): ArithmeticEconomicEstimate | undefined {
  try {
    const reference = BigInt(sample.referenceInput);
    if (reference <= 0n || budget < 0n) return undefined;
    const input = clipped && budget > reference ? reference : budget;
    const scale = (amount: string) => BigInt(amount) * input / reference;
    return { quotedOutput: scale(sample.netOutput), basis: sample.basis,
      fees: { protocolFeeCygld: scale(sample.fees.coreProtocolFeeCygld),
        helperFeeCygld: scale(sample.fees.coreHelpersFeeCygld), marketFeeCygld: scale(sample.fees.marketFeeCygld) } };
  } catch { return undefined; }
}

/** Use the same whole historical floor for display arithmetic and exact-cache selection. */
export function fittingEconomicQuote(client: QueryClient, input: EconomicRequest, scope: EconomicQuoteScope) {
  const exact = client.getQueryData<EconomicQuote | null>(economicQuoteKey(input, scope));
  const lower = lowerEconomicQuote(client, input, scope);
  return lower && (!exact || BigInt(lower.quotedOutput) > BigInt(exact.quotedOutput)) ? lower : exact ?? undefined;
}

/** The existing query cache owns observations; this adds no second browser cache. */
export function upperEconomicQuote(client: QueryClient, input: EconomicRequest, scope: EconomicQuoteScope) {
  if (input.intent > 1 || input.inputs.length !== 1) return undefined;
  const requested = economicRequest(input), budget = BigInt(requested.inputs[0].amount);
  let upper: EconomicQuote | undefined, upperAmount: bigint | undefined;
  for (const [key, quote] of client.getQueriesData<EconomicQuote>({
    queryKey: ["economic-quote", scope.chainId, scope.generation, scope.configuration],
  })) {
    if (!quote || key.length !== 5) continue;
    try {
      const source = quote.request;
      if (source.intent !== requested.intent || source.inputs.length !== 1 ||
        source.inputs[0].currency.toLowerCase() !== requested.inputs[0].currency ||
        source.outputCurrency.toLowerCase() !== requested.outputCurrency) continue;
      const amount = BigInt(source.inputs[0].amount);
      if (amount > budget && (upperAmount === undefined || amount < upperAmount)) {
        upper = quote; upperAmount = amount;
      }
    } catch { /* An unreadable optional cache entry leaves ordinary quoting available. */ }
  }
  return upper;
}

/** Lower-budget or explicitly limited whole observations can fit the current funding budget. */
export function lowerEconomicQuote(client: QueryClient, input: EconomicRequest, scope: EconomicQuoteScope) {
  if (input.intent > 1 || input.inputs.length !== 1) return undefined;
  const requested = economicRequest(input), budget = BigInt(requested.inputs[0].amount);
  let lower: EconomicQuote | undefined, lowerOutput: bigint | undefined;
  for (const [key, quote] of client.getQueriesData<EconomicQuote>({
    queryKey: ["economic-quote", scope.chainId, scope.generation, scope.configuration],
  })) {
    if (!quote || key.length !== 5) continue;
    try {
      const source = quote.request;
      if (source.intent !== requested.intent || source.inputs.length !== 1 ||
        source.inputs[0].currency.toLowerCase() !== requested.inputs[0].currency ||
        source.outputCurrency.toLowerCase() !== requested.outputCurrency) continue;
      if (BigInt(source.inputs[0].amount) >= budget && !quote.reuseSample?.inputLimitObserved) continue;
      if (BigInt(quote.inputs[0].amount) > budget) continue;
      const output = BigInt(quote.quotedOutput);
      if (lowerOutput === undefined || output > lowerOutput) { lower = quote; lowerOutput = output; }
    } catch { /* Optional unreadable observations leave the exact quote available. */ }
  }
  return lower;
}
